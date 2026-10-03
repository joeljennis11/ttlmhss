import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  ExamSubjectsUpdateSchema,
  type ClassView,
  type ExamSubjectView,
  type ExamView,
  type GradeSchemeView,
  type SubjectView,
} from '@ttlmhss/shared';
import { Layers, Library } from 'lucide-react';
import { Panel } from '../../../components/layout/Page';
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  SelectField,
  StatusBadge,
  useToast,
} from '../../../components/ui';
import { formatDate, formatPercent } from '../../../lib/format';
import { useFormSubmit } from '../../../lib/use-form-submit';
import { useResource } from '../../../lib/use-resource';
import { AdminLayout } from '../AdminLayout';
import { adminHref } from '../admin-pages';
import { classes as classesApi, exams as api, gradeScales, subjects as subjectsApi } from '../api';
import { examAdminApi } from '../../marks/api';
import { MarkEntryPanel, StagePanel } from '../ExamMarksPanels';
import { RANK_SCOPE_LABELS } from '../labels';
import styles from '../admin.module.css';

interface Setup {
  exam: ExamView;
  classes: ClassView[];
  subjects: SubjectView[];
  scales: GradeSchemeView[];
}

export function ExamDetailPage() {
  const { examId = '' } = useParams();
  const setup = useResource(`exam:${examId}`, async (signal): Promise<Setup> => {
    const [exam, classes, subjects, scales] = await Promise.all([
      api.get(examId, signal),
      classesApi.list(signal),
      subjectsApi.list(signal),
      gradeScales.list(signal),
    ]);
    return { exam, classes, subjects, scales };
  });

  const exam = setup.status === 'ready' ? setup.data.exam : null;
  const backTo = `${adminHref('exams')}${exam ? `?year=${exam.academicYearId}` : ''}`;

  return (
    <AdminLayout
      page="exams"
      title={exam ? exam.name : 'Exam'}
      description="Choose a class, then tick the subjects in this exam and enter their maximum and pass marks."
      back={{ to: backTo, label: 'All exams' }}
    >
      {setup.status === 'loading' && <LoadingState />}
      {setup.status === 'error' && <ErrorState message={setup.error} onRetry={setup.reload} />}
      {setup.status === 'ready' && <ExamSetup setup={setup.data} onExamChanged={setup.reload} />}
    </AdminLayout>
  );
}

function ExamSetup({ setup, onExamChanged }: { setup: Setup; onExamChanged: () => void }) {
  const { exam, classes, scales } = setup;
  const matrix = useResource(`exam-matrix:${exam.id}`, (signal) =>
    examAdminApi.matrix(exam.id, signal),
  );
  const [params, setParams] = useSearchParams();
  const usable = classes.filter((c) => c.status === 'ACTIVE');
  const classId = usable.find((c) => c.id === params.get('class'))?.id ?? usable[0]?.id ?? null;
  const scaleName = scales.find((s) => s.id === exam.gradeSchemeId)?.name;

  return (
    <>
      <Panel title="Exam details">
        <dl className={styles.facts}>
          <div>
            <dt>Dates</dt>
            <dd>
              {exam.startDate ? formatDate(exam.startDate) : 'Not set'}
              {exam.endDate && exam.endDate !== exam.startDate
                ? ` – ${formatDate(exam.endDate)}`
                : ''}
            </dd>
          </div>
          <div>
            <dt>Weightage</dt>
            <dd>{formatPercent(exam.weightagePercent)} of the annual result</dd>
          </div>
          <div>
            <dt>Grade scale</dt>
            <dd>{scaleName ?? 'None'}</dd>
          </div>
          <div>
            <dt>Rank</dt>
            <dd>{RANK_SCOPE_LABELS[exam.rankScope]}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <StatusBadge status={exam.status} />
            </dd>
          </div>
          {exam.description && (
            <div>
              <dt>Description</dt>
              <dd>{exam.description}</dd>
            </div>
          )}
        </dl>
      </Panel>

      <StagePanel exam={exam} matrix={matrix} onChanged={onExamChanged} />

      {classId === null ? (
        <Panel>
          <EmptyState
            icon={Layers}
            title="No active classes"
            action={<Link to={adminHref('classes')}>Go to classes & sections</Link>}
          >
            Add classes before setting up exam subjects.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <div className={styles.toolbar}>
            <SelectField
              label="Class"
              value={classId}
              onChange={(e) =>
                setParams(
                  (p) => {
                    const next = new URLSearchParams(p);
                    next.set('class', e.target.value);
                    return next;
                  },
                  { replace: true },
                )
              }
              options={usable.map((c) => ({ value: c.id, label: `Class ${c.name}` }))}
            />
          </div>
          <SubjectsEditor
            key={classId}
            setup={setup}
            cls={usable.find((c) => c.id === classId)!}
            onSaved={matrix.reload}
          />
          <MarkEntryPanel classId={classId} matrix={matrix} />
        </>
      )}
    </>
  );
}

interface Row {
  subjectId: string;
  name: string;
  /** Subject is no longer active: it can stay but cannot be newly added. */
  inactive: boolean;
  included: boolean;
  theoryMax: string;
  internalMax: string;
  practicalMax: string;
  passMarks: string;
  normalizedMax: string;
  includeInResult: boolean;
  gradeSchemeId: string;
  /** Phase 8B: marks exist (cannot remove) / submitted (settings locked until unlocked). */
  hasMarks: boolean;
  locked: boolean;
}

const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
const num = (s: string) => (s.trim() === '' ? null : Number(s));

function toRows(subjects: SubjectView[], configured: ExamSubjectView[]): Row[] {
  const byId = new Map(configured.map((c) => [c.subjectId, c]));
  return subjects
    .filter((s) => s.status === 'ACTIVE' || byId.has(s.id))
    .map((s) => {
      const c = byId.get(s.id);
      return {
        subjectId: s.id,
        name: s.name,
        inactive: s.status !== 'ACTIVE',
        included: Boolean(c),
        theoryMax: str(c?.theoryMax),
        internalMax: str(c?.internalMax),
        practicalMax: str(c?.practicalMax),
        passMarks: str(c?.passMarks),
        normalizedMax: str(c?.normalizedMax),
        includeInResult: c?.includeInResult ?? true,
        gradeSchemeId: c?.gradeSchemeId ?? '',
        hasMarks: c?.hasMarks ?? false,
        locked: c?.locked ?? false,
      };
    });
}

type CellField = 'theoryMax' | 'internalMax' | 'practicalMax' | 'passMarks' | 'normalizedMax';

function SubjectsEditor({
  setup,
  cls,
  onSaved,
}: {
  setup: Setup;
  cls: ClassView;
  onSaved: () => void;
}) {
  const { exam, subjects, scales } = setup;
  const configured = useResource(`exam-subjects:${exam.id}:${cls.id}`, (signal) =>
    api.subjects(exam.id, cls.id, signal),
  );

  if (configured.status === 'loading') return <LoadingState />;
  if (configured.status === 'error') {
    return <ErrorState message={configured.error} onRetry={configured.reload} />;
  }
  if (subjects.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={Library}
          title="No subjects yet"
          action={<Link to={adminHref('subjects')}>Go to subjects</Link>}
        >
          Add subjects before setting up exam marks.
        </EmptyState>
      </Panel>
    );
  }
  return (
    <SubjectsForm
      key={configured.data.map((c) => c.subjectId).join()}
      exam={exam}
      cls={cls}
      scales={scales}
      initial={toRows(subjects, configured.data)}
      onSaved={(rows) => {
        configured.replace(rows);
        onSaved();
      }}
    />
  );
}

function SubjectsForm({
  exam,
  cls,
  scales,
  initial,
  onSaved,
}: {
  exam: ExamView;
  cls: ClassView;
  scales: GradeSchemeView[];
  initial: Row[];
  onSaved: (rows: ExamSubjectView[]) => void;
}) {
  const [rows, setRows] = useState(initial);
  const toast = useToast();
  // Errors arrive as subjects.<index>.<field>; the index is the position among the included rows.
  const form = useFormSubmit((path) =>
    /^subjects\.\d+\.(theoryMax|internalMax|practicalMax|passMarks|normalizedMax|gradeSchemeId|subjectId)$/.test(
      path,
    ),
  );
  const included = rows.filter((r) => r.included);
  const errorFor = (row: Row, field: string) => {
    const index = included.indexOf(row);
    return index < 0 ? undefined : form.errors[`subjects.${index}.${field}`];
  };
  const update = (subjectId: string, change: Partial<Row>) =>
    setRows((list) => list.map((r) => (r.subjectId === subjectId ? { ...r, ...change } : r)));

  async function save() {
    const input = {
      subjects: included.map((r) => ({
        subjectId: r.subjectId,
        theoryMax: num(r.theoryMax) ?? NaN,
        internalMax: num(r.internalMax),
        practicalMax: num(r.practicalMax),
        passMarks: num(r.passMarks) ?? NaN,
        normalizedMax: num(r.normalizedMax),
        includeInResult: r.includeInResult,
        gradeSchemeId: r.gradeSchemeId || null,
      })),
    };
    const body = form.check(ExamSubjectsUpdateSchema, input);
    if (!body) return;
    const result = await form.run(() => api.setSubjects(exam.id, cls.id, body.subjects));
    if (result.ok) {
      onSaved(result.value);
      toast.show(`Subjects saved for ${exam.name}, class ${cls.name}`);
    }
  }

  const scaleOptions = scales
    .filter((s) => s.status === 'ACTIVE')
    .map((s) => ({ value: s.id, label: s.name }));

  return (
    <Panel
      title={`Subjects in ${exam.name} for class ${cls.name}`}
      description="Total = theory + internal + practical. “Convert to” scales the total for results (e.g. 42/50 → 84/100); the marks entered are always kept."
    >
      {form.formError && <Alert tone="error">{form.formError}</Alert>}
      <div className={styles.tableWrap}>
        <table className={`${styles.table} ${styles.marksTable}`}>
          <thead>
            <tr>
              <th scope="col">In exam</th>
              <th scope="col">Subject</th>
              <th scope="col">Theory max</th>
              <th scope="col">Internal max</th>
              <th scope="col">Practical max</th>
              <th scope="col" className={styles.num}>
                Total
              </th>
              <th scope="col">Pass marks</th>
              <th scope="col">Convert to</th>
              <th scope="col">Counts in result</th>
              <th scope="col">Grade scale</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const total =
                (num(row.theoryMax) ?? 0) +
                (num(row.internalMax) ?? 0) +
                (num(row.practicalMax) ?? 0);
              const off = !row.included;
              const frozen = off || row.locked;
              const cell = (field: CellField, label: string) => {
                const error = errorFor(row, field);
                const id = `${row.subjectId}-${field}`;
                return (
                  <td>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={1000}
                      aria-label={`${label}, ${row.name}`}
                      value={row[field]}
                      disabled={frozen || form.pending}
                      onChange={(e) => update(row.subjectId, { [field]: e.target.value })}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? `${id}-error` : undefined}
                    />
                    {error && (
                      <span id={`${id}-error`} className={styles.cellError}>
                        {error.join(' ')}
                      </span>
                    )}
                  </td>
                );
              };
              return (
                <tr key={row.subjectId} data-muted={off || undefined}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Include ${row.name} in ${exam.name}`}
                      checked={row.included}
                      disabled={form.pending || (row.inactive && !row.included) || row.hasMarks}
                      onChange={(e) => update(row.subjectId, { included: e.target.checked })}
                    />
                  </td>
                  <td className={styles.strong}>
                    {row.name}
                    {row.inactive && (
                      <>
                        {' '}
                        <StatusBadge status="INACTIVE" />
                      </>
                    )}
                    {row.locked ? (
                      <span className={styles.meta} style={{ display: 'block' }}>
                        Marks submitted — settings locked
                      </span>
                    ) : row.hasMarks ? (
                      <span className={styles.meta} style={{ display: 'block' }}>
                        Marks entered — cannot be removed
                      </span>
                    ) : null}
                    {errorFor(row, 'subjectId') && (
                      <span className={styles.cellError}>
                        {errorFor(row, 'subjectId')!.join(' ')}
                      </span>
                    )}
                  </td>
                  {cell('theoryMax', 'Theory maximum')}
                  {cell('internalMax', 'Internal maximum')}
                  {cell('practicalMax', 'Practical maximum')}
                  <td className={styles.num}>{off ? '—' : total}</td>
                  {cell('passMarks', 'Pass marks')}
                  {cell('normalizedMax', 'Convert to')}
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${row.name} counts in the result`}
                      checked={row.includeInResult}
                      disabled={frozen || form.pending}
                      onChange={(e) => update(row.subjectId, { includeInResult: e.target.checked })}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`Grade scale for ${row.name}`}
                      value={row.gradeSchemeId}
                      disabled={frozen || form.pending}
                      onChange={(e) => update(row.subjectId, { gradeSchemeId: e.target.value })}
                    >
                      <option value="">Same as exam</option>
                      {scaleOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={styles.formActions}>
        <Button loading={form.pending} loadingLabel="Saving…" onClick={() => void save()}>
          Save subjects
        </Button>
        <span className={styles.meta}>
          {included.length} {included.length === 1 ? 'subject' : 'subjects'} in this exam for class{' '}
          {cls.name}
        </span>
      </div>
    </Panel>
  );
}
