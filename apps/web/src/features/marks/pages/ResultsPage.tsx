import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import type {
  ClassResultView,
  ResultExamsView,
  StudentExamResultView,
  SubjectResultView,
} from '@ttlmhss/shared';
import { ChartColumn } from 'lucide-react';
import { Panel } from '../../../components/layout/Page';
import {
  Alert,
  Badge,
  EmptyState,
  ErrorState,
  LoadingState,
  SelectField,
} from '../../../components/ui';
import { formatPercent } from '../../../lib/format';
import { useMediaQuery } from '../../../lib/use-media-query';
import { useResource } from '../../../lib/use-resource';
import { useAuth } from '../../auth/auth-context';
import { resultsApi } from '../api';
import { MarksLayout, ResultMark, SheetStatusBadge, StageBadge, examDates } from '../marks-shared';
import styles from '../marks.module.css';

/** /results — a student's own results, or a class's results for its class teacher / admins. */
export function ResultsPage() {
  const { user } = useAuth();
  return user?.roles.includes('STUDENT') ? <MyResults /> : <ClassResults />;
}

function useSelection() {
  const [params, setParams] = useSearchParams();
  const set = (key: string, value: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.set(key, value);
        if (key === 'year') {
          next.delete('exam');
        }
        return next;
      },
      { replace: true },
    );
  return { params, set };
}

function YearExamPicker({
  options,
  examId,
  onChange,
  children,
}: {
  options: ResultExamsView;
  examId: string | null;
  onChange: (key: string, value: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className={styles.toolbar}>
      <SelectField
        label="Academic year"
        value={options.academicYearId ?? ''}
        onChange={(e) => onChange('year', e.target.value)}
        options={options.years.map((y) => ({
          value: y.id,
          label: y.status === 'CURRENT' ? `${y.label} (current)` : y.label,
        }))}
      />
      {options.exams.length > 0 && (
        <SelectField
          label="Exam"
          value={examId ?? ''}
          onChange={(e) => onChange('exam', e.target.value)}
          options={options.exams.map((e) => ({ value: e.id, label: e.name }))}
        />
      )}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Student
// ---------------------------------------------------------------------------

function MyResults() {
  const { params, set } = useSelection();
  const year = params.get('year');
  const options = useResource(`my-results:${year ?? ''}`, (signal) =>
    resultsApi.myExams(year, signal),
  );
  const exams = options.status === 'ready' ? options.data.exams : [];
  const examId = exams.find((e) => e.id === params.get('exam'))?.id ?? exams[0]?.id ?? null;
  const result = useResource(examId ? `my-result:${examId}` : null, (signal) =>
    resultsApi.mine(examId!, signal),
  );

  return (
    <MarksLayout
      title="My results"
      description="A subject appears as soon as its marks are finalised. The complete result follows when every subject is finalised."
    >
      {options.status === 'loading' && <LoadingState />}
      {options.status === 'error' && (
        <ErrorState message={options.error} onRetry={options.reload} />
      )}
      {options.status === 'ready' && (
        <>
          <YearExamPicker options={options.data} examId={examId} onChange={set} />
          {exams.length === 0 ? (
            <Panel>
              <EmptyState icon={ChartColumn} title="No exam results yet">
                Results appear here when your school publishes an exam and finalises its marks.
              </EmptyState>
            </Panel>
          ) : result.status === 'loading' ? (
            <LoadingState />
          ) : result.status === 'error' ? (
            <ErrorState message={result.error} onRetry={result.reload} />
          ) : result.status === 'ready' ? (
            <StudentResult result={result.data} />
          ) : null}
        </>
      )}
    </MarksLayout>
  );
}

/** One student's result for one exam (students, and staff looking at a student). */
export function StudentResult({ result }: { result: StudentExamResultView }) {
  const r = result;
  return (
    <>
      <Panel>
        <dl className={styles.facts}>
          <div>
            <dt>Student</dt>
            <dd>{r.student.fullName}</dd>
          </div>
          <div>
            <dt>Admission no.</dt>
            <dd>{r.student.admissionNumber}</dd>
          </div>
          <div>
            <dt>Class</dt>
            <dd>{r.section.className}</dd>
          </div>
          <div>
            <dt>Section</dt>
            <dd>{r.section.sectionName}</dd>
          </div>
          <div>
            <dt>Roll no.</dt>
            <dd>{r.student.rollNumber ?? '—'}</dd>
          </div>
          <div>
            <dt>Academic year</dt>
            <dd>{r.academicYear.label}</dd>
          </div>
          <div>
            <dt>Exam</dt>
            <dd>
              {r.exam.name} <StageBadge stage={r.exam.stage} />
              <span className={styles.sub}>{examDates(r.exam)}</span>
            </dd>
          </div>
        </dl>
      </Panel>

      {r.complete && r.summary ? (
        <Panel title="Complete result">
          <dl className={styles.summary}>
            <div className={styles.tile}>
              <dt>Total</dt>
              <dd>
                {r.summary.total} / {r.summary.max}
              </dd>
            </div>
            <div className={styles.tile}>
              <dt>Percentage</dt>
              <dd>{formatPercent(r.summary.percentage)}</dd>
            </div>
            <div className={styles.tile}>
              <dt>Result</dt>
              <dd>
                <ResultMark result={r.summary.result} />
              </dd>
            </div>
            <div className={styles.tile}>
              <dt>Rank</dt>
              <dd>{r.summary.rank !== null ? `${r.summary.rank} / ${r.summary.rankedOf}` : '—'}</dd>
            </div>
          </dl>
          <p className={styles.hint} style={{ marginTop: 'var(--space-3)' }}>
            Percentage = total obtained ÷ total maximum. Rank among the {r.summary.rankedOf}{' '}
            students of{' '}
            {r.summary.rankScope === 'CLASS'
              ? `class ${r.section.className}`
              : `${r.section.className} ${r.section.sectionName}`}{' '}
            with a complete result; equal totals share a rank.
          </p>
        </Panel>
      ) : (
        <Alert tone="info" title="Complete result not available yet">
          {r.availableCount === 0
            ? 'No subject of this exam is finalised yet.'
            : `${r.subjects.filter((s) => s.available && s.countsInResult).length} of ${r.requiredCount} subjects are finalised. Total, percentage and rank appear when every subject is finalised.`}
        </Alert>
      )}

      <Panel title="Subjects">
        {r.subjects.length === 0 ? (
          <p className={styles.hint}>This exam has no subjects for your class.</p>
        ) : (
          <SubjectTable subjects={r.subjects} />
        )}
      </Panel>
    </>
  );
}

function marksDetail(s: SubjectResultView): string | null {
  const parts: string[] = [];
  if (s.components && s.components.length > 1)
    parts.push(s.components.map((c) => `${c.label} ${c.obtained}/${c.max}`).join(' + '));
  if (s.normalized !== null && s.normalizedMax !== null)
    parts.push(`${s.obtained}/${s.totalMax} converted to ${s.normalized}/${s.normalizedMax}`);
  return parts.length ? parts.join(' · ') : null;
}

function SubjectTable({ subjects }: { subjects: SubjectResultView[] }) {
  const phone = useMediaQuery('(max-width: 767px)');
  if (phone) {
    return (
      <ul className={styles.subjects} aria-label="Subject results">
        {subjects.map((s) => {
          const detail = marksDetail(s);
          return (
            <li key={s.subjectId} className={styles.subjectRow}>
              <div>
                <span className={styles.name}>{s.subjectName}</span>
                {!s.countsInResult && <span className={styles.sub}>Not counted in the total</span>}
                {detail && <span className={styles.sub}>{detail}</span>}
              </div>
              <div className={styles.subjectMarks}>
                {s.available ? (
                  <>
                    <span className={styles.big}>{s.final}</span> / {s.finalMax}
                    <span className={styles.sub}>
                      {s.grade ? `Grade ${s.grade} · ` : ''}
                      <ResultMark result={s.result} />
                    </span>
                  </>
                ) : (
                  <span className={styles.notEntered}>Not yet available</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} aria-label="Subject results">
        <thead>
          <tr>
            <th scope="col">Subject</th>
            <th scope="col" className={styles.num}>
              Max
            </th>
            <th scope="col" className={styles.num}>
              Obtained
            </th>
            <th scope="col">Grade</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {subjects.map((s) => {
            const detail = marksDetail(s);
            return (
              <tr key={s.subjectId}>
                <td className={styles.name}>
                  {s.subjectName}
                  {!s.countsInResult && (
                    <span className={styles.sub}>Not counted in the total</span>
                  )}
                  {detail && <span className={styles.sub}>{detail}</span>}
                </td>
                <td className={styles.num}>{s.finalMax}</td>
                {s.available ? (
                  <>
                    <td className={styles.num}>{s.final}</td>
                    <td>{s.grade ?? '—'}</td>
                    <td>
                      <ResultMark result={s.result} />
                    </td>
                  </>
                ) : (
                  <td colSpan={3}>
                    <span className={styles.notEntered}>Not yet available</span>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

function ClassResults() {
  const { params, set } = useSelection();
  const year = params.get('year');
  const options = useResource(`result-options:${year ?? ''}`, (signal) =>
    resultsApi.options(year, signal),
  );
  const data = options.status === 'ready' ? options.data : null;
  const examId =
    data?.exams.find((e) => e.id === params.get('exam'))?.id ?? data?.exams[0]?.id ?? null;
  const sectionId =
    data?.sections.find((s) => s.sectionId === params.get('section'))?.sectionId ??
    data?.sections[0]?.sectionId ??
    null;
  const result = useResource(
    examId && sectionId ? `class-result:${examId}:${sectionId}` : null,
    (signal) => resultsApi.classResult(examId!, sectionId!, signal),
  );

  return (
    <MarksLayout
      title="Results"
      description="Finalised results of a class. Only submitted marks are counted; rank uses complete results only."
    >
      {options.status === 'loading' && <LoadingState />}
      {options.status === 'error' && (
        <ErrorState message={options.error} onRetry={options.reload} />
      )}
      {data && (
        <>
          <YearExamPicker options={data} examId={examId} onChange={set}>
            {data.sections.length > 0 && (
              <SelectField
                label="Class"
                value={sectionId ?? ''}
                onChange={(e) => set('section', e.target.value)}
                options={data.sections.map((s) => ({
                  value: s.sectionId,
                  label: `${s.className} ${s.sectionName}`,
                }))}
              />
            )}
          </YearExamPicker>
          {data.sections.length === 0 ? (
            <Panel>
              <EmptyState icon={ChartColumn} title="No class to show">
                Class results are available to the class teacher of a class and to administrators.
              </EmptyState>
            </Panel>
          ) : data.exams.length === 0 ? (
            <Panel>
              <EmptyState icon={ChartColumn} title="No open exams in this year">
                Results appear once an exam is opened for marks.
              </EmptyState>
            </Panel>
          ) : result.status === 'loading' ? (
            <LoadingState />
          ) : result.status === 'error' ? (
            <ErrorState message={result.error} onRetry={result.reload} />
          ) : result.status === 'ready' ? (
            <ClassResultTable view={result.data} />
          ) : null}
        </>
      )}
    </MarksLayout>
  );
}

function ClassResultTable({ view }: { view: ClassResultView }) {
  const phone = useMediaQuery('(max-width: 767px)');
  const submitted = view.subjects.filter((s) => s.status === 'SUBMITTED').length;
  return (
    <>
      <Panel
        title={`${view.exam.name} — ${view.section.className} ${view.section.sectionName}`}
        description={`${submitted} of ${view.subjects.length} subjects finalised · ${view.rankedOf} of ${view.students.length} students have a complete result`}
      >
        <ul className={styles.sheetList} aria-label="Subjects">
          {view.subjects.map((s) => (
            <li key={s.subjectId} className={styles.sheetItem}>
              <span>
                {s.subjectName}
                {!s.countsInResult && <span className={styles.sub}>Not counted in the total</span>}
              </span>
              <SheetStatusBadge status={s.status} />
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Students">
        {view.students.length === 0 ? (
          <p className={styles.hint}>No students in this class for this exam.</p>
        ) : phone ? (
          <ul className={styles.cards} aria-label="Class results">
            {view.students.map((st) => (
              <li key={st.studentId} className={styles.card}>
                <div className={styles.cardHead}>
                  <span className={styles.roll}>{st.rollNumber ?? '—'}</span>
                  <span className={styles.name}>{st.fullName}</span>
                </div>
                {st.summary ? (
                  <div className={styles.cardResult}>
                    <span>
                      Total <strong>{st.summary.total}</strong> / {st.summary.max}
                    </span>
                    <span>{formatPercent(st.summary.percentage)}</span>
                    <ResultMark result={st.summary.result} />
                    <span>
                      Rank {st.summary.rank} / {st.summary.rankedOf}
                    </span>
                  </div>
                ) : (
                  <Badge tone="inactive">Incomplete</Badge>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table} aria-label="Class results">
              <thead>
                <tr>
                  <th scope="col">Roll</th>
                  <th scope="col">Student</th>
                  {view.subjects.map((s) => (
                    <th key={s.subjectId} scope="col" className={styles.num}>
                      {s.subjectName} /{s.finalMax}
                    </th>
                  ))}
                  <th scope="col" className={styles.num}>
                    Total
                  </th>
                  <th scope="col" className={styles.num}>
                    %
                  </th>
                  <th scope="col">Result</th>
                  <th scope="col" className={styles.num}>
                    Rank
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.students.map((st) => (
                  <tr key={st.studentId}>
                    <td className={styles.roll}>{st.rollNumber ?? '—'}</td>
                    <td className={styles.name}>
                      {st.fullName}
                      <span className={styles.sub}>{st.admissionNumber}</span>
                    </td>
                    {st.cells.map((c) => (
                      <td key={c.subjectId} className={styles.num}>
                        {c.final === null ? (
                          <span className={styles.notEntered}>—</span>
                        ) : (
                          <>
                            {c.final}
                            {c.grade && <span className={styles.sub}>{c.grade}</span>}
                          </>
                        )}
                      </td>
                    ))}
                    {st.summary ? (
                      <>
                        <td className={styles.num}>
                          {st.summary.total} / {st.summary.max}
                        </td>
                        <td className={styles.num}>{formatPercent(st.summary.percentage)}</td>
                        <td>
                          <ResultMark result={st.summary.result} />
                        </td>
                        <td className={styles.num}>
                          {st.summary.rank} / {st.summary.rankedOf}
                        </td>
                      </>
                    ) : (
                      <td colSpan={4}>
                        <Badge tone="inactive">Incomplete</Badge>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
