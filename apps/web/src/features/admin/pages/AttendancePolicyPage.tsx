import { useState, type FormEvent } from 'react';
import {
  AttendancePolicyUpdateSchema,
  attendanceLockDate,
  type AttendanceLockMode,
  type AttendancePolicyView,
} from '@ttlmhss/shared';
import { Panel } from '../../../components/layout/Page';
import {
  Alert,
  Button,
  ErrorState,
  LoadingState,
  TextField,
  useToast,
} from '../../../components/ui';
import { formatLongDate, formatMonth, previousDay } from '../../../lib/format';
import { useFormSubmit } from '../../../lib/use-form-submit';
import { useResource } from '../../../lib/use-resource';
import { AdminLayout } from '../AdminLayout';
import { attendancePolicy } from '../api';
import styles from '../admin.module.css';

export function AttendancePolicyPage() {
  const policy = useResource('attendance-policy', (signal) => attendancePolicy.get(signal));
  return (
    <AdminLayout
      page="attendance"
      description="Attendance stays editable for a while after each month ends, then locks. After that only an administrator can change it, and every change is recorded in the audit log."
    >
      {policy.status === 'loading' && <LoadingState />}
      {policy.status === 'error' && <ErrorState message={policy.error} onRetry={policy.reload} />}
      {policy.status === 'ready' && <PolicyForm initial={policy.data} onSaved={policy.replace} />}
    </AdminLayout>
  );
}

const MODES: { value: AttendanceLockMode; label: string; hint: string }[] = [
  {
    value: 'MONTHLY_CUTOFF',
    label: 'Lock each month after a cutoff day',
    hint: 'Teachers can correct a month’s attendance until the cutoff day of the next month.',
  },
  {
    value: 'NO_LOCK',
    label: 'Do not lock attendance',
    hint: 'Attendance can be changed at any time by the people allowed to mark it.',
  },
];

function PolicyForm({
  initial,
  onSaved,
}: {
  initial: AttendancePolicyView | null;
  onSaved: (p: AttendancePolicyView) => void;
}) {
  const [mode, setMode] = useState<AttendanceLockMode>(initial?.mode ?? 'MONTHLY_CUTOFF');
  const [cutoff, setCutoff] = useState(String(initial?.cutoffDay ?? ''));
  const form = useFormSubmit(['mode', 'cutoffDay']);
  const toast = useToast();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const body = form.check(AttendancePolicyUpdateSchema, {
      mode,
      // With no locking the day is unused; keep the stored one (or 1) so it is valid.
      cutoffDay: mode === 'NO_LOCK' && cutoff === '' ? 1 : Number(cutoff === '' ? NaN : cutoff),
    });
    if (!body) return;
    const result = await form.run(() => attendancePolicy.save(body));
    if (result.ok) {
      onSaved(result.value);
      toast.show('Attendance locking saved');
    }
  }

  // Preview for last month, based on today's date.
  const today = new Date();
  const month = today.getMonth() === 0 ? 12 : today.getMonth();
  const year = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
  const day = Number(cutoff);
  const lock =
    mode === 'MONTHLY_CUTOFF' && Number.isInteger(day) && day >= 1 && day <= 28
      ? attendanceLockDate({ mode, cutoffDay: day }, year, month)
      : null;

  return (
    <form onSubmit={onSubmit} noValidate className={styles.stack}>
      {!initial && (
        <Alert tone="info" title="Not set up yet">
          Until a rule is saved, attendance is never locked.
        </Alert>
      )}
      {form.formError && <Alert tone="error">{form.formError}</Alert>}
      <Panel title="Locking rule">
        <div className={styles.stackTight}>
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>When does attendance lock?</legend>
            <div className={styles.permList}>
              {MODES.map((m) => (
                <div key={m.value} className={styles.radioRow}>
                  <input
                    type="radio"
                    id={`mode-${m.value}`}
                    name="mode"
                    value={m.value}
                    checked={mode === m.value}
                    onChange={() => setMode(m.value)}
                    aria-describedby={`mode-${m.value}-hint`}
                  />
                  <div>
                    <label htmlFor={`mode-${m.value}`} className={styles.strong}>
                      {m.label}
                    </label>
                    <p id={`mode-${m.value}-hint`} className={styles.meta}>
                      {m.hint}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </fieldset>
          {mode === 'MONTHLY_CUTOFF' && (
            <TextField
              label="Cutoff day of the following month"
              hint="1 to 28, so it exists in every month. Editing is allowed up to and including this day."
              type="number"
              inputMode="numeric"
              min={1}
              max={28}
              value={cutoff}
              onChange={(e) => setCutoff(e.target.value)}
              error={form.errors.cutoffDay}
              className={styles.narrowField}
            />
          )}
          <div className={styles.preview} aria-live="polite">
            <p className={styles.strong}>Example</p>
            {mode === 'NO_LOCK' ? (
              <p>Attendance for {formatMonth(year, month)} can be changed at any time.</p>
            ) : lock ? (
              <p>
                Attendance for {formatMonth(year, month)} can be changed until{' '}
                {formatLongDate(previousDay(lock))}. From {formatLongDate(lock)} it is locked.
              </p>
            ) : (
              <p className={styles.muted}>Enter a cutoff day to see an example.</p>
            )}
          </div>
        </div>
      </Panel>
      <div className={styles.formActions}>
        <Button type="submit" loading={form.pending} loadingLabel="Saving…">
          Save rule
        </Button>
      </div>
    </form>
  );
}
