import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { GENDER_LABELS, type TeacherView, type TemporaryCredentialView } from '@ttlmhss/shared';
import { X } from 'lucide-react';
import { usePageTitle } from '../../../app/page-meta';
import { PageHeader, Panel } from '../../../components/layout/Page';
import {
  Alert,
  Avatar,
  Button,
  ConfirmDialog,
  ErrorState,
  LoadingState,
  SelectField,
  StatusBadge,
  useToast,
} from '../../../components/ui';
import { useAuth } from '../../auth/auth-context';
import { formatDate } from '../../../lib/format';
import { messageOf, useResource } from '../../../lib/use-resource';
import { subjects as subjectsApi } from '../../admin/api';
import { classTeachersApi, teachersApi } from '../api';
import { ClassTeacherDialog } from '../ClassTeacherDialog';
import { AccountBadge, CredentialNotice, useSchoolStructure } from '../people-shared';
import admin from '../../admin/admin.module.css';
import styles from '../people.module.css';

type Confirm =
  'deactivate' | 'reactivate' | 'password' | 'delete' | { endAssignment: string } | null;
const show = (v: string | null | undefined) => v || <span className={admin.muted}>—</span>;

export function TeacherProfilePage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const data = useResource(`teacher:${id}`, (signal) => teachersApi.get(id, signal));
  const title = data.status === 'ready' ? data.data.fullName : 'Teacher';
  usePageTitle(title);
  return (
    <>
      <PageHeader
        title={title}
        eyebrow={
          <Link to="/teachers" className={admin.backLink}>
            ← Teachers
          </Link>
        }
      />
      {data.status === 'loading' && <LoadingState />}
      {data.status === 'error' && <ErrorState message={data.error} onRetry={data.reload} />}
      {data.status === 'ready' && (
        <Profile
          teacher={data.data}
          onChange={data.replace}
          justCreated={Boolean((location.state as { created?: boolean } | null)?.created)}
        />
      )}
    </>
  );
}

function Profile({
  teacher,
  onChange,
  justCreated,
}: {
  teacher: TeacherView;
  onChange: (t: TeacherView) => void;
  justCreated: boolean;
}) {
  const { user } = useAuth();
  const can = (p: string) => user?.permissions.includes(p as never) ?? false;
  const navigate = useNavigate();
  const toast = useToast();
  const structure = useSchoolStructure();
  const allSubjects = useResource('subjects', (signal) => subjectsApi.list(signal));
  const [subjectId, setSubjectId] = useState('');
  const [subjectError, setSubjectError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [credential, setCredential] = useState<TemporaryCredentialView | null>(null);
  const active = teacher.status === 'ACTIVE';

  const available =
    allSubjects.status === 'ready'
      ? allSubjects.data.filter(
          (s) => s.status === 'ACTIVE' && !teacher.subjects.some((t) => t.id === s.id),
        )
      : [];

  async function assignSubject() {
    if (!subjectId) return setSubjectError('Choose a subject.');
    setBusy(true);
    setSubjectError(null);
    try {
      onChange(await teachersApi.assignSubject(teacher.id, subjectId));
      setSubjectId('');
      toast.show('Subject assigned');
    } catch (error) {
      setSubjectError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function removeSubject(id: string, name: string) {
    setBusy(true);
    try {
      onChange(await teachersApi.removeSubject(teacher.id, id));
      toast.show(`${name} removed`);
    } catch (error) {
      toast.show(messageOf(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm === 'deactivate' || confirm === 'reactivate') {
        onChange(
          await teachersApi.setStatus(teacher.id, confirm === 'deactivate' ? 'INACTIVE' : 'ACTIVE'),
        );
        toast.show(confirm === 'deactivate' ? 'Teacher deactivated' : 'Teacher reactivated');
      } else if (confirm === 'password') {
        setCredential(await teachersApi.issuePassword(teacher.id));
        onChange(await teachersApi.get(teacher.id));
      } else if (confirm === 'delete') {
        await teachersApi.remove(teacher.id);
        toast.show(`${teacher.fullName} deleted`);
        navigate('/teachers', { replace: true });
        return;
      } else {
        await classTeachersApi.end(confirm.endAssignment);
        onChange(await teachersApi.get(teacher.id));
        toast.show('Class teacher assignment ended');
      }
      setConfirm(null);
    } catch (error) {
      toast.show(messageOf(error), 'error');
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  const activeAssignments = teacher.classTeacherAssignments.filter((a) => a.status === 'ACTIVE');
  const pastAssignments = teacher.classTeacherAssignments.filter((a) => a.status !== 'ACTIVE');
  const endingName =
    typeof confirm === 'object' && confirm
      ? teacher.classTeacherAssignments.find((a) => a.id === confirm.endAssignment)
      : null;

  return (
    <div className={admin.stack}>
      {credential && (
        <CredentialNotice
          credential={credential}
          name={teacher.fullName}
          onDone={() => setCredential(null)}
        />
      )}
      {justCreated &&
        !credential &&
        teacher.account?.lastLoginAt === null &&
        teacher.account.mustChangePassword && (
          <Alert tone="success" title="Teacher added">
            The sign-in account <strong>{teacher.account.username}</strong> was created. Issue a
            temporary password when you are ready to hand it over.
          </Alert>
        )}

      <Panel>
        <div className={styles.profileHead}>
          <Avatar name={teacher.fullName} size={64} />
          <div>
            <div className={styles.profileMeta}>
              <span>
                Staff ID <strong>{teacher.staffCode}</strong>
              </span>
              {teacher.designation && <span>{teacher.designation}</span>}
            </div>
            <div className={styles.badges}>
              <StatusBadge status={teacher.status} />
              <AccountBadge account={teacher.account} />
            </div>
          </div>
        </div>
        <div className={styles.profileActions}>
          {can('teachers.edit') && (
            <Link to={`/teachers/${teacher.id}/edit`} className={admin.textAction}>
              Edit details
            </Link>
          )}
          {active && can('users.reset_password') && (
            <Button variant="secondary" size="sm" onClick={() => setConfirm('password')}>
              Issue temporary password
            </Button>
          )}
          {can('teachers.deactivate') &&
            (active ? (
              <Button variant="ghost" size="sm" onClick={() => setConfirm('deactivate')}>
                Deactivate
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirm('reactivate')}>
                Reactivate
              </Button>
            ))}
          {teacher.deletable && can('teachers.delete') && (
            <Button variant="ghost" size="sm" onClick={() => setConfirm('delete')}>
              Delete record
            </Button>
          )}
        </div>
      </Panel>

      <div className={styles.grid2}>
        <Panel
          title="Subjects"
          description="Teacher → Subject only. The classes and periods they teach are set in the timetable."
        >
          {teacher.subjects.length === 0 ? (
            <p className={admin.muted}>No subjects assigned yet.</p>
          ) : (
            <ul className={styles.chips} aria-label="Assigned subjects">
              {teacher.subjects.map((s) => (
                <li
                  key={s.id}
                  className={`${styles.chip} ${can('teacher_subjects.manage') ? '' : styles.chipStatic}`}
                >
                  {s.name}
                  {s.status !== 'ACTIVE' && ' (inactive)'}
                  {can('teacher_subjects.manage') && (
                    <button
                      type="button"
                      className={styles.chipRemove}
                      aria-label={`Remove ${s.name}`}
                      disabled={busy}
                      onClick={() => void removeSubject(s.id, s.name)}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {active && can('teacher_subjects.manage') && (
            <div className={styles.assignRow}>
              <SelectField
                label="Add a subject"
                placeholder={available.length ? 'Choose…' : 'No more subjects'}
                options={available.map((s) => ({ value: s.id, label: s.name }))}
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                error={subjectError}
              />
              <Button
                variant="secondary"
                loading={busy}
                onClick={() => void assignSubject()}
                disabled={!available.length}
              >
                Assign
              </Button>
            </div>
          )}
        </Panel>

        <Panel
          title="Class teacher"
          actions={
            active && can('class_teacher_assignments.manage') ? (
              <Button size="sm" variant="secondary" onClick={() => setAssigning(true)}>
                Assign as class teacher
              </Button>
            ) : undefined
          }
        >
          {activeAssignments.length === 0 ? (
            <p className={admin.muted}>Not a class teacher at the moment.</p>
          ) : (
            <ul className={admin.classList}>
              {activeAssignments.map((a) => (
                <li key={a.id} className={styles.assignmentItem}>
                  <span>
                    <strong>
                      {a.className} {a.sectionName}
                    </strong>{' '}
                    · {a.academicYearLabel}
                    <span className={styles.sub}>since {formatDate(a.assignedOn)}</span>
                  </span>
                  {can('class_teacher_assignments.manage') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirm({ endAssignment: a.id })}
                    >
                      End
                      <span className="visually-hidden">
                        {' '}
                        class teacher role for {a.className} {a.sectionName}
                      </span>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {pastAssignments.length > 0 && (
            <>
              <h3 className={styles.groupTitle}>Earlier</h3>
              <ul className={admin.classList}>
                {pastAssignments.map((a) => (
                  <li key={a.id} className={styles.assignmentItem}>
                    <span>
                      {a.className} {a.sectionName} · {a.academicYearLabel}
                      <span className={styles.sub}>
                        {formatDate(a.assignedOn)} – {a.endedOn ? formatDate(a.endedOn) : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>

        <Panel title="Details">
          <dl className={styles.facts}>
            <div>
              <dt>Phone</dt>
              <dd>{show(teacher.phone)}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{show(teacher.email)}</dd>
            </div>
            <div>
              <dt>Address</dt>
              <dd>{show(teacher.address)}</dd>
            </div>
            <div>
              <dt>Qualification</dt>
              <dd>{show(teacher.qualification)}</dd>
            </div>
            <div>
              <dt>Joined</dt>
              <dd>{teacher.joiningDate ? formatDate(teacher.joiningDate) : show(null)}</dd>
            </div>
            <div>
              <dt>Gender</dt>
              <dd>{teacher.gender ? GENDER_LABELS[teacher.gender] : show(null)}</dd>
            </div>
            <div>
              <dt>Date of birth</dt>
              <dd>{teacher.dateOfBirth ? formatDate(teacher.dateOfBirth) : show(null)}</dd>
            </div>
          </dl>
        </Panel>

        <Panel title="Account">
          {teacher.account ? (
            <dl className={styles.facts}>
              <div>
                <dt>Username</dt>
                <dd>{teacher.account.username}</dd>
              </div>
              <div>
                <dt>Sign-in</dt>
                <dd>
                  {teacher.account.status !== 'ACTIVE'
                    ? 'Disabled (teacher inactive)'
                    : teacher.account.mustChangePassword
                      ? 'Waiting for first sign-in'
                      : 'Active'}
                </dd>
              </div>
              <div>
                <dt>Last signed in</dt>
                <dd>
                  {teacher.account.lastLoginAt ? formatDate(teacher.account.lastLoginAt) : 'Never'}
                </dd>
              </div>
            </dl>
          ) : (
            <p className={admin.muted}>No account is linked.</p>
          )}
        </Panel>
      </div>

      {assigning && structure.years.status === 'ready' && structure.classes.status === 'ready' && (
        <ClassTeacherDialog
          title={`Make ${teacher.fullName} a class teacher`}
          years={structure.years.data}
          classes={structure.classes.data}
          teachers={[]}
          fixed={{ teacherId: teacher.id }}
          onClose={() => setAssigning(false)}
          onDone={async (a) => {
            setAssigning(false);
            onChange(await teachersApi.get(teacher.id));
            toast.show(`Class teacher of ${a.className} ${a.sectionName}`);
          }}
        />
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === 'deactivate'
            ? `Deactivate ${teacher.fullName}?`
            : confirm === 'reactivate'
              ? `Reactivate ${teacher.fullName}?`
              : confirm === 'password'
                ? 'Issue a temporary password?'
                : confirm === 'delete'
                  ? `Delete ${teacher.fullName}?`
                  : 'End class teacher role?'
        }
        confirmLabel={
          confirm === 'deactivate'
            ? 'Deactivate'
            : confirm === 'reactivate'
              ? 'Reactivate'
              : confirm === 'password'
                ? 'Issue password'
                : confirm === 'delete'
                  ? 'Delete record'
                  : 'End role'
        }
        tone={confirm === 'delete' || confirm === 'deactivate' ? 'danger' : 'primary'}
        pending={busy}
        onConfirm={() => void runConfirm()}
        onCancel={() => setConfirm(null)}
      >
        <p>
          {confirm === 'deactivate' &&
            `${teacher.fullName} will be signed out and cannot sign in. ${activeAssignments.length ? 'Their class teacher role ends today. ' : ''}Subjects and history are kept.`}
          {confirm === 'reactivate' &&
            'The record and sign-in account become active again. Class teacher roles are not restored automatically.'}
          {confirm === 'password' &&
            'A new temporary password replaces any previous one and is shown once. The teacher must choose their own password when they sign in.'}
          {confirm === 'delete' &&
            'This record was never used, so it can be removed completely, including its account. This cannot be undone.'}
          {endingName &&
            `${teacher.fullName} stops being class teacher of ${endingName.className} ${endingName.sectionName} (${endingName.academicYearLabel}) today. The assignment stays in the history.`}
        </p>
      </ConfirmDialog>
    </div>
  );
}
