import { useState } from 'react';
import { Link } from 'react-router';
import {
  PeriodCreateSchema,
  PeriodUpdateSchema,
  type AcademicYearView,
  type DayStructureView,
  type PeriodView,
} from '@ttlmhss/shared';
import { Clock, Coffee, Plus } from 'lucide-react';
import { Panel } from '../../../components/layout/Page';
import {
  Badge,
  Button,
  CheckboxField,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FormDialog,
  LoadingState,
  SelectField,
  StatusBadge,
  TextField,
  useToast,
} from '../../../components/ui';
import { WEEKDAY_LABELS, minutesBetween } from '../../../lib/format';
import { useFormSubmit } from '../../../lib/use-form-submit';
import { messageOf, useResource } from '../../../lib/use-resource';
import { AdminLayout } from '../AdminLayout';
import { adminHref } from '../admin-pages';
import { dayStructure } from '../api';
import { YearGate, YearSelect, useYearSelection } from '../year-selection';
import styles from '../admin.module.css';

type Dialog = { kind: 'LESSON' | 'BREAK'; slot: null } | { kind: 'edit'; slot: PeriodView };

export function PeriodsPage() {
  const selection = useYearSelection();
  return (
    <AdminLayout
      page="periods"
      description="The school day for each academic year: teaching periods (P1, P2 …) and breaks, with their times. Times may touch but must not overlap."
    >
      <YearGate selection={selection}>
        {(year, years) => (
          <>
            <div className={styles.toolbar}>
              <YearSelect years={years} year={year} onChange={selection.select} />
            </div>
            <DayStructure key={year.id} year={year} years={years} />
          </>
        )}
      </YearGate>
    </AdminLayout>
  );
}

function DayStructure({
  year,
  years,
}: {
  year: AcademicYearView;
  years: readonly AcademicYearView[];
}) {
  const day = useResource(`day:${year.id}`, (signal) => dayStructure.get(year.id, signal));
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [removing, setRemoving] = useState<PeriodView | null>(null);
  const [pending, setPending] = useState(false);
  const toast = useToast();

  async function remove() {
    if (!removing) return;
    setPending(true);
    try {
      day.replace(await dayStructure.remove(removing.id));
      toast.show(`${removing.label} removed`);
      setRemoving(null);
    } catch (error) {
      toast.show(messageOf(error), 'error');
    } finally {
      setPending(false);
    }
  }

  if (day.status === 'loading') return <LoadingState />;
  if (day.status === 'error') return <ErrorState message={day.error} onRetry={day.reload} />;
  const slots = day.data.slots;
  const lessons = slots.filter((s) => s.kind === 'LESSON' && s.status === 'ACTIVE').length;

  return (
    <>
      <Panel title="Working days">
        <p>
          {year.workingDays ? (
            year.workingDays.map((d) => WEEKDAY_LABELS[d].long).join(', ')
          ) : (
            <span className={styles.muted}>Not set yet.</span>
          )}{' '}
          <Link to={adminHref('years')}>Change on Academic years</Link>
        </p>
      </Panel>

      <Panel
        title={`Day structure for ${year.label}`}
        description={
          slots.length
            ? `${lessons} teaching ${lessons === 1 ? 'period' : 'periods'} a day. The order follows the start times.`
            : undefined
        }
        actions={
          <>
            <Button
              size="sm"
              icon={<Plus size={16} aria-hidden="true" />}
              onClick={() => setDialog({ kind: 'LESSON', slot: null })}
            >
              Add period
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<Coffee size={16} aria-hidden="true" />}
              onClick={() => setDialog({ kind: 'BREAK', slot: null })}
            >
              Add break
            </Button>
          </>
        }
      >
        {slots.length === 0 ? (
          <EmptyDay year={year} years={years} onCopied={day.replace} />
        ) : (
          <div className={styles.tableWrap}>
            <table className={`${styles.table} ${styles.stacked}`}>
              <thead>
                <tr>
                  <th scope="col">Period</th>
                  <th scope="col">Name</th>
                  <th scope="col">Time</th>
                  <th scope="col" className={styles.num}>
                    Minutes
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {slots.map((slot) => (
                  <tr
                    key={slot.id}
                    className={slot.kind === 'BREAK' ? styles.breakRow : undefined}
                    data-muted={slot.status !== 'ACTIVE' || undefined}
                  >
                    <td className={styles.strong}>
                      {slot.kind === 'LESSON' ? `P${slot.periodNumber}` : <Badge>Break</Badge>}
                    </td>
                    <td data-label="Name">{slot.label}</td>
                    <td data-label="Time" className={styles.nowrap}>
                      {slot.startTime} – {slot.endTime}
                    </td>
                    <td data-label="Minutes" className={styles.num}>
                      {minutesBetween(slot.startTime, slot.endTime)}
                    </td>
                    <td data-label="Status">
                      <StatusBadge status={slot.status} />
                    </td>
                    <td data-actions="">
                      <div className={styles.rowActions}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDialog({ kind: 'edit', slot })}
                        >
                          Edit<span className="visually-hidden"> {slot.label}</span>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setRemoving(slot)}>
                          Remove<span className="visually-hidden"> {slot.label}</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {dialog && (
        <SlotDialog
          year={year}
          day={day.data}
          dialog={dialog}
          onClose={() => setDialog(null)}
          onSaved={(next, message) => {
            setDialog(null);
            day.replace(next);
            toast.show(message);
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.label ?? ''}?`}
        confirmLabel="Remove"
        tone="danger"
        pending={pending}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      >
        <p>
          It will no longer be part of the {year.label} school day. Once timetables use a period,
          make it inactive instead.
        </p>
      </ConfirmDialog>
    </>
  );
}

function EmptyDay({
  year,
  years,
  onCopied,
}: {
  year: AcademicYearView;
  years: readonly AcademicYearView[];
  onCopied: (day: DayStructureView) => void;
}) {
  const others = years.filter((y) => y.id !== year.id);
  const [from, setFrom] = useState(others[0]?.id ?? '');
  const form = useFormSubmit(['fromAcademicYearId']);
  const toast = useToast();

  async function copy() {
    const result = await form.run(() => dayStructure.copy(year.id, from));
    if (result.ok) {
      onCopied(result.value);
      toast.show(`Periods copied into ${year.label}`);
    }
  }

  return (
    <EmptyState icon={Clock} title={`No periods for ${year.label} yet`}>
      <p>Add the periods and breaks of a school day.</p>
      {others.length > 0 && (
        <div className={styles.copyRow}>
          <SelectField
            label="Or copy them from"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            options={others.map((y) => ({ value: y.id, label: y.label }))}
            error={form.formError ?? form.errors.fromAcademicYearId}
          />
          <Button variant="secondary" loading={form.pending} onClick={() => void copy()}>
            Copy periods
          </Button>
        </div>
      )}
    </EmptyState>
  );
}

function SlotDialog({
  year,
  day,
  dialog,
  onClose,
  onSaved,
}: {
  year: AcademicYearView;
  day: DayStructureView;
  dialog: Dialog;
  onClose: () => void;
  onSaved: (day: DayStructureView, message: string) => void;
}) {
  const editing = dialog.kind === 'edit' ? dialog.slot : null;
  const kind = editing ? editing.kind : (dialog.kind as 'LESSON' | 'BREAK');
  const last = day.slots.at(-1);
  const nextNumber =
    Math.max(0, ...day.slots.map((s) => s.periodNumber ?? 0)) + (kind === 'LESSON' ? 1 : 0);
  const [values, setValues] = useState({
    periodNumber:
      editing?.periodNumber?.toString() ?? (kind === 'LESSON' ? String(nextNumber) : ''),
    label: editing?.label ?? (kind === 'LESSON' ? `Period ${nextNumber}` : ''),
    startTime: editing?.startTime ?? last?.endTime ?? '',
    endTime: editing?.endTime ?? '',
  });
  const [active, setActive] = useState((editing?.status ?? 'ACTIVE') === 'ACTIVE');
  const form = useFormSubmit(['periodNumber', 'label', 'startTime', 'endTime']);
  const set = (name: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [name]: e.target.value }));
  const noun = kind === 'LESSON' ? 'period' : 'break';

  async function submit() {
    const input = {
      label: values.label,
      startTime: values.startTime,
      endTime: values.endTime,
      ...(kind === 'LESSON'
        ? { periodNumber: values.periodNumber === '' ? null : Number(values.periodNumber) }
        : {}),
    };
    if (editing) {
      const body = form.check(PeriodUpdateSchema, {
        ...input,
        status: active ? 'ACTIVE' : 'INACTIVE',
      });
      if (!body) return;
      const result = await form.run(() => dayStructure.update(editing.id, body));
      if (result.ok) onSaved(result.value, `${values.label} saved`);
    } else {
      const body = form.check(PeriodCreateSchema, { kind, ...input });
      if (!body) return;
      const result = await form.run(() => dayStructure.create(year.id, body));
      if (result.ok) onSaved(result.value, `${values.label} added`);
    }
  }

  return (
    <FormDialog
      open
      title={editing ? `Edit ${editing.label}` : `Add a ${noun} to ${year.label}`}
      submitLabel={editing ? 'Save changes' : `Add ${noun}`}
      pending={form.pending}
      error={form.formError}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <div className={styles.formGrid}>
        {kind === 'LESSON' && (
          <TextField
            label="Period number"
            type="number"
            inputMode="numeric"
            min={1}
            max={20}
            value={values.periodNumber}
            onChange={set('periodNumber')}
            error={form.errors.periodNumber}
          />
        )}
        <TextField
          label="Name"
          hint={kind === 'BREAK' ? 'For example Short break or Lunch.' : undefined}
          maxLength={40}
          value={values.label}
          onChange={set('label')}
          error={form.errors.label}
          className={kind === 'BREAK' ? styles.span2 : undefined}
          autoFocus
        />
        <TextField
          label="Starts"
          type="time"
          value={values.startTime}
          onChange={set('startTime')}
          error={form.errors.startTime}
        />
        <TextField
          label="Ends"
          type="time"
          value={values.endTime}
          onChange={set('endTime')}
          error={form.errors.endTime}
        />
      </div>
      {editing && (
        <CheckboxField
          label="Active"
          hint={`Inactive ${noun}s are kept for history and ignored for the day's timing.`}
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
      )}
    </FormDialog>
  );
}
