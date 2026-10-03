import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  CALENDAR_DAY_STATUS_LABELS,
  CalendarEntryInputSchema,
  classesInRange,
  weekdayOf,
  weeklyWorking,
  type AcademicYearView,
  type CalendarDayStatus,
  type CalendarEntryView,
  type CalendarView,
} from '@ttlmhss/shared';
import {
  CalendarCheck,
  CalendarDays,
  CalendarX,
  ChevronLeft,
  ChevronRight,
  Plus,
} from 'lucide-react';
import { Panel } from '../../../components/layout/Page';
import {
  Alert,
  Button,
  CheckboxField,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FormDialog,
  LoadingState,
  SelectField,
  TextAreaField,
  TextField,
  useToast,
} from '../../../components/ui';
import { WEEKDAY_LABELS, formatDate, formatLongDate, formatMonth } from '../../../lib/format';
import { useFormSubmit } from '../../../lib/use-form-submit';
import { useMediaQuery } from '../../../lib/use-media-query';
import { messageOf, useResource } from '../../../lib/use-resource';
import { AdminLayout } from '../AdminLayout';
import { adminHref } from '../admin-pages';
import { calendar as calendarApi } from '../api';
import { YearGate, YearSelect, useYearSelection } from '../year-selection';
import admin from '../admin.module.css';
import styles from '../calendar.module.css';

/*
 * Academic calendar (Phase 8A). Dates are handled as plain 'YYYY-MM-DD' strings with UTC
 * arithmetic, so the browser's time zone can never move a school date.
 */

const WEEK: readonly (keyof typeof WEEKDAY_LABELS)[] = [
  'MON',
  'TUE',
  'WED',
  'THU',
  'FRI',
  'SAT',
  'SUN',
];
const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const monthKey = (date: string) => date.slice(0, 7);
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function shiftMonth(key: string, by: number): string {
  const [y, m] = key.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}
function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** What a day means for the school: the weekly pattern and any entries on it. */
function dayKind(entry: CalendarEntryView): 'holiday' | 'special' {
  return entry.status === 'HOLIDAY' ? 'holiday' : 'special';
}
const KIND_LABEL = { holiday: 'Holiday', special: 'Special working day' } as const;

export function AcademicCalendarPage() {
  const selection = useYearSelection();
  return (
    <AdminLayout
      page="calendar"
      description="The weekly working days are the default. Add holidays and special working days here — for the whole school, some classes or some sections. Attendance can only be taken on a class's working days."
    >
      <YearGate selection={selection}>
        {(year, years) => (
          <>
            <div className={admin.toolbar}>
              <YearSelect years={years} year={year} onChange={selection.select} />
            </div>
            <CalendarBody key={year.id} year={year} />
          </>
        )}
      </YearGate>
    </AdminLayout>
  );
}

type Dialog = { mode: 'add'; date: string } | { mode: 'edit'; entry: CalendarEntryView };

function CalendarBody({ year }: { year: AcademicYearView }) {
  const view = useResource(`calendar:${year.id}`, (signal) => calendarApi.get(year.id, signal));
  const toast = useToast();
  const today = todayIso();
  const firstMonth = monthKey(year.startDate);
  const lastMonth = monthKey(year.endDate);
  const [month, setMonth] = useState(() => {
    const t = monthKey(today);
    return t >= firstMonth && t <= lastMonth ? t : firstMonth;
  });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [removing, setRemoving] = useState<CalendarEntryView | null>(null);
  const [pending, setPending] = useState(false);

  async function remove() {
    if (!removing) return;
    setPending(true);
    try {
      view.replace(await calendarApi.remove(removing.id));
      toast.show(`${KIND_LABEL[dayKind(removing)]} on ${formatDate(removing.date)} removed`);
      setRemoving(null);
    } catch (error) {
      toast.show(messageOf(error), 'error');
    } finally {
      setPending(false);
    }
  }

  if (view.status === 'loading') return <LoadingState />;
  if (view.status === 'error') return <ErrorState message={view.error} onRetry={view.reload} />;
  const cal = view.data;
  const noWeekly = !cal.academicYear.workingDays || cal.academicYear.workingDays.length === 0;
  const defaultDate =
    month === monthKey(today) && today >= year.startDate && today <= year.endDate
      ? today
      : month === firstMonth
        ? year.startDate
        : `${month}-01`;

  return (
    <>
      <Panel title="Weekly pattern (the default)">
        <p className={styles.weekly}>
          {noWeekly ? (
            <span className={admin.muted}>Working days are not set for {year.label}.</span>
          ) : (
            <>
              Working:{' '}
              <strong>
                {cal.academicYear.workingDays!.map((d) => WEEKDAY_LABELS[d].long).join(', ')}
              </strong>
              . Every other day is closed unless an entry below says otherwise.
            </>
          )}{' '}
          <Link to={adminHref('years')}>Change on Academic years</Link>
        </p>
      </Panel>
      {cal.readOnly && (
        <Alert tone="info">
          {year.label} is closed. Its calendar is kept as history and cannot be changed.
        </Alert>
      )}

      <Panel
        title={formatMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)))}
        actions={
          <div className={styles.monthNav}>
            <Button
              size="sm"
              variant="secondary"
              icon={<ChevronLeft size={16} aria-hidden="true" />}
              disabled={month <= firstMonth}
              onClick={() => setMonth((m) => shiftMonth(m, -1))}
            >
              <span className="visually-hidden">Previous month</span>
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<ChevronRight size={16} aria-hidden="true" />}
              disabled={month >= lastMonth}
              onClick={() => setMonth((m) => shiftMonth(m, 1))}
            >
              <span className="visually-hidden">Next month</span>
            </Button>
            {!cal.readOnly && (
              <Button
                size="sm"
                icon={<Plus size={16} aria-hidden="true" />}
                onClick={() => setDialog({ mode: 'add', date: defaultDate })}
              >
                Add entry
              </Button>
            )}
          </div>
        }
      >
        <Legend />
        <MonthView
          cal={cal}
          month={month}
          today={today}
          onAdd={cal.readOnly ? null : (date) => setDialog({ mode: 'add', date })}
          onOpen={cal.readOnly ? null : (entry) => setDialog({ mode: 'edit', entry })}
        />
      </Panel>

      <Panel
        title="All entries"
        description={`${cal.entries.length} ${cal.entries.length === 1 ? 'entry' : 'entries'} in ${year.label}.`}
      >
        {cal.entries.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No holidays or special working days yet">
            {year.label} follows the weekly pattern on every date.
          </EmptyState>
        ) : (
          <div className={admin.tableWrap}>
            <table className={`${admin.table} ${admin.stacked}`}>
              <caption className="visually-hidden">Calendar entries for {year.label}</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Status</th>
                  <th scope="col">Applies to</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Added by</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {cal.entries.map((e) => (
                  <tr key={e.id}>
                    <td className={`${admin.strong} ${admin.nowrap}`}>
                      {WEEKDAY_LABELS[e.day].short}, {formatDate(e.date)}
                    </td>
                    <td data-label="Status">
                      <StatusMark entry={e} />
                    </td>
                    <td data-label="Applies to">{e.appliesTo}</td>
                    <td data-label="Reason">
                      {e.reason}
                      {e.note && <span className={admin.meta}> — {e.note}</span>}
                    </td>
                    <td data-label="Added by" className={admin.meta}>
                      {e.createdBy ?? '—'}
                    </td>
                    <td data-actions="">
                      {!cal.readOnly && (
                        <div className={admin.rowActions}>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Edit ${e.reason} on ${formatDate(e.date)}`}
                            onClick={() => setDialog({ mode: 'edit', entry: e })}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Delete ${e.reason} on ${formatDate(e.date)}`}
                            onClick={() => setRemoving(e)}
                          >
                            Delete
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {dialog && (
        <EntryDialog
          cal={cal}
          dialog={dialog}
          onClose={() => setDialog(null)}
          onSaved={(next, message) => {
            view.replace(next);
            setDialog(null);
            toast.show(message);
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title="Delete this calendar entry?"
        confirmLabel="Delete entry"
        tone="danger"
        pending={pending}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      >
        {removing && (
          <p>
            {KIND_LABEL[dayKind(removing)]} on {formatLongDate(removing.date)} for{' '}
            {removing.appliesTo} ({removing.reason}). The date goes back to the weekly pattern for
            those classes. Attendance already saved is not changed, and the removal is kept in the
            audit log.
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}

function StatusMark({ entry }: { entry: Pick<CalendarEntryView, 'status'> }) {
  return entry.status === 'HOLIDAY' ? (
    <span className={styles.mark} data-kind="holiday">
      <CalendarX size={16} aria-hidden="true" /> Holiday
    </span>
  ) : (
    <span className={styles.mark} data-kind="special">
      <CalendarCheck size={16} aria-hidden="true" /> Working day
    </span>
  );
}

function Legend() {
  return (
    <p className={styles.legend}>
      <span>
        <span className={styles.swatch} data-kind="working" aria-hidden="true" /> Working (weekly
        pattern)
      </span>
      <span>
        <span className={styles.swatch} data-kind="closed" aria-hidden="true" /> Closed (weekly
        pattern)
      </span>
      <span className={styles.mark} data-kind="holiday">
        <CalendarX size={16} aria-hidden="true" /> Holiday
      </span>
      <span className={styles.mark} data-kind="special">
        <CalendarCheck size={16} aria-hidden="true" /> Special working day
      </span>
    </p>
  );
}

function MonthView({
  cal,
  month,
  today,
  onAdd,
  onOpen,
}: {
  cal: CalendarView;
  month: string;
  today: string;
  onAdd: ((date: string) => void) | null;
  onOpen: ((entry: CalendarEntryView) => void) | null;
}) {
  const phone = useMediaQuery('(max-width: 767px)');
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const year = cal.academicYear;
  const byDate = useMemo(() => {
    const map = new Map<string, CalendarEntryView[]>();
    for (const e of cal.entries) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return map;
  }, [cal.entries]);
  const dates = Array.from({ length: daysInMonth(y, m) }, (_, i) => isoOf(y, m, i + 1));
  const inYear = (d: string) => d >= year.startDate && d <= year.endDate;

  const entryButton = (e: CalendarEntryView) => {
    const text = (
      <>
        <StatusMark entry={e} />
        <span className={styles.chipText}>
          {e.appliesTo} · {e.reason}
        </span>
      </>
    );
    return onOpen ? (
      <button
        key={e.id}
        type="button"
        className={styles.chip}
        data-kind={dayKind(e)}
        onClick={() => onOpen(e)}
        aria-label={`${KIND_LABEL[dayKind(e)]}, ${e.appliesTo}, ${e.reason}, ${formatLongDate(e.date)}. Edit`}
      >
        {text}
      </button>
    ) : (
      <span key={e.id} className={styles.chip} data-kind={dayKind(e)}>
        {text}
      </span>
    );
  };

  if (phone) {
    // Phones: the month's entries as a list (a 7-column grid would be unreadable).
    const listed = dates.filter((d) => byDate.has(d));
    return listed.length === 0 ? (
      <p className={admin.muted}>No holidays or special working days this month.</p>
    ) : (
      <ul className={styles.dayList} aria-label="Entries this month">
        {listed.map((d) => (
          <li key={d} className={styles.dayListItem}>
            <span className={styles.dayListDate}>
              {WEEKDAY_LABELS[weekdayOf(d)].short} {formatDate(d)}
              <span className={admin.meta}>
                {' '}
                · normally {weeklyWorking(year, d) ? 'working' : 'closed'}
              </span>
            </span>
            {byDate.get(d)!.map(entryButton)}
          </li>
        ))}
      </ul>
    );
  }

  const lead = WEEK.indexOf(weekdayOf(dates[0]!));
  return (
    <div className={styles.grid} role="table" aria-label={`Calendar for ${formatMonth(y, m)}`}>
      <div role="rowgroup">
        <div role="row" className={styles.weekHead}>
          {WEEK.map((d) => (
            <span key={d} role="columnheader" className={styles.weekday}>
              {WEEKDAY_LABELS[d].short}
            </span>
          ))}
        </div>
      </div>
      <div role="rowgroup" className={styles.days}>
        {Array.from({ length: Math.ceil((lead + dates.length) / 7) }, (_, week) => (
          <div role="row" key={week} className={styles.week}>
            {WEEK.map((_, col) => {
              const index = week * 7 + col - lead;
              const d = dates[index];
              if (!d) return <span key={col} role="cell" className={styles.blank} />;
              const entries = byDate.get(d) ?? [];
              const weekly = weeklyWorking(year, d);
              const usable = inYear(d);
              return (
                <div
                  key={col}
                  role="cell"
                  className={styles.day}
                  data-weekly={weekly ? 'working' : 'closed'}
                  data-outside={usable ? undefined : ''}
                  data-today={d === today ? '' : undefined}
                >
                  <span className={styles.dayHead}>
                    <span className={styles.dayNumber}>{Number(d.slice(8))}</span>
                    <span className={styles.dayState}>
                      {!usable ? 'Outside year' : weekly ? 'Working' : 'Closed'}
                    </span>
                  </span>
                  {entries.map(entryButton)}
                  {usable && onAdd && (
                    <button
                      type="button"
                      className={styles.add}
                      onClick={() => onAdd(d)}
                      aria-label={`Add an entry on ${formatLongDate(d)}`}
                    >
                      <Plus size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Add / edit -------------------------------------------------------------------------------

type Applies = 'SCHOOL' | 'RANGE' | 'CLASSES' | 'SECTIONS';

function EntryDialog({
  cal,
  dialog,
  onClose,
  onSaved,
}: {
  cal: CalendarView;
  dialog: Dialog;
  onClose: () => void;
  onSaved: (next: CalendarView, message: string) => void;
}) {
  const editing = dialog.mode === 'edit' ? dialog.entry : null;
  const year = cal.academicYear;
  const classes = cal.classes.filter(
    (c) => c.active || editing?.classes.some((x) => x.id === c.id),
  );
  const initial = {
    date: editing?.date ?? (dialog.mode === 'add' ? dialog.date : year.startDate),
    status: (editing?.status ??
      (dialog.mode === 'add' && !weeklyWorking(year, dialog.date) ? 'WORKING' : 'HOLIDAY')) as
      CalendarDayStatus | '',
    applies: (editing?.scope ?? 'SCHOOL') as Applies,
    fromClass: classes[0]?.id ?? '',
    toClass: classes.at(-1)?.id ?? '',
    classIds: editing?.classes.map((c) => c.id) ?? [],
    sectionIds: editing?.sections.map((s) => s.id) ?? [],
    reason: editing?.reason ?? '',
    note: editing?.note ?? '',
  };
  const [v, setV] = useState(initial);
  const [confirmClose, setConfirmClose] = useState(false);
  const form = useFormSubmit([
    'date',
    'status',
    'scope',
    'classIds',
    'sectionIds',
    'reason',
    'note',
  ]);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const set = <K extends keyof typeof v>(key: K, value: (typeof v)[K]) =>
    setV((prev) => ({ ...prev, [key]: value }));
  const toggle = (key: 'classIds' | 'sectionIds', id: string, on: boolean) =>
    setV((prev) => ({
      ...prev,
      [key]: on ? [...prev[key], id] : prev[key].filter((x) => x !== id),
    }));

  const range = classesInRange(classes, v.fromClass, v.toClass);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(v.date);
  const weekly = validDate ? weeklyWorking(year, v.date) : null;

  async function submit() {
    const scope = v.applies === 'RANGE' ? 'CLASSES' : v.applies;
    const body = form.check(CalendarEntryInputSchema, {
      date: v.date,
      status: v.status || undefined,
      scope,
      classIds:
        v.applies === 'RANGE' ? range.map((c) => c.id) : v.applies === 'CLASSES' ? v.classIds : [],
      sectionIds: v.applies === 'SECTIONS' ? v.sectionIds : [],
      reason: v.reason,
      note: v.note,
    });
    if (!body) return;
    const result = await form.run(() =>
      editing ? calendarApi.update(editing.id, body) : calendarApi.create(year.id, body),
    );
    if (result.ok) {
      const what = body.status === 'HOLIDAY' ? 'Holiday' : 'Working day';
      onSaved(result.value, `${what} on ${formatDate(body.date)} ${editing ? 'saved' : 'added'}`);
    }
  }

  const close = () => (dirty && !form.pending ? setConfirmClose(true) : onClose());

  return (
    <>
      <FormDialog
        open={!confirmClose}
        wide
        title={editing ? `Edit entry — ${formatDate(editing.date)}` : 'Add calendar entry'}
        submitLabel={editing ? 'Save changes' : 'Add entry'}
        pending={form.pending}
        error={form.formError}
        onSubmit={() => void submit()}
        onClose={close}
      >
        <div className={admin.formGrid}>
          <TextField
            label="Date"
            type="date"
            required
            min={year.startDate}
            max={year.endDate}
            value={v.date}
            onChange={(e) => set('date', e.target.value)}
            error={form.errors.date}
            hint={
              weekly === null
                ? undefined
                : `${WEEKDAY_LABELS[weekdayOf(v.date)].long} — normally ${weekly ? 'a working day' : 'closed'}.`
            }
          />
          <SelectField
            label="Status"
            required
            value={v.status}
            onChange={(e) => set('status', e.target.value as CalendarDayStatus)}
            error={form.errors.status}
            options={(['HOLIDAY', 'WORKING'] as const).map((s) => ({
              value: s,
              label: s === 'HOLIDAY' ? 'Holiday / non-working day' : CALENDAR_DAY_STATUS_LABELS[s],
            }))}
          />
        </div>
        <SelectField
          label="Applies to"
          required
          value={v.applies}
          onChange={(e) => set('applies', e.target.value as Applies)}
          error={form.errors.scope}
          options={[
            { value: 'SCHOOL', label: 'Entire school' },
            { value: 'RANGE', label: 'A range of classes (e.g. 11 to 12)' },
            { value: 'CLASSES', label: 'Specific classes' },
            { value: 'SECTIONS', label: 'Specific sections' },
          ]}
        />
        {v.applies === 'RANGE' && (
          <div className={admin.formGrid}>
            <SelectField
              label="From class"
              value={v.fromClass}
              onChange={(e) => set('fromClass', e.target.value)}
              options={classes.map((c) => ({ value: c.id, label: c.name }))}
            />
            <SelectField
              label="To class"
              value={v.toClass}
              onChange={(e) => set('toClass', e.target.value)}
              options={classes.map((c) => ({ value: c.id, label: c.name }))}
              error={form.errors.classIds}
              hint={
                range.length
                  ? `Includes ${range.map((c) => c.name).join(', ')} (in the configured class order).`
                  : undefined
              }
            />
          </div>
        )}
        {v.applies === 'CLASSES' && (
          <fieldset className={styles.choices}>
            <legend>Classes</legend>
            {classes.map((c) => (
              <CheckboxField
                key={c.id}
                label={c.name}
                checked={v.classIds.includes(c.id)}
                onChange={(e) => toggle('classIds', c.id, e.target.checked)}
              />
            ))}
            {form.errors.classIds && (
              <p className={styles.fieldError} role="alert">
                {form.errors.classIds.join(' ')}
              </p>
            )}
          </fieldset>
        )}
        {v.applies === 'SECTIONS' && (
          <fieldset className={styles.choices}>
            <legend>Sections</legend>
            {classes.flatMap((c) =>
              c.sections
                .filter((s) => s.active || editing?.sections.some((x) => x.id === s.id))
                .map((s) => (
                  <CheckboxField
                    key={s.id}
                    label={`${c.name} ${s.name}`}
                    checked={v.sectionIds.includes(s.id)}
                    onChange={(e) => toggle('sectionIds', s.id, e.target.checked)}
                  />
                )),
            )}
            {form.errors.sectionIds && (
              <p className={styles.fieldError} role="alert">
                {form.errors.sectionIds.join(' ')}
              </p>
            )}
          </fieldset>
        )}
        <TextField
          label="Reason"
          required
          maxLength={120}
          hint="For example Gandhi Jayanti, Annual sports day or Special class."
          value={v.reason}
          onChange={(e) => set('reason', e.target.value)}
          error={form.errors.reason}
        />
        <TextAreaField
          label="Note (optional)"
          maxLength={500}
          rows={2}
          value={v.note}
          onChange={(e) => set('note', e.target.value)}
          error={form.errors.note}
        />
      </FormDialog>
      <ConfirmDialog
        open={confirmClose}
        title="Discard your changes?"
        confirmLabel="Discard"
        tone="danger"
        onConfirm={onClose}
        onCancel={() => setConfirmClose(false)}
      >
        <p>The entry has not been saved.</p>
      </ConfirmDialog>
    </>
  );
}
