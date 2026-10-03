import { useState } from 'react';
import { Link } from 'react-router';
import {
  ExamCreateSchema,
  ExamUpdateSchema,
  RANK_SCOPES,
  type AcademicYearView,
  type ExamListView,
  type ExamView,
  type GradeSchemeView,
} from '@ttlmhss/shared';
import { ClipboardList, Plus } from 'lucide-react';
import { Panel } from '../../../components/layout/Page';
import {
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
import { formatDate, formatPercent } from '../../../lib/format';
import { useFormSubmit } from '../../../lib/use-form-submit';
import { messageOf, useResource } from '../../../lib/use-resource';
import { AdminLayout } from '../AdminLayout';
import { adminHref } from '../admin-pages';
import { exams as api, gradeScales } from '../api';
import { RANK_SCOPE_LABELS } from '../labels';
import { YearGate, YearSelect, useYearSelection } from '../year-selection';
import styles from '../admin.module.css';

export function ExamsPage() {
  const selection = useYearSelection();
  return (
    <AdminLayout
      page="exams"
      description="Exams for each academic year, their share of the annual result (weightage), grade scale and rank scope. Open an exam to set up its subjects and marks for each class."
    >
      <YearGate selection={selection}>
        {(year, years) => (
          <>
            <div className={styles.toolbar}>
              <YearSelect years={years} year={year} onChange={selection.select} />
            </div>
            <ExamList key={year.id} year={year} />
          </>
        )}
      </YearGate>
    </AdminLayout>
  );
}

function WeightageMeter({ list }: { list: ExamListView }) {
  const total = list.totalWeightagePercent;
  return (
    <div className={styles.meter}>
      <div
        className={styles.meterTrack}
        role="meter"
        aria-label="Annual weightage assigned"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={total}
        aria-valuetext={`${formatPercent(total)} of 100%`}
      >
        <div
          className={styles.meterFill}
          data-complete={list.weightageComplete || undefined}
          style={{ width: `${Math.min(100, total)}%` }}
        />
      </div>
      <div className={styles.meterText}>
        <span className={styles.strong}>{formatPercent(total)} of 100% assigned</span>
        <span className={list.weightageComplete ? undefined : styles.muted}>
          {list.weightageComplete
            ? 'Complete: the active exams add up to 100%.'
            : `${formatPercent(Number((100 - total).toFixed(2)))} still to assign. Annual results need exactly 100%.`}
        </span>
      </div>
    </div>
  );
}

function ExamList({ year }: { year: AcademicYearView }) {
  const list = useResource(`exams:${year.id}`, (signal) => api.list(year.id, signal));
  const scales = useResource('grade-scales', (signal) => gradeScales.list(signal));
  const [editing, setEditing] = useState<{ exam: ExamView | null } | null>(null);
  const [removing, setRemoving] = useState<ExamView | null>(null);
  const [pending, setPending] = useState(false);
  const toast = useToast();

  async function remove() {
    if (!removing) return;
    setPending(true);
    try {
      await api.remove(removing.id);
      toast.show(`${removing.name} deleted`);
      setRemoving(null);
      list.reload();
    } catch (error) {
      toast.show(messageOf(error), 'error');
    } finally {
      setPending(false);
    }
  }

  if (list.status === 'loading' || scales.status === 'loading') return <LoadingState />;
  if (list.status === 'error') return <ErrorState message={list.error} onRetry={list.reload} />;
  if (scales.status === 'error')
    return <ErrorState message={scales.error} onRetry={scales.reload} />;
  const scaleName = (id: string | null) => scales.data.find((s) => s.id === id)?.name ?? null;
  const nextOrder = Math.max(0, ...list.data.exams.map((e) => e.displayOrder)) + 1;

  return (
    <>
      <Panel
        title={`Exams in ${year.label}`}
        actions={
          <Button
            size="sm"
            icon={<Plus size={16} aria-hidden="true" />}
            onClick={() => setEditing({ exam: null })}
          >
            Add exam
          </Button>
        }
      >
        {list.data.exams.length === 0 ? (
          <EmptyState icon={ClipboardList} title={`No exams in ${year.label} yet`}>
            Add each exam the school holds this year with its weightage in the annual result.
          </EmptyState>
        ) : (
          <div className={styles.stack}>
            <WeightageMeter list={list.data} />
            <div className={styles.tableWrap}>
              <table className={`${styles.table} ${styles.stacked}`}>
                <thead>
                  <tr>
                    <th scope="col">Exam</th>
                    <th scope="col">Dates</th>
                    <th scope="col" className={styles.num}>
                      Weightage
                    </th>
                    <th scope="col">Grade scale</th>
                    <th scope="col">Rank</th>
                    <th scope="col" className={styles.num}>
                      Subjects
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.exams.map((exam) => (
                    <tr key={exam.id} data-muted={exam.status !== 'ACTIVE' || undefined}>
                      <td>
                        <Link to={`${adminHref('exams')}/${exam.id}`} className={styles.strong}>
                          {exam.name}
                        </Link>
                      </td>
                      <td data-label="Dates" className={styles.nowrap}>
                        {exam.startDate ? formatDate(exam.startDate) : '—'}
                        {exam.endDate && exam.endDate !== exam.startDate
                          ? ` – ${formatDate(exam.endDate)}`
                          : ''}
                      </td>
                      <td data-label="Weightage" className={styles.num}>
                        {formatPercent(exam.weightagePercent)}
                      </td>
                      <td data-label="Grade scale">
                        {scaleName(exam.gradeSchemeId) ?? (
                          <span className={styles.muted}>None</span>
                        )}
                      </td>
                      <td data-label="Rank">{exam.rankScope === 'CLASS' ? 'Class' : 'Section'}</td>
                      <td data-label="Subjects" className={styles.num}>
                        {exam.subjectCount}
                      </td>
                      <td data-label="Status">
                        <StatusBadge status={exam.status} />
                      </td>
                      <td data-actions="">
                        <div className={styles.rowActions}>
                          <Link
                            to={`${adminHref('exams')}/${exam.id}`}
                            className={styles.textAction}
                          >
                            Subjects<span className="visually-hidden"> for {exam.name}</span>
                          </Link>
                          <Button variant="ghost" size="sm" onClick={() => setEditing({ exam })}>
                            Edit<span className="visually-hidden"> {exam.name}</span>
                          </Button>
                          {exam.subjectCount === 0 && (
                            <Button variant="ghost" size="sm" onClick={() => setRemoving(exam)}>
                              Delete<span className="visually-hidden"> {exam.name}</span>
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Panel>

      {editing && (
        <ExamDialog
          year={year}
          exam={editing.exam}
          scales={scales.data}
          nextOrder={nextOrder}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            list.reload();
            toast.show(editing.exam ? `${saved.name} saved` : `${saved.name} added`);
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title={`Delete ${removing?.name ?? ''}?`}
        confirmLabel="Delete exam"
        tone="danger"
        pending={pending}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      >
        <p>The exam has no subjects set up, so it can be deleted. This cannot be undone.</p>
      </ConfirmDialog>
    </>
  );
}

function ExamDialog({
  year,
  exam,
  scales,
  nextOrder,
  onClose,
  onSaved,
}: {
  year: Pick<AcademicYearView, 'id' | 'label' | 'startDate' | 'endDate'>;
  exam: ExamView | null;
  scales: readonly GradeSchemeView[];
  nextOrder: number;
  onClose: () => void;
  onSaved: (exam: ExamView) => void;
}) {
  const [values, setValues] = useState({
    name: exam?.name ?? '',
    startDate: exam?.startDate ?? '',
    endDate: exam?.endDate ?? '',
    weightagePercent: exam ? String(exam.weightagePercent) : '',
    gradeSchemeId: exam?.gradeSchemeId ?? '',
    rankScope: exam?.rankScope ?? 'SECTION',
    displayOrder: String(exam?.displayOrder ?? nextOrder),
  });
  const [active, setActive] = useState((exam?.status ?? 'ACTIVE') === 'ACTIVE');
  const form = useFormSubmit([
    'name',
    'startDate',
    'endDate',
    'weightagePercent',
    'gradeSchemeId',
    'rankScope',
    'displayOrder',
  ]);
  const set = (name: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [name]: e.target.value }));

  async function submit() {
    const input = {
      name: values.name,
      startDate: values.startDate || null,
      endDate: values.endDate || null,
      weightagePercent: values.weightagePercent === '' ? NaN : Number(values.weightagePercent),
      gradeSchemeId: values.gradeSchemeId || null,
      rankScope: values.rankScope,
      displayOrder: Number(values.displayOrder),
    };
    if (exam) {
      const body = form.check(ExamUpdateSchema, {
        ...input,
        status: active ? 'ACTIVE' : 'INACTIVE',
      });
      if (!body) return;
      const result = await form.run(() => api.update(exam.id, body));
      if (result.ok) onSaved(result.value);
    } else {
      const body = form.check(ExamCreateSchema, { ...input, academicYearId: year.id });
      if (!body) return;
      const result = await form.run(() => api.create(body));
      if (result.ok) onSaved(result.value);
    }
  }

  const scaleOptions = scales
    .filter((s) => s.status === 'ACTIVE' || s.id === exam?.gradeSchemeId)
    .map((s) => ({ value: s.id, label: s.status === 'ACTIVE' ? s.name : `${s.name} (inactive)` }));

  return (
    <FormDialog
      open
      title={exam ? `Edit ${exam.name}` : `Add an exam to ${year.label}`}
      submitLabel={exam ? 'Save changes' : 'Add exam'}
      pending={form.pending}
      error={form.formError}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <TextField
        label="Exam name"
        hint="For example Quarterly, Half-yearly or Annual."
        maxLength={60}
        value={values.name}
        onChange={set('name')}
        error={form.errors.name}
        autoFocus
      />
      <div className={styles.formGrid}>
        <TextField
          label="First day"
          hint="Optional."
          type="date"
          min={year.startDate}
          max={year.endDate}
          value={values.startDate}
          onChange={set('startDate')}
          error={form.errors.startDate}
        />
        <TextField
          label="Last day"
          hint="Optional."
          type="date"
          min={year.startDate}
          max={year.endDate}
          value={values.endDate}
          onChange={set('endDate')}
          error={form.errors.endDate}
        />
        <TextField
          label="Weightage (%)"
          hint="Share of the annual result. 0 = not counted."
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          step="0.01"
          value={values.weightagePercent}
          onChange={set('weightagePercent')}
          error={form.errors.weightagePercent}
        />
        <TextField
          label="Display order"
          type="number"
          inputMode="numeric"
          min={0}
          max={999}
          value={values.displayOrder}
          onChange={set('displayOrder')}
          error={form.errors.displayOrder}
        />
        <SelectField
          label="Grade scale"
          placeholder="No grades"
          options={scaleOptions}
          value={values.gradeSchemeId}
          onChange={set('gradeSchemeId')}
          error={form.errors.gradeSchemeId}
        />
        <SelectField
          label="Rank"
          options={RANK_SCOPES.map((r) => ({ value: r, label: RANK_SCOPE_LABELS[r] }))}
          value={values.rankScope}
          onChange={set('rankScope')}
          error={form.errors.rankScope}
        />
      </div>
      {exam && (
        <CheckboxField
          label="Active"
          hint="Inactive exams keep their history and do not count towards the weightage."
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
      )}
    </FormDialog>
  );
}
