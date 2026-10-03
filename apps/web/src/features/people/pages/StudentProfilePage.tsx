import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import {
  CONTINUING_OUTCOMES,
  GENDER_LABELS,
  PROMOTION_OUTCOME_LABELS,
  PromotionOutcome,
  PromotionRequestSchema,
  StudentPlacementSchema,
  StudentTransferSchema,
  type AcademicYearView,
  type ClassView,
  type StudentView,
  type TemporaryCredentialView,
} from '@ttlmhss/shared';
import { History } from 'lucide-react';
import { usePageTitle } from '../../../app/page-meta';
import { PageHeader, Panel } from '../../../components/layout/Page';
import {
  Alert,
  Avatar,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FormDialog,
  LoadingState,
  SelectField,
  TextField,
  useToast,
} from '../../../components/ui';
import { useAuth } from '../../auth/auth-context';
import { formatDate } from '../../../lib/format';
import { useFormSubmit } from '../../../lib/use-form-submit';
import { messageOf, useResource } from '../../../lib/use-resource';
import { promotionApi, studentsApi } from '../api';
import {
  AccountBadge,
  CredentialNotice,
  StudentStatusBadge,
  currentYear,
  placementLabel,
  placementStatusLabel,
  sectionOptions,
  useSchoolStructure,
  yearOptions,
} from '../people-shared';
import admin from '../../admin/admin.module.css';
import styles from '../people.module.css';

type Dialog = 'details' | 'transfer' | 'place' | 'outcome' | null;
type Confirm = 'deactivate' | 'reactivate' | 'password' | 'delete' | null;

const show = (v: string | null | undefined) => v || <span className={admin.muted}>—</span>;

/** Compact student profile for administrators: identity, placement, account, history and actions. */
export function StudentProfilePage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const data = useResource(`student:${id}`, (signal) => studentsApi.get(id, signal));
  const title = data.status === 'ready' ? data.data.fullName : 'Student';
  usePageTitle(title);
  return (
    <>
      <PageHeader
        title={title}
        eyebrow={
          <Link to="/students" className={admin.backLink}>
            ← Students
          </Link>
        }
      />
      {data.status === 'loading' && <LoadingState />}
      {data.status === 'error' && <ErrorState message={data.error} onRetry={data.reload} />}
      {data.status === 'ready' && (
        <Profile
          student={data.data}
          onChange={data.replace}
          justAdmitted={Boolean((location.state as { admitted?: boolean } | null)?.admitted)}
        />
      )}
    </>
  );
}

function Profile({
  student,
  onChange,
  justAdmitted,
}: {
  student: StudentView;
  onChange: (s: StudentView) => void;
  justAdmitted: boolean;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const structure = useSchoolStructure();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [pending, setPending] = useState(false);
  const [credential, setCredential] = useState<TemporaryCredentialView | null>(null);
  const can = (p: string) => user?.permissions.includes(p as never) ?? false;
  const years = structure.years.status === 'ready' ? structure.years.data : [];
  const classes = structure.classes.status === 'ready' ? structure.classes.data : [];

  const active = student.status === 'ACTIVE';
  const placement = student.current;
  const latestActive = student.history.find((p) => p.status === 'ACTIVE') ?? null;

  async function runConfirm() {
    if (!confirm) return;
    setPending(true);
    try {
      if (confirm === 'deactivate' || confirm === 'reactivate') {
        const next = await studentsApi.setStatus(
          student.id,
          confirm === 'deactivate' ? 'INACTIVE' : 'ACTIVE',
        );
        onChange(next);
        toast.show(confirm === 'deactivate' ? 'Student deactivated' : 'Student reactivated');
      } else if (confirm === 'password') {
        setCredential(await studentsApi.issuePassword(student.id));
        onChange(await studentsApi.get(student.id));
      } else if (confirm === 'delete') {
        await studentsApi.remove(student.id);
        toast.show(`${student.fullName} deleted`);
        navigate('/students', { replace: true });
        return;
      }
      setConfirm(null);
    } catch (error) {
      toast.show(messageOf(error), 'error');
      setConfirm(null);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={admin.stack}>
      {credential && (
        <CredentialNotice
          credential={credential}
          name={student.fullName}
          onDone={() => setCredential(null)}
        />
      )}
      {justAdmitted &&
        !credential &&
        student.account?.mustChangePassword &&
        student.account.lastLoginAt === null && (
          <Alert tone="success" title="Student admitted">
            The sign-in account <strong>{student.account.username}</strong> was created. Issue a
            temporary password when you are ready to hand it over.
          </Alert>
        )}

      <Panel>
        <div className={styles.profileHead}>
          <Avatar name={student.fullName} size={64} />
          <div>
            <div className={styles.profileMeta}>
              <span>
                Admission no. <strong>{student.admissionNumber}</strong>
              </span>
              {placement ? (
                <>
                  <span>
                    Class <strong>{placementLabel(placement)}</strong>
                  </span>
                  <span>
                    Roll no. <strong>{placement.rollNumber ?? '—'}</strong>
                  </span>
                  <span>{placement.academicYearLabel}</span>
                </>
              ) : (
                <span>Not in a class this year</span>
              )}
            </div>
            <div className={styles.badges}>
              <StudentStatusBadge student={student} />
              <AccountBadge account={student.account} />
            </div>
          </div>
        </div>
        <div className={styles.profileActions}>
          {can('students.edit') && (
            <Link to={`/students/${student.id}/edit`} className={admin.textAction}>
              Edit details
            </Link>
          )}
          <Button variant="secondary" size="sm" onClick={() => setDialog('details')}>
            All details
          </Button>
          {active && can('students.transfer') && latestActive && (
            <Button variant="secondary" size="sm" onClick={() => setDialog('transfer')}>
              Change class
            </Button>
          )}
          {active && can('students.transfer') && !placement && (
            <Button variant="secondary" size="sm" onClick={() => setDialog('place')}>
              Place in a class
            </Button>
          )}
          {can('students.promote') && latestActive && (
            <Button variant="secondary" size="sm" onClick={() => setDialog('outcome')}>
              Promote / record outcome
            </Button>
          )}
          {active && can('users.reset_password') && (
            <Button variant="secondary" size="sm" onClick={() => setConfirm('password')}>
              Issue temporary password
            </Button>
          )}
          {can('students.deactivate') &&
            (active ? (
              <Button variant="ghost" size="sm" onClick={() => setConfirm('deactivate')}>
                Deactivate
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirm('reactivate')}>
                Reactivate
              </Button>
            ))}
          {student.deletable && can('students.delete') && (
            <Button variant="ghost" size="sm" onClick={() => setConfirm('delete')}>
              Delete record
            </Button>
          )}
        </div>
      </Panel>

      <div className={styles.grid2}>
        <Panel title="Contact and guardian">
          <dl className={styles.facts}>
            <div>
              <dt>Phone</dt>
              <dd>{show(student.phone)}</dd>
            </div>
            <div>
              <dt>Father</dt>
              <dd>{show(student.fatherName)}</dd>
            </div>
            <div>
              <dt>Mother</dt>
              <dd>{show(student.motherName)}</dd>
            </div>
            {student.guardianName && (
              <div>
                <dt>Guardian</dt>
                <dd>
                  {student.guardianName}
                  {student.guardianRelation ? ` (${student.guardianRelation})` : ''}
                </dd>
              </div>
            )}
            <div>
              <dt>Parent phone</dt>
              <dd>{show(student.guardianPhone)}</dd>
            </div>
          </dl>
        </Panel>
        <Panel title="Account">
          {student.account ? (
            <dl className={styles.facts}>
              <div>
                <dt>Username</dt>
                <dd>{student.account.username}</dd>
              </div>
              <div>
                <dt>Sign-in</dt>
                <dd>
                  {student.account.status !== 'ACTIVE'
                    ? 'Disabled (student inactive)'
                    : student.account.mustChangePassword
                      ? 'Waiting for first sign-in'
                      : 'Active'}
                </dd>
              </div>
              <div>
                <dt>Last signed in</dt>
                <dd>
                  {student.account.lastLoginAt ? formatDate(student.account.lastLoginAt) : 'Never'}
                </dd>
              </div>
            </dl>
          ) : (
            <p className={admin.muted}>No account is linked.</p>
          )}
        </Panel>
      </div>

      <Panel
        title="Academic history"
        description="Every placement is kept. Moves and promotions add a new row; earlier rows never change."
      >
        {student.history.length === 0 ? (
          <EmptyState icon={History} title="No placements yet" />
        ) : (
          <div className={admin.tableWrap}>
            <table className={`${admin.table} ${admin.stacked}`}>
              <caption className="visually-hidden">Academic history</caption>
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  <th scope="col">Class</th>
                  <th scope="col">Roll no.</th>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                  <th scope="col">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {student.history.map((p) => (
                  <tr key={p.enrolmentId}>
                    <td className={admin.strong}>{p.academicYearLabel}</td>
                    <td data-label="Class">{placementLabel(p)}</td>
                    <td data-label="Roll no.">{p.rollNumber ?? '—'}</td>
                    <td data-label="From">{formatDate(p.startedOn)}</td>
                    <td data-label="To">{p.endedOn ? formatDate(p.endedOn) : '—'}</td>
                    <td data-label="Outcome">{placementStatusLabel(p, student.history)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {dialog === 'details' && <DetailsDialog student={student} onClose={() => setDialog(null)} />}
      {dialog === 'transfer' && latestActive && (
        <TransferDialog
          student={student}
          from={latestActive}
          classes={classes}
          onClose={() => setDialog(null)}
          onDone={(s) => {
            setDialog(null);
            onChange(s);
            toast.show('Class changed');
          }}
        />
      )}
      {dialog === 'place' && (
        <PlaceDialog
          student={student}
          years={years}
          classes={classes}
          onClose={() => setDialog(null)}
          onDone={(s) => {
            setDialog(null);
            onChange(s);
            toast.show('Student placed in class');
          }}
        />
      )}
      {dialog === 'outcome' && latestActive && (
        <OutcomeDialog
          student={student}
          from={latestActive}
          years={years}
          classes={classes}
          onClose={() => setDialog(null)}
          onDone={async () => {
            setDialog(null);
            onChange(await studentsApi.get(student.id));
            toast.show('Outcome recorded');
          }}
        />
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === 'deactivate'
            ? `Deactivate ${student.fullName}?`
            : confirm === 'reactivate'
              ? `Reactivate ${student.fullName}?`
              : confirm === 'password'
                ? 'Issue a temporary password?'
                : `Delete ${student.fullName}?`
        }
        confirmLabel={
          confirm === 'deactivate'
            ? 'Deactivate'
            : confirm === 'reactivate'
              ? 'Reactivate'
              : confirm === 'password'
                ? 'Issue password'
                : 'Delete record'
        }
        tone={confirm === 'delete' || confirm === 'deactivate' ? 'danger' : 'primary'}
        pending={pending}
        onConfirm={() => void runConfirm()}
        onCancel={() => setConfirm(null)}
      >
        <p>
          {confirm === 'deactivate' &&
            'The student will be signed out and cannot sign in. Their record, class history and account are kept and can be reactivated.'}
          {confirm === 'reactivate' && 'The record and sign-in account become active again.'}
          {confirm === 'password' &&
            'A new temporary password replaces any previous one and is shown once. The student must choose their own password when they sign in.'}
          {confirm === 'delete' &&
            'This record was never used, so it can be removed completely, including its account. This cannot be undone.'}
        </p>
      </ConfirmDialog>
    </div>
  );
}

function DetailsDialog({ student, onClose }: { student: StudentView; onClose: () => void }) {
  const groups: [string, [string, string | null][]][] = [
    [
      'Personal',
      [
        ['Name', student.fullName],
        ['Date of birth', student.dateOfBirth ? formatDate(student.dateOfBirth) : null],
        ['Gender', student.gender ? GENDER_LABELS[student.gender] : null],
        ['Admission number', student.admissionNumber],
        ['Admission date', student.admissionDate ? formatDate(student.admissionDate) : null],
      ],
    ],
    [
      'Parent / guardian',
      [
        ['Father', student.fatherName],
        ['Mother', student.motherName],
        ['Guardian', student.guardianName],
        ['Relationship', student.guardianRelation],
        ['Phone', student.guardianPhone],
      ],
    ],
    [
      'Contact',
      [
        ['Phone', student.phone],
        ['Email', student.email],
        ['Emergency phone', student.emergencyPhone],
      ],
    ],
    [
      'Address',
      [
        ['Address', student.address],
        ['City / town', student.city],
        ['State', student.state],
        ['PIN code', student.pincode],
      ],
    ],
  ];
  return (
    <FormDialog
      open
      wide
      title={student.fullName}
      submitLabel="Close"
      onSubmit={onClose}
      onClose={onClose}
    >
      {groups.map(([title, rows]) => (
        <section key={title}>
          <h3 className={styles.groupTitle}>{title}</h3>
          <dl className={styles.facts}>
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{show(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </FormDialog>
  );
}

function TransferDialog({
  student,
  from,
  classes,
  onClose,
  onDone,
}: {
  student: StudentView;
  from: StudentView['history'][number];
  classes: ClassView[];
  onClose: () => void;
  onDone: (s: StudentView) => void;
}) {
  const [values, setValues] = useState({
    targetSectionId: '',
    rollNumber: '',
    effectiveDate: '',
    note: '',
  });
  const form = useFormSubmit(['targetSectionId', 'rollNumber', 'effectiveDate', 'note']);
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));
  async function submit() {
    const body = form.check(StudentTransferSchema, {
      academicYearId: from.academicYearId,
      targetSectionId: values.targetSectionId,
      rollNumber: values.rollNumber || null,
      effectiveDate: values.effectiveDate,
      note: values.note || null,
    });
    if (!body) return;
    const result = await form.run(() => studentsApi.transfer(student.id, body));
    if (result.ok) onDone(result.value);
  }
  return (
    <FormDialog
      open
      title={`Change class for ${student.fullName}`}
      description={
        <p>
          Now: <strong>{placementLabel(from)}</strong>, roll no. {from.rollNumber ?? '—'},{' '}
          {from.academicYearLabel}. The current placement is closed on the date below and a new one
          starts; history is kept.
        </p>
      }
      submitLabel="Change class"
      pending={form.pending}
      error={form.formError}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <SelectField
        label="New class and section"
        required
        placeholder="Choose…"
        options={sectionOptions(classes).filter((o) => o.value !== from.sectionId)}
        value={values.targetSectionId}
        onChange={set('targetSectionId')}
        error={form.errors.targetSectionId}
      />
      <div className={admin.formGrid}>
        <TextField
          label="From date"
          type="date"
          required
          value={values.effectiveDate}
          onChange={set('effectiveDate')}
          error={form.errors.effectiveDate}
        />
        <TextField
          label="New roll number"
          maxLength={10}
          value={values.rollNumber}
          onChange={set('rollNumber')}
          error={form.errors.rollNumber}
        />
      </div>
      <TextField
        label="Reason"
        hint="Optional."
        maxLength={200}
        value={values.note}
        onChange={set('note')}
        error={form.errors.note}
      />
    </FormDialog>
  );
}

function PlaceDialog({
  student,
  years,
  classes,
  onClose,
  onDone,
}: {
  student: StudentView;
  years: AcademicYearView[];
  classes: ClassView[];
  onClose: () => void;
  onDone: (s: StudentView) => void;
}) {
  const open = years.filter((y) => y.status !== 'CLOSED');
  const [values, setValues] = useState({
    academicYearId: currentYear(open)?.id ?? '',
    sectionId: '',
    rollNumber: '',
    startedOn: '',
  });
  const form = useFormSubmit(['academicYearId', 'sectionId', 'rollNumber', 'startedOn']);
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));
  async function submit() {
    const body = form.check(StudentPlacementSchema, {
      ...values,
      rollNumber: values.rollNumber || null,
    });
    if (!body) return;
    const result = await form.run(() => studentsApi.place(student.id, body));
    if (result.ok) onDone(result.value);
  }
  return (
    <FormDialog
      open
      title={`Place ${student.fullName} in a class`}
      description="For a student on roll who has no class in the chosen year."
      submitLabel="Place in class"
      pending={form.pending}
      error={form.formError}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <div className={admin.formGrid}>
        <SelectField
          label="Academic year"
          required
          options={yearOptions(open)}
          value={values.academicYearId}
          onChange={set('academicYearId')}
          error={form.errors.academicYearId}
        />
        <SelectField
          label="Class and section"
          required
          placeholder="Choose…"
          options={sectionOptions(classes)}
          value={values.sectionId}
          onChange={set('sectionId')}
          error={form.errors.sectionId}
        />
        <TextField
          label="From date"
          type="date"
          required
          value={values.startedOn}
          onChange={set('startedOn')}
          error={form.errors.startedOn}
        />
        <TextField
          label="Roll number"
          maxLength={10}
          value={values.rollNumber}
          onChange={set('rollNumber')}
          error={form.errors.rollNumber}
        />
      </div>
    </FormDialog>
  );
}

/** Individual promotion: the same transactional promotion API with one student. */
function OutcomeDialog({
  student,
  from,
  years,
  classes,
  onClose,
  onDone,
}: {
  student: StudentView;
  from: StudentView['history'][number];
  years: AcademicYearView[];
  classes: ClassView[];
  onClose: () => void;
  onDone: () => void;
}) {
  const sourceYear = years.find((y) => y.id === from.academicYearId);
  const later = years
    .filter((y) => y.status !== 'CLOSED' && sourceYear && y.startDate > sourceYear.startDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const [values, setValues] = useState({
    outcome: 'PROMOTED',
    targetAcademicYearId: later[0]?.id ?? '',
    targetSectionId: '',
    rollNumber: '',
  });
  const form = useFormSubmit((p) =>
    /^(targetAcademicYearId|decisions\.0\.(targetSectionId|rollNumber|studentId))$/.test(p),
  );
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));
  const continues = CONTINUING_OUTCOMES.includes(values.outcome as never);
  async function submit() {
    const body = form.check(PromotionRequestSchema, {
      sourceAcademicYearId: from.academicYearId,
      sourceSectionId: from.sectionId,
      targetAcademicYearId: continues ? values.targetAcademicYearId || null : null,
      decisions: [
        {
          studentId: student.id,
          outcome: values.outcome,
          targetSectionId: continues ? values.targetSectionId || null : null,
          rollNumber: continues && values.rollNumber ? values.rollNumber : null,
        },
      ],
    });
    if (!body) return;
    const result = await form.run(() => promotionApi.promote(body));
    if (result.ok) onDone();
  }
  return (
    <FormDialog
      open
      title={`Outcome for ${student.fullName}`}
      description={
        <p>
          From <strong>{placementLabel(from)}</strong>, {from.academicYearLabel}. That placement is
          closed with the outcome and kept in history.
        </p>
      }
      submitLabel="Record outcome"
      pending={form.pending}
      error={form.formError}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <SelectField
        label="Outcome"
        required
        options={PromotionOutcome.values.map((o) => ({
          value: o,
          label: PROMOTION_OUTCOME_LABELS[o],
        }))}
        value={values.outcome}
        onChange={set('outcome')}
        hint={
          continues
            ? undefined
            : 'The student goes off roll today (or at the end of that year) and their account is disabled.'
        }
      />
      {continues && later.length === 0 && (
        <Alert tone="info">Add the next academic year first (School setup → Academic years).</Alert>
      )}
      {continues && (
        <SelectField
          label="Into academic year"
          required
          options={yearOptions(later)}
          placeholder="Choose…"
          value={values.targetAcademicYearId}
          onChange={set('targetAcademicYearId')}
          error={form.errors.targetAcademicYearId}
        />
      )}
      {continues && (
        <div className={admin.formGrid}>
          <SelectField
            label="Class and section"
            required
            placeholder="Choose…"
            options={sectionOptions(classes)}
            value={values.targetSectionId}
            onChange={set('targetSectionId')}
            error={form.errors['decisions.0.targetSectionId']}
          />
          <TextField
            label="Roll number"
            maxLength={10}
            value={values.rollNumber}
            onChange={set('rollNumber')}
            error={form.errors['decisions.0.rollNumber']}
          />
        </div>
      )}
      {form.errors['decisions.0.studentId'] && (
        <Alert tone="error">{form.errors['decisions.0.studentId'].join(' ')}</Alert>
      )}
    </FormDialog>
  );
}
