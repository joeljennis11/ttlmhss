import { useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  TimetableRequestCreateSchema,
  type TimetableRequestOptions,
  type TimetableRequestView,
} from '@ttlmhss/shared';
import { Inbox, Plus } from 'lucide-react';
import { Panel } from '../../../components/layout/Page';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FormDialog,
  LoadingState,
  SelectField,
  TextAreaField,
  useToast,
  type BadgeTone,
} from '../../../components/ui';
import { WEEKDAY_LABELS, formatDateTime } from '../../../lib/format';
import { useFormSubmit } from '../../../lib/use-form-submit';
import { messageOf, useResource } from '../../../lib/use-resource';
import { TimetableLayout } from '../TimetableLayout';
import { timetableRequestsApi } from '../api';
import styles from '../timetable.module.css';

const STATUS: Record<TimetableRequestView['status'], { tone: BadgeTone; label: string }> = {
  PENDING: { tone: 'warning', label: 'Waiting for review' },
  APPROVED: { tone: 'active', label: 'Approved — in the draft' },
  DECLINED: { tone: 'inactive', label: 'Declined' },
  WITHDRAWN: { tone: 'inactive', label: 'Withdrawn' },
};
const KIND = { ADD: 'Add a lesson', CHANGE: 'Change the lesson', REMOVE: 'Remove the lesson' };
const FILTERS = [
  { value: 'PENDING', label: 'Waiting for review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'DECLINED', label: 'Declined' },
  { value: 'WITHDRAWN', label: 'Withdrawn' },
  { value: 'ALL', label: 'All' },
];

const lessonText = (l: TimetableRequestView['current']) =>
  l ? `${l.subject.name} — ${l.teacher.name}` : 'No lesson';

/**
 * Timetable change requests (Phase 12C). Class teachers ask for a change to one lesson of their
 * own class; administrators approve (the change goes into the draft, checked like any edit) or
 * decline. The published timetable changes only when an administrator publishes the draft.
 */
export function TimetableRequestsPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'PENDING';
  const list = useResource(`requests:${status}`, (signal) =>
    timetableRequestsApi.list(status, signal),
  );
  const options = useResource('request-options', (signal) =>
    timetableRequestsApi.options(null, signal),
  );
  const [creating, setCreating] = useState(false);
  const [declining, setDeclining] = useState<TimetableRequestView | null>(null);
  const [approving, setApproving] = useState<TimetableRequestView | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const canAsk = options.status === 'ready' && options.data.sections.length > 0;

  async function act(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    setActionError(null);
    try {
      await work();
      toast.show(done, 'success');
      setApproving(null);
      setDeclining(null);
      list.reload();
    } catch (error) {
      setActionError(messageOf(error));
      setApproving(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <TimetableLayout
      title="Timetable requests"
      description="Class teachers ask for a change to their class's timetable; an administrator approves it into the draft or declines it. Approved changes go live when the draft is published."
    >
      <Panel
        title="Requests"
        actions={
          canAsk ? (
            <Button icon={<Plus size={16} aria-hidden />} onClick={() => setCreating(true)}>
              Request a change
            </Button>
          ) : null
        }
      >
        <div className={styles.toolbar}>
          <SelectField
            label="Show"
            value={status}
            onChange={(e) =>
              setParams((p) => {
                const next = new URLSearchParams(p);
                next.set('status', e.target.value);
                return next;
              })
            }
            options={FILTERS}
          />
        </div>
        {actionError && <Alert tone="error">{actionError}</Alert>}
        {list.status === 'loading' && <LoadingState label="Loading requests…" />}
        {list.status === 'error' && <ErrorState message={list.error} onRetry={list.reload} />}
        {list.status === 'ready' &&
          (list.data.items.length === 0 ? (
            <EmptyState icon={Inbox} title="No requests">
              {status === 'PENDING'
                ? 'Nothing is waiting for review.'
                : 'There are no requests with this status.'}
            </EmptyState>
          ) : (
            <ul className={styles.requestList}>
              {list.data.items.map((r) => (
                <li key={r.id} className={styles.requestItem}>
                  <div className={styles.requestHead}>
                    <strong>
                      {r.section.label} · {WEEKDAY_LABELS[r.day].long}, {r.period.label}
                    </strong>
                    <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                  </div>
                  <dl className={styles.requestFacts}>
                    <div>
                      <dt>Asked for</dt>
                      <dd>{KIND[r.kind]}</dd>
                    </div>
                    <div>
                      <dt>Now</dt>
                      <dd>{lessonText(r.current)}</dd>
                    </div>
                    {r.proposed && (
                      <div>
                        <dt>Proposed</dt>
                        <dd>{lessonText(r.proposed)}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Reason</dt>
                      <dd>{r.reason}</dd>
                    </div>
                    <div>
                      <dt>Requested</dt>
                      <dd>
                        {r.requestedBy}, {formatDateTime(r.requestedAt)}
                      </dd>
                    </div>
                    {r.reviewedAt && (
                      <div>
                        <dt>Reviewed</dt>
                        <dd>
                          {r.reviewedBy}, {formatDateTime(r.reviewedAt)}
                          {r.reviewNote ? ` — ${r.reviewNote}` : ''}
                        </dd>
                      </div>
                    )}
                  </dl>
                  {(r.canReview || r.canWithdraw) && (
                    <div className={styles.requestActions}>
                      {r.canReview && (
                        <>
                          <Button size="sm" onClick={() => setApproving(r)} disabled={busy}>
                            Approve into draft
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setDeclining(r)}
                            disabled={busy}
                          >
                            Decline
                          </Button>
                        </>
                      )}
                      {r.canWithdraw && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              () => timetableRequestsApi.withdraw(r.id, r.revision),
                              'Request withdrawn.',
                            )
                          }
                        >
                          Withdraw
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ))}
      </Panel>

      {options.status === 'ready' && (
        <CreateDialog
          open={creating}
          options={options.data}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            toast.show('Request sent to the administrators.', 'success');
            list.reload();
            options.reload();
          }}
        />
      )}
      <ConfirmDialog
        open={approving !== null}
        title="Approve this change?"
        confirmLabel="Approve into draft"
        pending={busy}
        onCancel={() => setApproving(null)}
        onConfirm={() =>
          approving &&
          void act(
            () => timetableRequestsApi.approve(approving.id, approving.revision, null),
            'Approved. The change is in the draft; publish the draft to make it live.',
          )
        }
      >
        The change is checked like any timetable edit (teacher qualified, no clashes) and added to
        the draft. Nothing changes for teachers and students until you publish the draft.
      </ConfirmDialog>
      <DeclineDialog
        request={declining}
        onClose={() => setDeclining(null)}
        onDone={() => {
          setDeclining(null);
          toast.show('Request declined.', 'success');
          list.reload();
        }}
      />
    </TimetableLayout>
  );
}

const CREATE_FIELDS = ['sectionId', 'day', 'periodId', 'kind', 'subjectId', 'teacherId', 'reason'];

function CreateDialog({
  open,
  options,
  onClose,
  onCreated,
}: {
  open: boolean;
  options: TimetableRequestOptions;
  onClose: () => void;
  onCreated: () => void;
}) {
  const blank = {
    sectionId: options.sections[0]?.id ?? '',
    day: options.days[0] ?? '',
    periodId: options.periods[0]?.id ?? '',
    kind: 'CHANGE',
    subjectId: '',
    teacherId: '',
    reason: '',
  };
  const [values, setValues] = useState(blank);
  const form = useFormSubmit(CREATE_FIELDS);
  const set = (key: keyof typeof blank) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));
  const teachers = options.teachers.filter(
    (t) => !values.subjectId || t.subjectIds.includes(values.subjectId),
  );

  async function submit() {
    const input = form.check(TimetableRequestCreateSchema, {
      ...values,
      academicYearId: options.academicYear?.id,
      subjectId: values.kind === 'REMOVE' ? null : values.subjectId || null,
      teacherId: values.kind === 'REMOVE' ? null : values.teacherId || null,
    });
    if (!input) return;
    const result = await form.run(() => timetableRequestsApi.create(input));
    if (result.ok) {
      setValues(blank);
      onCreated();
    }
  }

  return (
    <FormDialog
      open={open}
      title="Request a timetable change"
      description={`For your own class only. ${options.activeCount} of ${options.activeLimit} requests waiting.`}
      submitLabel="Send request"
      pendingLabel="Sending…"
      pending={form.pending}
      error={form.formError}
      onSubmit={() => void submit()}
      onClose={() => {
        form.reset();
        onClose();
      }}
    >
      <SelectField
        label="Class"
        value={values.sectionId}
        onChange={set('sectionId')}
        error={form.errors.sectionId}
        options={options.sections.map((s) => ({ value: s.id, label: s.label }))}
      />
      <SelectField
        label="Day"
        value={values.day}
        onChange={set('day')}
        error={form.errors.day}
        options={options.days.map((d) => ({ value: d, label: WEEKDAY_LABELS[d].long }))}
      />
      <SelectField
        label="Period"
        value={values.periodId}
        onChange={set('periodId')}
        error={form.errors.periodId}
        options={options.periods.map((p) => ({ value: p.id, label: p.label }))}
      />
      <SelectField
        label="What should change"
        value={values.kind}
        onChange={set('kind')}
        error={form.errors.kind}
        options={Object.entries(KIND).map(([value, label]) => ({ value, label }))}
      />
      {values.kind !== 'REMOVE' && (
        <>
          <SelectField
            label="Subject"
            value={values.subjectId}
            onChange={(e) => setValues((v) => ({ ...v, subjectId: e.target.value, teacherId: '' }))}
            error={form.errors.subjectId}
            placeholder="Choose a subject"
            options={options.subjects.map((s) => ({ value: s.id, label: s.name }))}
          />
          <SelectField
            label="Teacher"
            value={values.teacherId}
            onChange={set('teacherId')}
            error={form.errors.teacherId}
            placeholder="Choose a teacher"
            hint="Only teachers who teach the chosen subject are listed."
            options={teachers.map((t) => ({ value: t.id, label: t.name }))}
          />
        </>
      )}
      <TextAreaField
        label="Reason"
        value={values.reason}
        onChange={set('reason')}
        error={form.errors.reason}
        maxLength={500}
        rows={3}
      />
    </FormDialog>
  );
}

function DeclineDialog({
  request,
  onClose,
  onDone,
}: {
  request: TimetableRequestView | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const form = useFormSubmit(['note']);
  return (
    <FormDialog
      open={request !== null}
      title="Decline this request"
      description="The class teacher sees your reason."
      submitLabel="Decline"
      pending={form.pending}
      error={form.formError}
      onSubmit={() =>
        request &&
        void form
          .run(() => timetableRequestsApi.decline(request.id, request.revision, note))
          .then((r) => {
            if (r.ok) {
              setNote('');
              onDone();
            }
          })
      }
      onClose={() => {
        form.reset();
        onClose();
      }}
    >
      <TextAreaField
        label="Reason for declining"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        error={form.errors.note}
        maxLength={500}
        rows={3}
      />
    </FormDialog>
  );
}
