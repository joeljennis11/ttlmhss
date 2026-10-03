import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  ATTENDANCE_STATUS_DESCRIPTIONS,
  LEAVE_REASON_LABELS,
  LeaveReason,
  type AttendanceRegisterView,
  type AttendanceRow,
  type AttendanceStatus,
} from '@ttlmhss/shared';
import { CheckCheck, Save } from 'lucide-react';
import { Panel } from '../../../components/layout/Page';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  ErrorState,
  LoadingState,
  SelectField,
  TextAreaField,
  TextField,
  useToast,
} from '../../../components/ui';
import { ApiClientError } from '../../../lib/api-client';
import { formatDateTime } from '../../../lib/format';
import { messageOf, useResource } from '../../../lib/use-resource';
import { useAuth } from '../../auth/auth-context';
import { attendanceApi } from '../api';
import {
  AttendanceLayout,
  CountsLine,
  StatusLegend,
  StatusMark,
  formatLessonDate,
  formatTime,
  useLeaveGuard,
} from '../attendance-shared';
import styles from '../attendance.module.css';

interface Edit {
  status: AttendanceStatus;
  leaveReason: LeaveReason | null;
  note: string | null;
}

const MANAGED: readonly AttendanceStatus[] = ['L', 'C'];

/** Open a lesson's register: /attendance/register?date=…&periodId=…&sectionId=… */
export function RegisterPage() {
  const [params] = useSearchParams();
  const date = params.get('date') ?? '';
  const periodId = params.get('periodId') ?? '';
  const sectionId = params.get('sectionId') ?? '';
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && periodId !== '' && sectionId !== '';
  const view = useResource(
    valid ? `att-register:${date}:${periodId}:${sectionId}` : null,
    (signal) => attendanceApi.register(date, periodId, sectionId, signal),
  );
  const { user } = useAuth();
  const back = user?.permissions.includes('attendance.manage')
    ? { to: `/attendance/class?date=${date}&section=${sectionId}`, label: 'Class attendance' }
    : { to: `/attendance/lessons?date=${date}`, label: 'My lessons' };

  return (
    <AttendanceLayout
      title="Attendance register"
      eyebrow={
        <Link to={back.to} className={styles.hint}>
          ← {back.label}
        </Link>
      }
    >
      {!valid && (
        <ErrorState message="This link is incomplete. Open the register from your lessons." />
      )}
      {valid && view.status === 'loading' && <LoadingState />}
      {valid && view.status === 'error' && (
        <ErrorState message={view.error} onRetry={view.reload} />
      )}
      {valid && view.status === 'ready' && (
        <Register
          key={`${view.data.session?.revision ?? 0}`}
          view={view.data}
          onSaved={view.replace}
          onReload={view.reload}
        />
      )}
    </AttendanceLayout>
  );
}

function Register({
  view,
  onSaved,
  onReload,
}: {
  view: AttendanceRegisterView;
  onSaved: (v: AttendanceRegisterView) => void;
  onReload: () => void;
}) {
  const toast = useToast();
  const { context: c, access } = view;
  const [edits, setEdits] = useState<Map<string, Edit>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; stale: boolean } | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [touched, setTouched] = useState(false);

  const current = (row: AttendanceRow): Edit =>
    edits.get(row.studentId) ?? {
      status: row.status,
      leaveReason: row.leaveReason,
      note: row.note,
    };
  const changed = view.rows.filter((r) => {
    const e = edits.get(r.studentId);
    return (
      e &&
      (e.status !== r.status ||
        e.leaveReason !== r.leaveReason ||
        (e.note ?? null) !== (r.note ?? null))
    );
  });
  const dirty = changed.length > 0;
  const guard = useLeaveGuard(dirty);

  const set = (row: AttendanceRow, patch: Partial<Edit>) =>
    setEdits((prev) => {
      const next = new Map(prev);
      const base = current(row);
      const merged = { ...base, ...patch };
      if (merged.status !== 'L') merged.leaveReason = null;
      next.set(row.studentId, merged);
      return next;
    });

  const reasonError = (row: AttendanceRow) => {
    const e = current(row);
    if (e.status !== 'L') return null;
    if (!e.leaveReason) return 'Choose a leave reason';
    if (e.leaveReason === 'OTHER' && !e.note?.trim()) return 'Describe the reason for "Other"';
    return null;
  };
  const invalid = changed.some((r) => reasonError(r) !== null);

  /** Unmarked students → Present. Deliberate A / L / C (and P) are never overwritten. */
  function markAllPresent() {
    const targets = view.rows.filter((r) => r.editable && current(r).status === '-');
    const kept = view.rows.filter(
      (r) => r.editable && ['A', 'L', 'C'].includes(current(r).status),
    ).length;
    if (targets.length > 0) {
      setEdits((prev) => {
        const next = new Map(prev);
        for (const row of targets) {
          next.set(row.studentId, { status: 'P', leaveReason: null, note: current(row).note });
        }
        return next;
      });
    }
    toast.show(
      targets.length === 0
        ? 'Everyone is already marked.'
        : `${targets.length} unmarked student${targets.length === 1 ? '' : 's'} set to Present${kept ? `; ${kept} marked A, L or C kept as they are` : ''}. Not saved yet.`,
    );
  }

  async function save(override: string | null) {
    setTouched(true);
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      const result = await attendanceApi.save({
        date: c.date,
        periodId: c.period.id,
        sectionId: c.section.sectionId,
        revision: view.session?.revision ?? null,
        marks: changed.map((r) => ({ studentId: r.studentId, ...current(r) })),
        ...(override ? { override: { reason: override } } : {}),
      });
      setOverrideOpen(false);
      setOverrideReason('');
      setEdits(new Map());
      onSaved(result);
      toast.show('Attendance saved');
    } catch (e) {
      const stale =
        e instanceof ApiClientError && e.status === 409 && /while you were working/.test(e.message);
      setError({ message: messageOf(e), stale });
    } finally {
      setBusy(false);
    }
  }

  const onSave = () => {
    if (access.locked && access.canOverride) {
      setTouched(true);
      if (!invalid) setOverrideOpen(true);
    } else void save(null);
  };

  return (
    <>
      <Panel>
        <dl className={styles.context}>
          <div>
            <dt>Class</dt>
            <dd>
              {c.section.className} {c.section.sectionName}
            </dd>
          </div>
          <div>
            <dt>Subject</dt>
            <dd>{c.subject.name}</dd>
          </div>
          <div>
            <dt>Teacher</dt>
            <dd>{c.teacher.fullName}</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>{formatLessonDate(c.date)}</dd>
          </div>
          <div>
            <dt>Period</dt>
            <dd>
              {c.period.label} · {formatTime(c.period.startTime)} – {formatTime(c.period.endTime)}
            </dd>
          </div>
        </dl>
      </Panel>

      {access.readOnlyReason && <Alert tone="info">{access.readOnlyReason}</Alert>}
      {access.locked && access.canOverride && (
        <Alert tone="warning" title="Attendance for this date is locked">
          You can change it as an administrator. Saving asks you to confirm the override and give a
          reason; the override is recorded in the audit log.
        </Alert>
      )}
      {error && (
        <Alert tone="error" title={error.stale ? 'Someone else saved this register' : 'Not saved'}>
          {error.message}
          {error.stale && (
            <div>
              <Button variant="secondary" size="sm" onClick={onReload}>
                Reload the register (your unsaved changes are discarded)
              </Button>
            </div>
          )}
        </Alert>
      )}

      <Panel>
        <div className={styles.registerBar}>
          <div className={styles.stack} style={{ gap: 'var(--space-2)' }}>
            <CountsLine counts={view.counts} />
            <p className={styles.hint} aria-live="polite">
              {dirty ? (
                <Badge tone="info">
                  {changed.length} unsaved change{changed.length === 1 ? '' : 's'}
                </Badge>
              ) : view.session ? (
                `Saved ${formatDateTime(view.session.updatedAt)}${view.session.updatedBy ? ` by ${view.session.updatedBy}` : ''}.`
              ) : (
                'Not saved yet.'
              )}
            </p>
          </div>
          {access.editable && (
            <div className={styles.actions}>
              <Button
                variant="secondary"
                icon={<CheckCheck size={18} aria-hidden="true" />}
                onClick={markAllPresent}
                disabled={busy}
              >
                Mark all present
              </Button>
              {dirty && (
                <Button variant="ghost" onClick={() => setEdits(new Map())} disabled={busy}>
                  Discard changes
                </Button>
              )}
              <Button
                icon={<Save size={18} aria-hidden="true" />}
                onClick={onSave}
                disabled={!dirty}
                loading={busy && !overrideOpen}
                loadingLabel="Saving…"
              >
                Save attendance
              </Button>
            </div>
          )}
        </div>
      </Panel>

      <Panel title={`Students (${view.rows.length})`}>
        <div className={styles.stack} style={{ gap: 'var(--space-3)' }}>
          <StatusLegend />
          {view.rows.length === 0 ? (
            <p className={styles.hint}>No students are placed in this class on this date.</p>
          ) : (
            <ul className={styles.rows} aria-label="Students">
              <li className={styles.rowHead} aria-hidden="true">
                <span>Roll</span>
                <span>Admission no.</span>
                <span>Student</span>
                <span>Status</span>
              </li>
              {view.rows.map((row) => {
                const e = current(row);
                const options: AttendanceStatus[] = access.canManage
                  ? ['P', 'A', 'L', 'C', '-']
                  : ['P', 'A', '-'];
                const lockedByCt = !access.canManage && MANAGED.includes(row.status);
                const rowError = touched ? reasonError(row) : null;
                return (
                  <li
                    key={row.studentId}
                    className={styles.row}
                    data-unsaved={changed.includes(row) ? '' : undefined}
                  >
                    <span className={styles.roll}>{row.rollNumber ?? '—'}</span>
                    <span className={styles.admission}>{row.admissionNumber}</span>
                    <span className={styles.name}>
                      {row.fullName}
                      {!row.onRoll && (
                        <span className={styles.nameMeta}>No longer in this class</span>
                      )}
                      {row.updatedBy && !changed.includes(row) && (
                        <span className={styles.nameMeta}>Last changed by {row.updatedBy}</span>
                      )}
                    </span>
                    {lockedByCt || !row.editable ? (
                      <span className={styles.readOnlyStatus}>
                        <StatusMark status={e.status} />{' '}
                        {lockedByCt && (
                          <span className={styles.hint}>
                            {e.status === 'L' && e.leaveReason
                              ? `Leave (${LEAVE_REASON_LABELS[e.leaveReason]}) — `
                              : ''}
                            set by the class teacher
                          </span>
                        )}
                      </span>
                    ) : (
                      <fieldset className={styles.segmented}>
                        <legend>Attendance for {row.fullName}</legend>
                        {options.map((s) => (
                          <label key={s} className={styles.segment}>
                            <input
                              type="radio"
                              name={`status-${row.studentId}`}
                              value={s}
                              checked={e.status === s}
                              disabled={busy}
                              onChange={() => set(row, { status: s })}
                            />
                            <span title={ATTENDANCE_STATUS_DESCRIPTIONS[s]}>
                              <span aria-hidden="true">{s}</span>
                              <span className="visually-hidden">
                                {ATTENDANCE_STATUS_DESCRIPTIONS[s]}
                              </span>
                            </span>
                          </label>
                        ))}
                      </fieldset>
                    )}
                    {row.editable && !lockedByCt && (e.status === 'L' || e.status === 'C') && (
                      <div className={`${styles.reasonRow} ${styles.extra}`}>
                        {e.status === 'L' && (
                          <SelectField
                            label="Leave reason"
                            required
                            value={e.leaveReason ?? ''}
                            placeholder="Choose…"
                            error={rowError && !e.leaveReason ? rowError : undefined}
                            onChange={(ev) =>
                              set(row, {
                                leaveReason: LeaveReason.is(ev.target.value)
                                  ? ev.target.value
                                  : null,
                              })
                            }
                            options={LeaveReason.values.map((r) => ({
                              value: r,
                              label: LEAVE_REASON_LABELS[r],
                            }))}
                          />
                        )}
                        <TextField
                          label={
                            e.status === 'L' && e.leaveReason === 'OTHER'
                              ? 'Description'
                              : 'Note (optional)'
                          }
                          required={e.status === 'L' && e.leaveReason === 'OTHER'}
                          value={e.note ?? ''}
                          maxLength={300}
                          error={rowError && e.leaveReason ? rowError : undefined}
                          onChange={(ev) => set(row, { note: ev.target.value || null })}
                        />
                      </div>
                    )}
                    {!row.editable && e.note && (
                      <span className={`${styles.hint} ${styles.extra}`}>Note: {e.note}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Panel>

      <ConfirmDialog
        open={overrideOpen}
        title="Attendance for this date is locked"
        confirmLabel="Save with override"
        tone="danger"
        pending={busy}
        onCancel={() => setOverrideOpen(false)}
        onConfirm={() => {
          if (overrideReason.trim()) void save(overrideReason.trim());
        }}
      >
        <p>
          Continue with an administrator override? {changed.length} change
          {changed.length === 1 ? '' : 's'} will be saved and recorded with your reason.
        </p>
        <TextAreaField
          label="Reason for the override"
          required
          value={overrideReason}
          maxLength={300}
          error={overrideReason.trim() ? undefined : 'A reason is required'}
          onChange={(ev) => setOverrideReason(ev.target.value)}
        />
      </ConfirmDialog>
      {guard}
    </>
  );
}
