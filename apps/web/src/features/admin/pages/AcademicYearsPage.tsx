import { useState } from 'react';
import {
  AcademicYearCreateSchema,
  AcademicYearUpdateSchema,
  Weekday,
  WorkingDaysUpdateSchema,
  type AcademicYearView,
} from '@ttlmhss/shared';
import { CalendarRange, Plus } from 'lucide-react';
import { Panel } from '../../../components/layout/Page';
import {
  Button,
  CheckboxField,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FormDialog,
  LoadingState,
  StatusBadge,
  TextField,
  useToast,
} from '../../../components/ui';
import { WEEKDAY_LABELS, formatDate } from '../../../lib/format';
import { useFormSubmit } from '../../../lib/use-form-submit';
import { messageOf, useResource } from '../../../lib/use-resource';
import { AdminLayout } from '../AdminLayout';
import { academicYears } from '../api';
import styles from '../admin.module.css';

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; year: AcademicYearView }
  | { kind: 'days'; year: AcademicYearView };
type Confirm = { kind: 'current' | 'delete'; year: AcademicYearView };

export function AcademicYearsPage() {
  const years = useResource('academic-years', (signal) => academicYears.list(signal));
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();

  async function runConfirm() {
    if (!confirm) return;
    setConfirming(true);
    try {
      if (confirm.kind === 'current') {
        await academicYears.makeCurrent(confirm.year.id);
        toast.show(`${confirm.year.label} is now the current academic year`);
      } else {
        await academicYears.remove(confirm.year.id);
        toast.show(`${confirm.year.label} deleted`);
      }
      setConfirm(null);
      years.reload();
    } catch (error) {
      toast.show(messageOf(error), 'error');
    } finally {
      setConfirming(false);
    }
  }

  const current = years.status === 'ready' ? years.data.find((y) => y.status === 'CURRENT') : null;

  return (
    <AdminLayout
      page="years"
      actions={
        <Button
          icon={<Plus size={18} aria-hidden="true" />}
          onClick={() => setDialog({ kind: 'create' })}
        >
          Add academic year
        </Button>
      }
    >
      {years.status === 'loading' && <LoadingState />}
      {years.status === 'error' && <ErrorState message={years.error} onRetry={years.reload} />}
      {years.status === 'ready' &&
        (years.data.length === 0 ? (
          <Panel>
            <EmptyState icon={CalendarRange} title="No academic years yet">
              Add the first academic year, then make it the current year. Timetables, attendance and
              exams all belong to an academic year.
            </EmptyState>
          </Panel>
        ) : (
          <Panel
            title="All academic years"
            description={
              current
                ? `${current.label} is the current year. Changing it is a deliberate step: other modules show data for the current year.`
                : 'No year is current yet. Choose “Make current” on the year the school is in now.'
            }
          >
            <div className={styles.tableWrap}>
              <table className={`${styles.table} ${styles.stacked}`}>
                <thead>
                  <tr>
                    <th scope="col">Year</th>
                    <th scope="col">Dates</th>
                    <th scope="col">Working days</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {years.data.map((year) => (
                    <tr key={year.id}>
                      <td className={styles.strong}>{year.label}</td>
                      <td data-label="Dates" className={styles.nowrap}>
                        {formatDate(year.startDate)} – {formatDate(year.endDate)}
                      </td>
                      <td data-label="Working days">
                        {year.workingDays ? (
                          year.workingDays.map((d) => WEEKDAY_LABELS[d].short).join(', ')
                        ) : (
                          <span className={styles.muted}>Not set</span>
                        )}
                      </td>
                      <td data-label="Status">
                        <StatusBadge status={year.status} />
                      </td>
                      <td data-actions="">
                        <div className={styles.rowActions}>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDialog({ kind: 'edit', year })}
                          >
                            Edit<span className="visually-hidden"> {year.label}</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDialog({ kind: 'days', year })}
                          >
                            Working days<span className="visually-hidden"> for {year.label}</span>
                          </Button>
                          {year.status !== 'CURRENT' && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setConfirm({ kind: 'current', year })}
                            >
                              Make current<span className="visually-hidden"> ({year.label})</span>
                            </Button>
                          )}
                          {year.status !== 'CURRENT' && !year.inUse && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirm({ kind: 'delete', year })}
                            >
                              Delete<span className="visually-hidden"> {year.label}</span>
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ))}

      {dialog && dialog.kind !== 'days' && (
        <YearDialog
          year={dialog.kind === 'edit' ? dialog.year : null}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setDialog(null);
            years.reload();
            toast.show(dialog.kind === 'edit' ? `${saved.label} saved` : `${saved.label} added`);
          }}
        />
      )}
      {dialog?.kind === 'days' && (
        <WorkingDaysDialog
          year={dialog.year}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setDialog(null);
            years.reload();
            toast.show(`Working days saved for ${saved.label}`);
          }}
        />
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm?.kind === 'current'
            ? `Make ${confirm.year.label} the current year?`
            : `Delete ${confirm?.year.label ?? ''}?`
        }
        confirmLabel={confirm?.kind === 'current' ? 'Make current' : 'Delete year'}
        tone={confirm?.kind === 'delete' ? 'danger' : 'primary'}
        pending={confirming}
        onConfirm={() => void runConfirm()}
        onCancel={() => setConfirm(null)}
      >
        {confirm?.kind === 'current' ? (
          <p>
            {current
              ? `${current.label} will stop being the current year. Its records are kept. `
              : ''}
            Pages across the app will use {confirm.year.label} as the current year.
          </p>
        ) : (
          <p>This year has no records yet, so it can be deleted. This cannot be undone.</p>
        )}
      </ConfirmDialog>
    </AdminLayout>
  );
}

function YearDialog({
  year,
  onClose,
  onSaved,
}: {
  year: AcademicYearView | null;
  onClose: () => void;
  onSaved: (year: AcademicYearView) => void;
}) {
  const [values, setValues] = useState({
    label: year?.label ?? '',
    startDate: year?.startDate ?? '',
    endDate: year?.endDate ?? '',
  });
  const form = useFormSubmit(['label', 'startDate', 'endDate']);
  const set = (name: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [name]: e.target.value }));

  async function submit() {
    const body = form.check(year ? AcademicYearUpdateSchema : AcademicYearCreateSchema, values);
    if (!body) return;
    const result = await form.run(() =>
      year ? academicYears.update(year.id, body) : academicYears.create(values),
    );
    if (result.ok) onSaved(result.value);
  }

  return (
    <FormDialog
      open
      title={year ? `Edit ${year.label}` : 'Add academic year'}
      submitLabel={year ? 'Save changes' : 'Add year'}
      pending={form.pending}
      error={form.formError}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <TextField
        label="Name"
        hint="For example 2026-27."
        maxLength={20}
        value={values.label}
        onChange={set('label')}
        error={form.errors.label}
        autoFocus
      />
      <div className={styles.formGrid}>
        <TextField
          label="First day"
          type="date"
          value={values.startDate}
          onChange={set('startDate')}
          error={form.errors.startDate}
        />
        <TextField
          label="Last day"
          type="date"
          value={values.endDate}
          onChange={set('endDate')}
          error={form.errors.endDate}
        />
      </div>
    </FormDialog>
  );
}

function WorkingDaysDialog({
  year,
  onClose,
  onSaved,
}: {
  year: AcademicYearView;
  onClose: () => void;
  onSaved: (year: AcademicYearView) => void;
}) {
  const [days, setDays] = useState<Set<Weekday>>(() => new Set(year.workingDays ?? []));
  const form = useFormSubmit([]);

  async function submit() {
    const ordered = Weekday.values.filter((d) => days.has(d));
    const body = form.check(WorkingDaysUpdateSchema, { workingDays: ordered });
    if (!body) return;
    const result = await form.run(() => academicYears.setWorkingDays(year.id, ordered));
    if (result.ok) onSaved(result.value);
  }

  return (
    <FormDialog
      open
      title={`Working days for ${year.label}`}
      description="The days the school teaches. Timetables and attendance use these days."
      submitLabel="Save working days"
      pending={form.pending}
      error={form.formError}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <fieldset className={styles.fieldset}>
        <legend className="visually-hidden">Working days</legend>
        <div className={styles.permList}>
          {Weekday.values.map((day) => (
            <CheckboxField
              key={day}
              label={WEEKDAY_LABELS[day].long}
              checked={days.has(day)}
              onChange={(e) =>
                setDays((current) => {
                  const next = new Set(current);
                  if (e.target.checked) next.add(day);
                  else next.delete(day);
                  return next;
                })
              }
            />
          ))}
        </div>
      </fieldset>
    </FormDialog>
  );
}
