import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ATTENDANCE_STATUS_LABELS,
  PROFILE_FIELD_LABELS,
  ProfileField,
  REQUEST_TYPE_LABELS,
  RequestCreateSchema,
  RequestType,
  type RequestDetail,
  type RequestFormOptions,
  type RequestStatus,
} from '@ttlmhss/shared';
import { ArrowLeft, Inbox, Plus } from 'lucide-react';
import { z } from 'zod';
import { usePageTitle } from '../../../app/page-meta';
import { PageHeader, Panel } from '../../../components/layout/Page';
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  FormDialog,
  LoadingState,
  Pagination,
  SelectField,
  TextAreaField,
  TextField,
  useToast,
} from '../../../components/ui';
import { formatDateTime } from '../../../lib/format';
import { useFormSubmit } from '../../../lib/use-form-submit';
import { useResource } from '../../../lib/use-resource';
import { attendanceApi } from '../../attendance/api';
import { formatTime } from '../../attendance/attendance-shared';
import { useAuth } from '../../auth/auth-context';
import { timetableApi } from '../../timetable/api';
import { requestsApi } from '../api';
import { RequestRow, RequestStatusBadge, relatedText } from '../shared';
import styles from '../communication.module.css';

const PAGE_SIZE = 20;
const TypeChosen = z.object({ type: z.string().min(1, { message: 'Choose a request type' }) });
const STATUS_FILTERS = [
  { value: 'ACTIVE', label: 'Open and in review' },
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_REVIEW', label: 'In review' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'ALL', label: 'All' },
];

function useParamSetter() {
  const [params, setParams] = useSearchParams();
  const set = (key: string, value: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value) next.set(key, value);
        else next.delete(key);
        if (key !== 'page') next.delete('page');
        return next;
      },
      { replace: true },
    );
  return { params, set };
}

// ---------------------------------------------------------------------------
// Student: My requests
// ---------------------------------------------------------------------------

/** /portal/requests — the student's own requests and the "New request" form. */
export function MyRequestsPage() {
  usePageTitle('My requests');
  const toast = useToast();
  const navigate = useNavigate();
  const { params, set } = useParamSetter();
  const status = params.get('status') ?? 'ALL';
  const page = Number(params.get('page') ?? 1);
  const query = { status: status as RequestStatus | 'ACTIVE' | 'ALL', page, pageSize: PAGE_SIZE };
  const list = useResource(`req-mine:${JSON.stringify(query)}`, (signal) =>
    requestsApi.mine(query, signal),
  );
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="My requests"
        description="Ask the school to check your attendance, a result or your profile details. Your class teacher or the office will reply here."
        actions={
          <Button icon={<Plus size={18} aria-hidden="true" />} onClick={() => setCreating(true)}>
            New request
          </Button>
        }
      />
      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <SelectField
            label="Show"
            value={status}
            onChange={(e) => set('status', e.target.value)}
            options={[{ value: 'ALL', label: 'All' }, ...STATUS_FILTERS.slice(0, 5)]}
          />
        </div>
        {list.status === 'loading' && <LoadingState />}
        {list.status === 'error' && <ErrorState message={list.error} onRetry={list.reload} />}
        {list.status === 'ready' &&
          (list.data.items.length === 0 ? (
            <Panel>
              <EmptyState icon={Inbox} title="You have no requests here.">
                Use “New request” if something in your attendance, results or profile looks wrong.
              </EmptyState>
            </Panel>
          ) : (
            <Panel>
              <ul className={styles.list} aria-label="My requests">
                {list.data.items.map((r) => (
                  <RequestRow key={r.id} r={r} />
                ))}
              </ul>
              <Pagination
                page={list.data.page}
                pageSize={list.data.pageSize}
                total={list.data.total}
                label="requests"
                onPage={(p) => set('page', String(p))}
              />
            </Panel>
          ))}
      </div>
      {creating && (
        <NewRequestDialog
          onClose={() => setCreating(false)}
          onCreated={(d) => {
            setCreating(false);
            toast.show(`Request ${d.request.reference} sent`);
            void navigate(`/requests/${d.request.id}`);
          }}
        />
      )}
    </>
  );
}

function NewRequestDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (d: RequestDetail) => void;
}) {
  const options = useResource('req-options', (signal) => requestsApi.options(signal));
  return options.status === 'ready' ? (
    <NewRequestForm options={options.data} onClose={onClose} onCreated={onCreated} />
  ) : (
    <FormDialog
      open
      title="New request"
      submitLabel="Send request"
      pending={options.status === 'loading'}
      error={options.status === 'error' ? options.error : null}
      onSubmit={() => undefined}
      onClose={onClose}
    >
      {options.status === 'loading' ? <LoadingState /> : null}
    </FormDialog>
  );
}

function NewRequestForm({
  options,
  onClose,
  onCreated,
}: {
  options: RequestFormOptions;
  onClose: () => void;
  onCreated: (d: RequestDetail) => void;
}) {
  const [v, setV] = useState({
    type: '' as RequestType | '',
    date: '',
    periodId: '',
    examId: '',
    subjectId: '',
    field: '',
    description: '',
  });
  const form = useFormSubmit([
    'type',
    'date',
    'periodId',
    'examId',
    'subjectId',
    'field',
    'description',
  ]);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV((x) => ({
      ...x,
      [k]: e.target.value,
      ...(k === 'date' ? { periodId: '' } : {}),
      ...(k === 'examId' ? { subjectId: '' } : {}),
    }));
  const day = useResource(
    v.type === 'ATTENDANCE_ISSUE' && v.date ? `req-day:${v.date}` : null,
    (signal) => requestsApi.myDay(v.date, signal),
  );
  const exam = options.exams.find((e) => e.id === v.examId);
  const blocked = !options.section
    ? 'You are not placed in a class this year, so requests cannot be sent. Please contact the school office.'
    : options.activeCount >= options.activeLimit
      ? `You already have ${options.activeLimit} requests waiting. Please wait for some of them to be resolved first.`
      : null;

  async function submit() {
    if (blocked) return;
    const raw =
      v.type === 'ATTENDANCE_ISSUE'
        ? { type: v.type, date: v.date, periodId: v.periodId, description: v.description }
        : v.type === 'RESULT_CLARIFICATION'
          ? { type: v.type, examId: v.examId, subjectId: v.subjectId, description: v.description }
          : { type: v.type, field: v.field, description: v.description };
    if (!form.check(TypeChosen, { type: v.type })) return;
    const body = form.check(RequestCreateSchema, raw);
    if (!body) return;
    const r = await form.run(() => requestsApi.create(body));
    if (r.ok) onCreated(r.value);
  }

  return (
    <FormDialog
      open
      wide
      title="New request"
      description="Your request goes to your class teacher (attendance, results) or the school office (profile). It does not change any record by itself."
      submitLabel="Send request"
      pendingLabel="Sending…"
      pending={form.pending}
      error={form.formError}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      {blocked && <Alert tone="warning">{blocked}</Alert>}
      <SelectField
        label="What is it about?"
        placeholder="Choose a request type"
        value={v.type}
        onChange={set('type')}
        options={RequestType.values.map((t) => ({ value: t, label: REQUEST_TYPE_LABELS[t] }))}
        error={form.errors.type}
      />
      {v.type === 'ATTENDANCE_ISSUE' && (
        <>
          <TextField
            label="Date"
            type="date"
            min={options.attendanceFrom ?? undefined}
            max={options.attendanceTo ?? undefined}
            value={v.date}
            onChange={set('date')}
            error={form.errors.date}
          />
          <SelectField
            label="Period"
            placeholder={
              !v.date
                ? 'Choose the date first'
                : day.status === 'loading'
                  ? 'Loading…'
                  : day.status === 'ready' && day.data.lessons.length === 0
                    ? 'You had no lessons on this date'
                    : 'Choose the period'
            }
            value={v.periodId}
            onChange={set('periodId')}
            options={
              day.status === 'ready'
                ? day.data.lessons.map((l) => ({
                    value: l.period.id,
                    label: `${l.period.label} (${formatTime(l.period.startTime)}) · ${l.subject.name} · marked ${ATTENDANCE_STATUS_LABELS[l.status]}`,
                  }))
                : []
            }
            error={form.errors.periodId ?? (day.status === 'error' ? day.error : undefined)}
          />
        </>
      )}
      {v.type === 'RESULT_CLARIFICATION' && (
        <>
          <SelectField
            label="Exam"
            placeholder={options.exams.length ? 'Choose the exam' : 'No exams with results yet'}
            value={v.examId}
            onChange={set('examId')}
            options={options.exams.map((e) => ({ value: e.id, label: e.name }))}
            error={form.errors.examId}
          />
          <SelectField
            label="Subject"
            placeholder={exam ? 'Choose the subject' : 'Choose the exam first'}
            value={v.subjectId}
            onChange={set('subjectId')}
            options={(exam?.subjects ?? []).map((s) => ({ value: s.id, label: s.name }))}
            error={form.errors.subjectId}
          />
        </>
      )}
      {v.type === 'PROFILE_CORRECTION' && (
        <SelectField
          label="Which detail looks wrong?"
          placeholder="Choose one"
          value={v.field}
          onChange={set('field')}
          options={ProfileField.values.map((f) => ({ value: f, label: PROFILE_FIELD_LABELS[f] }))}
          error={form.errors.field}
        />
      )}
      <TextAreaField
        label="Describe the problem"
        hint="What looks wrong and what you think is correct. At least 10 characters."
        maxLength={2000}
        rows={4}
        value={v.description}
        onChange={set('description')}
        error={form.errors.description}
      />
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Reviewers: Requests
// ---------------------------------------------------------------------------

/** /requests — administrators (all) and class teachers (their own section) review requests. */
export function RequestsPage() {
  usePageTitle('Requests');
  const { params, set } = useParamSetter();
  const years = useResource('tt-years', (signal) => timetableApi.years(signal));
  const yearList = years.status === 'ready' ? years.data.items : [];
  const yearId =
    yearList.find((y) => y.id === params.get('year'))?.id ??
    yearList.find((y) => y.status === 'CURRENT')?.id ??
    yearList[0]?.id ??
    null;
  const sections = useResource(yearId ? `att-classes:${yearId}` : null, (signal) =>
    attendanceApi.classes(yearId!, signal),
  );
  const query = {
    academicYearId: yearId ?? undefined,
    status: (params.get('status') ?? 'ACTIVE') as RequestStatus | 'ACTIVE' | 'ALL',
    type: (params.get('type') || undefined) as RequestType | undefined,
    sectionId: params.get('section') || undefined,
    from: params.get('from') || undefined,
    to: params.get('to') || undefined,
    page: Number(params.get('page') ?? 1),
    pageSize: PAGE_SIZE,
  };
  const list = useResource(yearId ? `req-list:${JSON.stringify(query)}` : null, (signal) =>
    requestsApi.list(query, signal),
  );
  return (
    <>
      <PageHeader
        title="Requests"
        description="Students' requests about attendance, results and profile details. Handling a request never changes a record by itself — open the record's own page to correct it."
      />
      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <SelectField
            label="Academic year"
            value={yearId ?? ''}
            onChange={(e) => set('year', e.target.value)}
            options={yearList.map((y) => ({
              value: y.id,
              label: y.status === 'CURRENT' ? `${y.label} (current)` : y.label,
            }))}
          />
          <SelectField
            label="Status"
            value={query.status}
            onChange={(e) => set('status', e.target.value)}
            options={STATUS_FILTERS}
          />
          <SelectField
            label="Type"
            value={query.type ?? ''}
            placeholder="All types"
            onChange={(e) => set('type', e.target.value)}
            options={RequestType.values.map((t) => ({ value: t, label: REQUEST_TYPE_LABELS[t] }))}
          />
          <SelectField
            label="Class"
            value={query.sectionId ?? ''}
            placeholder="All classes"
            onChange={(e) => set('section', e.target.value)}
            options={(sections.status === 'ready' ? sections.data.items : []).map((s) => ({
              value: s.sectionId,
              label: `${s.className} ${s.sectionName}`,
            }))}
          />
          <TextField
            label="Sent from"
            type="date"
            value={query.from ?? ''}
            onChange={(e) => set('from', e.target.value)}
          />
          <TextField
            label="Sent to"
            type="date"
            value={query.to ?? ''}
            onChange={(e) => set('to', e.target.value)}
          />
        </div>
        {(years.status === 'loading' || list.status === 'loading') && <LoadingState />}
        {years.status === 'error' && <ErrorState message={years.error} onRetry={years.reload} />}
        {list.status === 'error' && <ErrorState message={list.error} onRetry={list.reload} />}
        {list.status === 'ready' &&
          (list.data.items.length === 0 ? (
            <Panel>
              <EmptyState icon={Inbox} title="No requests found">
                Nothing matches these filters.
              </EmptyState>
            </Panel>
          ) : (
            <Panel>
              <ul className={styles.list} aria-label="Requests">
                {list.data.items.map((r) => (
                  <RequestRow key={r.id} r={r} showStudent />
                ))}
              </ul>
              <Pagination
                page={list.data.page}
                pageSize={list.data.pageSize}
                total={list.data.total}
                label="requests"
                onPage={(p) => set('page', String(p))}
              />
            </Panel>
          ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// One request (students: their own; reviewers: within scope)
// ---------------------------------------------------------------------------

type Action = 'RESOLVED' | 'CLOSED' | 'OPEN';

/** /requests/:id — details, status, resolution; reviewers also see history and act. */
export function RequestDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const detail = useResource(`req:${id}`, (signal) => requestsApi.get(id, signal));
  usePageTitle(detail.status === 'ready' ? detail.data.request.summary : 'Request');
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const student = !!user?.roles.includes('STUDENT');
  const back = (
    <Link to={student ? '/portal/requests' : '/requests'} className={styles.link}>
      <ArrowLeft size={14} aria-hidden="true" /> {student ? 'My requests' : 'Requests'}
    </Link>
  );
  if (detail.status === 'loading') return <LoadingState />;
  if (detail.status === 'error') {
    return (
      <>
        <PageHeader title="Request" eyebrow={back} />
        <ErrorState message={detail.error} onRetry={detail.reload} />
      </>
    );
  }
  const { request: r, history, assignees } = detail.data;

  async function startReview() {
    setBusy(true);
    try {
      detail.replace(
        await requestsApi.setStatus(r.id, {
          status: 'IN_REVIEW',
          note: null,
          revision: r.revision,
        }),
      );
      toast.show('Request taken into review');
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Something went wrong.', 'error');
      detail.reload();
    } finally {
      setBusy(false);
    }
  }

  async function assign(userId: string) {
    setBusy(true);
    try {
      detail.replace(
        await requestsApi.assign(r.id, { assigneeUserId: userId || null, revision: r.revision }),
      );
      toast.show('Assignment saved');
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Something went wrong.', 'error');
      detail.reload();
    } finally {
      setBusy(false);
    }
  }

  // Where a reviewer corrects the record itself (the request never does it).
  const recordLink =
    student || !user
      ? null
      : r.type === 'ATTENDANCE_ISSUE' && r.related.date
        ? {
            to: `/attendance/class?date=${r.related.date}&section=${r.section.sectionId}`,
            label: 'Open the class attendance for that day',
          }
        : r.type === 'RESULT_CLARIFICATION'
          ? {
              to: `/results?year=${r.academicYear.id}&exam=${r.related.exam?.id ?? ''}&section=${r.section.sectionId}`,
              label: 'Open the class results',
            }
          : user.permissions.includes('students.edit') && user.roles.includes('ADMIN')
            ? { to: `/students/${r.student.id}`, label: "Open the student's profile" }
            : null;

  return (
    <>
      <PageHeader
        title={r.summary}
        eyebrow={back}
        description={`${REQUEST_TYPE_LABELS[r.type]} · ${r.reference}`}
      />
      <div className={styles.stack}>
        <Panel>
          <div className={styles.stack}>
            <div className={styles.badges}>
              <RequestStatusBadge status={r.status} />
              <span className={styles.meta}>Last updated {formatDateTime(r.updatedAt)}</span>
            </div>
            <dl className={styles.detail}>
              {!student && (
                <div>
                  <dt>Student</dt>
                  <dd>
                    {r.student.fullName} ({r.student.admissionNumber})
                  </dd>
                </div>
              )}
              <div>
                <dt>Class</dt>
                <dd>
                  {r.section.className} {r.section.sectionName} · {r.academicYear.label}
                </dd>
              </div>
              <div>
                <dt>About</dt>
                <dd>{relatedText(r) || '—'}</dd>
              </div>
              <div>
                <dt>Sent</dt>
                <dd>{formatDateTime(r.createdAt)}</dd>
              </div>
              <div>
                <dt>With</dt>
                <dd>{r.assignedTo?.name ?? (student ? 'School office' : 'Administrators')}</dd>
              </div>
              {r.resolvedAt && (
                <div>
                  <dt>Resolved</dt>
                  <dd>
                    {formatDateTime(r.resolvedAt)}
                    {r.resolvedBy ? ` by ${r.resolvedBy}` : ''}
                  </dd>
                </div>
              )}
              {r.closedAt && (
                <div>
                  <dt>Closed</dt>
                  <dd>{formatDateTime(r.closedAt)}</dd>
                </div>
              )}
            </dl>
            <div>
              <h2 className={styles.rowTitle}>Description</h2>
              <p className={styles.note}>{r.description}</p>
            </div>
            {r.resolutionNote && (
              <div>
                <h2 className={styles.rowTitle}>Resolution</h2>
                <p className={`${styles.note} ${styles.resolution}`}>{r.resolutionNote}</p>
              </div>
            )}
            {student && r.status !== 'RESOLVED' && r.status !== 'CLOSED' && (
              <p className={styles.hint}>
                Your request is {r.status === 'OPEN' ? 'waiting to be reviewed' : 'being reviewed'}.
                The reply will appear here.
              </p>
            )}
          </div>
        </Panel>

        {!student && (
          <Panel title="Review" description="Changes here update the request only.">
            <div className={styles.stack}>
              {recordLink && (
                <p>
                  <Link to={recordLink.to} className={styles.link}>
                    {recordLink.label}
                  </Link>{' '}
                  <span className={styles.meta}>— make any correction there.</span>
                </p>
              )}
              <div className={styles.actions}>
                {r.actions.startReview && (
                  <Button disabled={busy} onClick={() => void startReview()}>
                    Start review
                  </Button>
                )}
                {r.actions.resolve && (
                  <Button variant="secondary" onClick={() => setAction('RESOLVED')}>
                    Resolve
                  </Button>
                )}
                {r.actions.close && (
                  <Button variant="ghost" onClick={() => setAction('CLOSED')}>
                    Close
                  </Button>
                )}
                {r.actions.reopen && (
                  <Button variant="secondary" onClick={() => setAction('OPEN')}>
                    Reopen
                  </Button>
                )}
              </div>
              {r.actions.assign && assignees.length > 0 && (
                <div className={styles.toolbar}>
                  <SelectField
                    label="Assigned to"
                    value={r.assignedTo?.userId ?? ''}
                    placeholder="Administrators (unassigned)"
                    disabled={busy}
                    onChange={(e) => void assign(e.target.value)}
                    options={assignees.map((a) => ({ value: a.userId, label: a.name }))}
                  />
                </div>
              )}
              <div>
                <h2 className={styles.rowTitle}>History</h2>
                <ol className={styles.history} aria-label="Request history">
                  {history.map((h, i) => (
                    <li key={i}>
                      <span className={styles.rowTitle}>{h.action}</span>
                      {h.summary ? <span className={styles.meta}> · {h.summary}</span> : null}
                      <div className={styles.meta}>
                        {formatDateTime(h.at)}
                        {h.actor ? ` · ${h.actor}` : ''}
                      </div>
                      {h.note && <p className={styles.note}>{h.note}</p>}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </Panel>
        )}
      </div>
      {action && (
        <StatusDialog
          action={action}
          resolved={r.status === 'RESOLVED'}
          onClose={() => setAction(null)}
          onSubmit={(note) =>
            requestsApi.setStatus(r.id, { status: action, note, revision: r.revision })
          }
          onDone={(d) => {
            setAction(null);
            detail.replace(d);
            toast.show(
              action === 'RESOLVED'
                ? 'Request resolved'
                : action === 'CLOSED'
                  ? 'Request closed'
                  : 'Request reopened',
            );
          }}
        />
      )}
    </>
  );
}

const DIALOG = {
  RESOLVED: {
    title: 'Resolve this request',
    label: 'Resolution',
    hint: 'The student will see this. Say what was checked and what (if anything) was corrected.',
    submit: 'Resolve',
  },
  CLOSED: {
    title: 'Close this request',
    label: 'Reason',
    hint: 'Needed when the request was not resolved first (e.g. a duplicate). The student will see it.',
    submit: 'Close request',
  },
  OPEN: {
    title: 'Reopen this request',
    label: 'Why is it reopened?',
    hint: 'The earlier resolution stays in the history.',
    submit: 'Reopen',
  },
} as const;

function StatusDialog({
  action,
  resolved,
  onClose,
  onSubmit,
  onDone,
}: {
  action: Action;
  resolved: boolean;
  onClose: () => void;
  onSubmit: (note: string | null) => Promise<RequestDetail>;
  onDone: (d: RequestDetail) => void;
}) {
  const [note, setNote] = useState('');
  const form = useFormSubmit(['note']);
  const d = DIALOG[action];
  const optional = action === 'CLOSED' && resolved;
  return (
    <FormDialog
      open
      title={d.title}
      submitLabel={d.submit}
      pending={form.pending}
      error={form.formError}
      onClose={onClose}
      onSubmit={() =>
        void form.run(() => onSubmit(note.trim() || null)).then((r) => r.ok && onDone(r.value))
      }
    >
      <TextAreaField
        label={optional ? `${d.label} (optional)` : d.label}
        hint={optional ? 'The request is already resolved; a note is optional.' : d.hint}
        maxLength={1000}
        rows={4}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        error={form.errors.note}
      />
      {action === 'RESOLVED' && (
        <p className={styles.hint}>
          Resolving does not change attendance, marks or the profile. Correct the record on its own
          page first.
        </p>
      )}
    </FormDialog>
  );
}
