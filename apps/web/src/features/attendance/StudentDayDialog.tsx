import { useState } from 'react';
import { LEAVE_REASON_LABELS, LeaveReason, type AttendanceStudentDayView } from '@ttlmhss/shared';
import {
  Alert,
  ErrorState,
  FormDialog,
  LoadingState,
  SelectField,
  TextAreaField,
  TextField,
} from '../../components/ui';
import { messageOf, useResource } from '../../lib/use-resource';
import { attendanceApi } from './api';
import { CountsLine, StatusMark, formatLessonDate, formatTime } from './attendance-shared';
import styles from './attendance.module.css';

/**
 * A student's day (class teacher / administrator): every lesson period with its status, and Leave
 * or Excused (C) applied to several periods at once. Each period stays its own record.
 */
export function StudentDayDialog({
  studentId,
  date,
  onClose,
  onSaved,
}: {
  studentId: string;
  date: string;
  onClose: () => void;
  onSaved: (view: AttendanceStudentDayView) => void;
}) {
  const view = useResource(`att-student-day:${studentId}:${date}`, (signal) =>
    attendanceApi.studentDay(studentId, date, signal),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<'L' | 'C'>('L');
  const [reason, setReason] = useState<LeaveReason | ''>('');
  const [note, setNote] = useState('');
  const [override, setOverride] = useState('');
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const d = view.status === 'ready' ? view.data : null;
  const needsOverride = d?.access.locked && d.access.canOverride;
  const errors = {
    periods: selected.size === 0 ? 'Choose at least one period' : undefined,
    reason: status === 'L' && !reason ? 'Choose a leave reason' : undefined,
    note:
      status === 'L' && reason === 'OTHER' && !note.trim()
        ? 'Describe the reason for "Other"'
        : undefined,
    override:
      needsOverride && !override.trim() ? 'A reason is required for an override' : undefined,
  };
  const invalid = Object.values(errors).some(Boolean);
  const show = (k: keyof typeof errors) => (touched ? errors[k] : undefined);

  async function submit() {
    setTouched(true);
    if (invalid || !d) return;
    setPending(true);
    setError(null);
    try {
      const result = await attendanceApi.saveStudentDay({
        studentId,
        date,
        periodIds: [...selected],
        status,
        leaveReason: status === 'L' ? (reason as LeaveReason) : null,
        note: note.trim() || null,
        ...(needsOverride ? { override: { reason: override.trim() } } : {}),
      });
      onSaved(result);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <FormDialog
      open
      wide
      title={d ? `${d.student.fullName} — ${formatLessonDate(date)}` : 'Student day'}
      submitLabel={status === 'L' ? 'Apply leave' : 'Apply excused (C)'}
      pendingLabel="Saving…"
      pending={pending}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
      description={
        d && (
          <p className={styles.hint}>
            {d.section.className} {d.section.sectionName} · Admission no.{' '}
            {d.student.admissionNumber}
            {d.student.rollNumber ? ` · Roll ${d.student.rollNumber}` : ''}
          </p>
        )
      }
    >
      {view.status === 'loading' && <LoadingState />}
      {view.status === 'error' && <ErrorState message={view.error} onRetry={view.reload} />}
      {d && (
        <>
          <CountsLine counts={d.counts} />
          {d.access.readOnlyReason && <Alert tone="info">{d.access.readOnlyReason}</Alert>}
          <fieldset className={styles.periodChecks}>
            <legend className={styles.hint}>Periods</legend>
            {d.periods.map((p) => (
              <label key={p.period.id} className={styles.periodCheck}>
                <input
                  type="checkbox"
                  checked={selected.has(p.period.id)}
                  disabled={!d.access.editable || pending}
                  onChange={(e) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(p.period.id);
                      else next.delete(p.period.id);
                      return next;
                    })
                  }
                />
                <span>
                  <strong>{p.period.label}</strong> · {formatTime(p.period.startTime)} ·{' '}
                  {p.subject.name}
                  <span className={styles.nameMeta}>{p.teacher.fullName}</span>
                </span>
                <StatusMark status={p.status} />
              </label>
            ))}
            {show('periods') && <p className={styles.hint}>{show('periods')}</p>}
          </fieldset>
          {d.access.editable && (
            <>
              <SelectField
                label="Apply"
                value={status}
                onChange={(e) => setStatus(e.target.value === 'C' ? 'C' : 'L')}
                options={[
                  { value: 'L', label: 'L — Leave' },
                  { value: 'C', label: 'C — Permission / excused' },
                ]}
              />
              {status === 'L' && (
                <SelectField
                  label="Leave reason"
                  required
                  value={reason}
                  placeholder="Choose…"
                  error={show('reason')}
                  onChange={(e) => setReason(LeaveReason.is(e.target.value) ? e.target.value : '')}
                  options={LeaveReason.values.map((r) => ({
                    value: r,
                    label: LEAVE_REASON_LABELS[r],
                  }))}
                />
              )}
              <TextField
                label={status === 'L' && reason === 'OTHER' ? 'Description' : 'Note (optional)'}
                required={status === 'L' && reason === 'OTHER'}
                value={note}
                maxLength={300}
                error={show('note')}
                onChange={(e) => setNote(e.target.value)}
              />
              {needsOverride && (
                <TextAreaField
                  label="Override reason (this date is locked)"
                  required
                  value={override}
                  maxLength={300}
                  error={show('override')}
                  onChange={(e) => setOverride(e.target.value)}
                />
              )}
            </>
          )}
        </>
      )}
    </FormDialog>
  );
}
