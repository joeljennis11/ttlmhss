import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { ReportOptions } from '@ttlmhss/shared';
import { FileText } from 'lucide-react';
import { usePageTitle } from '../../../app/page-meta';
import { PageHeader, Panel } from '../../../components/layout/Page';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  SelectField,
  TextField,
} from '../../../components/ui';
import { formatDate } from '../../../lib/format';
import { useResource } from '../../../lib/use-resource';
import { todayIso } from '../../attendance/attendance-shared';
import { marksApi, resultsApi } from '../../marks/api';
import { reportPaths, reportsApi } from '../api';
import {
  AnnualStatusBadge,
  CountsFacts,
  DownloadButton,
  Facts,
  NOT_AVAILABLE,
  ResultSummary,
  ResultTable,
  pctText,
} from '../report-shared';
import styles from '../reports.module.css';

type Tab = 'cards' | 'sheets' | 'attendance' | 'performance' | 'annual';
const TABS: { id: Tab; label: string; can: (o: ReportOptions) => boolean }[] = [
  { id: 'cards', label: 'Report cards', can: (o) => o.can.examReports },
  { id: 'sheets', label: 'Mark sheets', can: (o) => o.can.markSheets },
  { id: 'attendance', label: 'Attendance', can: (o) => o.can.classAttendance },
  { id: 'performance', label: 'Student performance', can: (o) => o.can.annualReports },
  { id: 'annual', label: 'Annual reports', can: (o) => o.can.annualReports },
];

function useParam() {
  const [params, setParams] = useSearchParams();
  const set = (key: string, value: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  return { params, set };
}

/**
 * /reports — official reports for staff. Each list comes from the existing scoped services; every
 * preview shows the same report document the PDF is generated from.
 */
export function ReportsPage() {
  usePageTitle('Reports');
  const { params } = useParam();
  const year = params.get('year');
  const options = useResource(`rep-options:${year ?? ''}`, (signal) =>
    reportsApi.options(year, signal),
  );
  return (
    <>
      <PageHeader
        title="Reports"
        description="Official A4 reports generated from the school's records: report cards, mark sheets, attendance, student performance and annual reports."
      />
      {options.status === 'loading' && <LoadingState />}
      {options.status === 'error' && (
        <ErrorState message={options.error} onRetry={options.reload} />
      )}
      {options.status === 'ready' && <Hub options={options.data} />}
    </>
  );
}

function Hub({ options }: { options: ReportOptions }) {
  const { params, set } = useParam();
  const tabs = TABS.filter((t) => t.can(options));
  const tab = tabs.find((t) => t.id === params.get('tab'))?.id ?? tabs[0]?.id ?? null;
  const yearId = options.academicYearId;
  const sectionId =
    options.sections.find((s) => s.sectionId === params.get('section'))?.sectionId ??
    options.sections[0]?.sectionId ??
    '';
  if (!tab || !yearId) {
    return (
      <Panel>
        <EmptyState icon={FileText} title="No reports available">
          {yearId ? 'Your account has no reports to produce.' : 'There is no academic year yet.'}
        </EmptyState>
      </Panel>
    );
  }
  const yearSelect = (
    <SelectField
      label="Academic year"
      value={yearId}
      onChange={(e) => set('year', e.target.value)}
      options={options.years.map((y) => ({
        value: y.id,
        label: y.status === 'CURRENT' ? `${y.label} (current)` : y.label,
      }))}
    />
  );
  const sectionSelect = (
    <SelectField
      label="Class"
      value={sectionId}
      placeholder={options.sections.length ? undefined : 'No classes in your scope'}
      onChange={(e) => set('section', e.target.value)}
      options={options.sections.map((s) => ({
        value: s.sectionId,
        label: `${s.className} ${s.sectionName}`,
      }))}
    />
  );
  return (
    <div className={styles.stack}>
      <div className={styles.tabs} role="tablist" aria-label="Report types">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            className={styles.tab}
            onClick={() => set('tab', t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'cards' && (
        <ReportCards
          options={options}
          yearSelect={yearSelect}
          sectionSelect={sectionSelect}
          sectionId={sectionId}
        />
      )}
      {tab === 'sheets' && <MarkSheets yearId={yearId} yearSelect={yearSelect} />}
      {tab === 'attendance' && (
        <Attendance options={options} sectionSelect={sectionSelect} sectionId={sectionId} />
      )}
      {tab === 'performance' && (
        <Performance
          yearId={yearId}
          yearSelect={yearSelect}
          sectionSelect={sectionSelect}
          sectionId={sectionId}
        />
      )}
      {tab === 'annual' && (
        <Annual
          yearId={yearId}
          yearSelect={yearSelect}
          sectionSelect={sectionSelect}
          sectionId={sectionId}
        />
      )}
    </div>
  );
}

// ---- Report cards ---------------------------------------------------------------------------

function ReportCards({
  options,
  yearSelect,
  sectionSelect,
  sectionId,
}: {
  options: ReportOptions;
  yearSelect: React.ReactNode;
  sectionSelect: React.ReactNode;
  sectionId: string;
}) {
  const { params, set } = useParam();
  const exams = options.exams.filter((e) => e.stage !== 'DRAFT');
  const examId = exams.find((e) => e.id === params.get('exam'))?.id ?? exams[0]?.id ?? '';
  const result = useResource(examId && sectionId ? `rep-class:${examId}:${sectionId}` : null, (s) =>
    resultsApi.classResult(examId, sectionId, s),
  );
  const [preview, setPreview] = useState<string | null>(null);
  const card = useResource(preview ? `rep-card:${examId}:${preview}` : null, (s) =>
    reportsApi.examCard({ examId, studentId: preview! }, s),
  );
  return (
    <>
      <div className={styles.toolbar}>
        {yearSelect}
        <SelectField
          label="Exam"
          value={examId}
          placeholder={exams.length ? undefined : 'No open or closed exams'}
          onChange={(e) => set('exam', e.target.value)}
          options={exams.map((e) => ({ value: e.id, label: e.name }))}
        />
        {sectionSelect}
      </div>
      <Panel
        title="Exam report cards"
        description="An official card is produced only for a complete result (every subject submitted)."
      >
        {!examId || !sectionId ? (
          <p className={styles.hint}>Choose an exam and a class.</p>
        ) : result.status === 'loading' ? (
          <LoadingState />
        ) : result.status === 'error' ? (
          <ErrorState message={result.error} onRetry={result.reload} />
        ) : result.data.students.length === 0 ? (
          <p className={styles.hint}>No students in this class for the exam.</p>
        ) : (
          <ul className={styles.list} aria-label="Students">
            {result.data.students.map((st) => (
              <li key={st.studentId} className={styles.row}>
                <div className={styles.rowMain}>
                  <span className={styles.rowTitle}>
                    {st.rollNumber ? `${st.rollNumber}. ` : ''}
                    {st.fullName}
                  </span>
                  <span className={styles.meta}>
                    {st.admissionNumber} ·{' '}
                    {st.complete ? `Complete · ${pctText(st.summary?.percentage)}` : 'Incomplete'}
                  </span>
                </div>
                <div className={styles.actions}>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPreview(preview === st.studentId ? null : st.studentId)}
                    aria-label={`Preview report card of ${st.fullName}`}
                  >
                    Preview
                  </Button>
                  <DownloadButton
                    path={reportPaths.examCard({ examId, studentId: st.studentId })}
                    disabled={!st.complete}
                    label={<span aria-label={`Report card PDF for ${st.fullName}`}>PDF</span>}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {preview && (
        <Panel title="Preview">
          {card.status === 'loading' && <LoadingState />}
          {card.status === 'error' && <ErrorState message={card.error} onRetry={card.reload} />}
          {card.status === 'ready' && (
            <div className={styles.stack}>
              <Facts
                items={[
                  ['Student', card.data.result.student.fullName],
                  ['Admission number', card.data.result.student.admissionNumber],
                  [
                    'Class',
                    `${card.data.result.section.className} ${card.data.result.section.sectionName}`,
                  ],
                  ['Roll number', card.data.result.student.rollNumber ?? NOT_AVAILABLE],
                  ['Exam', card.data.result.exam.name],
                ]}
              />
              <ResultTable result={card.data.result} />
              <ResultSummary result={card.data.result} />
            </div>
          )}
        </Panel>
      )}
    </>
  );
}

// ---- Mark sheets ----------------------------------------------------------------------------

function MarkSheets({ yearId, yearSelect }: { yearId: string; yearSelect: React.ReactNode }) {
  const home = useResource(`rep-marks:${yearId}`, (s) => marksApi.home(yearId, s));
  return (
    <>
      <div className={styles.toolbar}>{yearSelect}</div>
      {home.status === 'loading' && <LoadingState />}
      {home.status === 'error' && <ErrorState message={home.error} onRetry={home.reload} />}
      {home.status === 'ready' &&
        (home.data.exams.length === 0 ? (
          <Panel>
            <EmptyState icon={FileText} title="No mark sheets">
              You have no mark sheets in this academic year.
            </EmptyState>
          </Panel>
        ) : (
          home.data.exams.map((exam) => (
            <Panel key={exam.id} title={exam.name}>
              <ul className={styles.list} aria-label={`Mark sheets — ${exam.name}`}>
                {exam.sheets.map((sh) => (
                  <li key={`${sh.examSubjectId}|${sh.sectionId}`} className={styles.row}>
                    <div className={styles.rowMain}>
                      <span className={styles.rowTitle}>
                        {sh.subjectName} · {sh.className} {sh.sectionName}
                      </span>
                      <span className={styles.meta}>
                        {sh.status === 'SUBMITTED'
                          ? 'Submitted'
                          : sh.status === 'UNLOCKED'
                            ? 'Unlocked for correction'
                            : sh.status === 'DRAFT'
                              ? 'Draft'
                              : 'Not started'}
                      </span>
                    </div>
                    <DownloadButton
                      path={reportPaths.markSheet({
                        examSubjectId: sh.examSubjectId,
                        sectionId: sh.sectionId,
                      })}
                      label={
                        <span
                          aria-label={`Mark sheet PDF for ${sh.subjectName} ${sh.className} ${sh.sectionName}`}
                        >
                          PDF
                        </span>
                      }
                    />
                  </li>
                ))}
              </ul>
            </Panel>
          ))
        ))}
    </>
  );
}

// ---- Attendance -----------------------------------------------------------------------------

function Attendance({
  options,
  sectionSelect,
  sectionId,
}: {
  options: ReportOptions;
  sectionSelect: React.ReactNode;
  sectionId: string;
}) {
  const { params, set } = useParam();
  const year = options.years.find((y) => y.id === options.academicYearId)!;
  const today = todayIso();
  const defaultTo =
    today < year.endDate ? (today > year.startDate ? today : year.startDate) : year.endDate;
  const from = params.get('from') || year.startDate;
  const to = params.get('to') || defaultTo;
  const valid = sectionId && from <= to;
  const report = useResource(valid ? `rep-att:${sectionId}:${from}:${to}` : null, (s) =>
    reportsApi.classAttendance({ sectionId, from, to }, s),
  );
  const path = reportPaths.classAttendance({ sectionId, from, to });
  return (
    <>
      <div className={styles.toolbar}>
        {sectionSelect}
        <TextField
          label="From"
          type="date"
          value={from}
          min={year.startDate}
          max={year.endDate}
          onChange={(e) => set('from', e.target.value)}
        />
        <TextField
          label="To"
          type="date"
          value={to}
          min={year.startDate}
          max={year.endDate}
          onChange={(e) => set('to', e.target.value)}
        />
      </div>
      {!valid && <p className={styles.hint}>Choose a class and a date range.</p>}
      {valid && report.status === 'loading' && <LoadingState />}
      {valid && report.status === 'error' && (
        <ErrorState message={report.error} onRetry={report.reload} />
      )}
      {valid && report.status === 'ready' && (
        <Panel
          title={`Class attendance — ${report.data.summary.section.className} ${report.data.summary.section.sectionName}`}
          description={`${formatDate(report.data.summary.from)} – ${formatDate(report.data.summary.to)} · ${report.data.lessonCount} lessons. Attendance % = P ÷ (P + A).`}
          actions={
            <div className={styles.actions}>
              <DownloadButton path={path} label="PDF" variant="primary" />
              <DownloadButton path={path} format="xlsx" label="Excel" />
            </div>
          }
        >
          <div className={styles.stack}>
            <CountsFacts counts={report.data.summary.counts} />
            {report.data.summary.students.length === 0 ? (
              <p className={styles.hint}>No records: no lessons in this range.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Roll</th>
                      <th>Student</th>
                      <th className={styles.num}>P</th>
                      <th className={styles.num}>A</th>
                      <th className={styles.num}>L</th>
                      <th className={styles.num}>C</th>
                      <th className={styles.num}>Not marked</th>
                      <th className={styles.num}>Attendance</th>
                      <th>Report</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.data.summary.students.map((st) => (
                      <tr key={st.studentId}>
                        <td>{st.rollNumber ?? ''}</td>
                        <td>{st.fullName}</td>
                        <td className={styles.num}>{st.counts.P}</td>
                        <td className={styles.num}>{st.counts.A}</td>
                        <td className={styles.num}>{st.counts.L}</td>
                        <td className={styles.num}>{st.counts.C}</td>
                        <td className={styles.num}>{st.counts.notMarked}</td>
                        <td className={styles.num}>{pctText(st.counts.percentage)}</td>
                        <td>
                          <DownloadButton
                            path={reportPaths.studentAttendance({
                              studentId: st.studentId,
                              from,
                              to,
                            })}
                            label={
                              <span aria-label={`Attendance PDF for ${st.fullName}`}>PDF</span>
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Panel>
      )}
    </>
  );
}

// ---- Performance & annual ------------------------------------------------------------------

function useSectionStudents(yearId: string, sectionId: string) {
  return useResource(sectionId ? `rep-annual-list:${yearId}:${sectionId}` : null, (s) =>
    reportsApi.annualList(yearId, sectionId, s),
  );
}

function Performance({
  yearId,
  yearSelect,
  sectionSelect,
  sectionId,
}: {
  yearId: string;
  yearSelect: React.ReactNode;
  sectionSelect: React.ReactNode;
  sectionId: string;
}) {
  const list = useSectionStudents(yearId, sectionId);
  const [preview, setPreview] = useState<string | null>(null);
  const report = useResource(preview ? `rep-perf:${yearId}:${preview}` : null, (s) =>
    reportsApi.performance({ studentId: preview!, academicYearId: yearId }, s),
  );
  return (
    <>
      <div className={styles.toolbar}>
        {yearSelect}
        {sectionSelect}
      </div>
      <Panel
        title="Student performance"
        description="Every exam result, attendance, behaviour and achievements of the year in one report."
      >
        {list.status === 'loading' && <LoadingState />}
        {list.status === 'error' && <ErrorState message={list.error} onRetry={list.reload} />}
        {list.status === 'ready' &&
          (list.data.students.length === 0 ? (
            <p className={styles.hint}>No students in this class for the year.</p>
          ) : (
            <ul className={styles.list} aria-label="Students">
              {list.data.students.map(({ student }) => (
                <li key={student.id} className={styles.row}>
                  <div className={styles.rowMain}>
                    <span className={styles.rowTitle}>
                      {student.rollNumber ? `${student.rollNumber}. ` : ''}
                      {student.fullName}
                    </span>
                    <span className={styles.meta}>{student.admissionNumber}</span>
                  </div>
                  <div className={styles.actions}>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPreview(preview === student.id ? null : student.id)}
                      aria-label={`Preview performance of ${student.fullName}`}
                    >
                      Preview
                    </Button>
                    <DownloadButton
                      path={reportPaths.performance({
                        studentId: student.id,
                        academicYearId: yearId,
                      })}
                      label={
                        <span aria-label={`Performance PDF for ${student.fullName}`}>PDF</span>
                      }
                    />
                  </div>
                </li>
              ))}
            </ul>
          ))}
      </Panel>
      {preview && (
        <Panel title="Preview">
          {report.status === 'loading' && <LoadingState />}
          {report.status === 'error' && (
            <ErrorState message={report.error} onRetry={report.reload} />
          )}
          {report.status === 'ready' && (
            <div className={styles.stack}>
              <Facts
                items={[
                  ['Student', report.data.student.fullName],
                  [
                    'Class',
                    report.data.section
                      ? `${report.data.section.className} ${report.data.section.sectionName}`
                      : NOT_AVAILABLE,
                  ],
                  [
                    'Attendance',
                    report.data.attendance
                      ? pctText(report.data.attendance.counts.percentage)
                      : NOT_AVAILABLE,
                  ],
                  ['Behaviour assessments', report.data.behaviour.length || 'Not yet assessed'],
                  ['Achievements', report.data.achievements.length || 'No records'],
                ]}
              />
              {report.data.exams.length === 0 ? (
                <p className={styles.hint}>No exam results are available yet.</p>
              ) : (
                report.data.exams.map((r) => (
                  <div key={r.exam.id} className={styles.stack}>
                    <ResultTable result={r} caption={r.exam.name} />
                    <ResultSummary result={r} />
                  </div>
                ))
              )}
            </div>
          )}
        </Panel>
      )}
    </>
  );
}

function Annual({
  yearId,
  yearSelect,
  sectionSelect,
  sectionId,
}: {
  yearId: string;
  yearSelect: React.ReactNode;
  sectionSelect: React.ReactNode;
  sectionId: string;
}) {
  const list = useSectionStudents(yearId, sectionId);
  return (
    <>
      <div className={styles.toolbar}>
        {yearSelect}
        {sectionSelect}
      </div>
      <Panel
        title="Annual reports"
        description="Draft → Finalized (content frozen) → Published (the student can see it). The annual figure uses the exam weightages configured for the year."
      >
        {list.status === 'loading' && <LoadingState />}
        {list.status === 'error' && <ErrorState message={list.error} onRetry={list.reload} />}
        {list.status === 'ready' &&
          (list.data.students.length === 0 ? (
            <p className={styles.hint}>No students in this class for the year.</p>
          ) : (
            <ul className={styles.list} aria-label="Annual reports">
              {list.data.students.map((row) => (
                <li key={row.student.id} className={styles.row}>
                  <div className={styles.rowMain}>
                    <Link
                      className={styles.rowTitle}
                      to={`/reports/annual/${yearId}/${row.student.id}`}
                    >
                      {row.student.rollNumber ? `${row.student.rollNumber}. ` : ''}
                      {row.student.fullName}
                    </Link>
                    <span className={styles.meta}>{row.student.admissionNumber}</span>
                  </div>
                  <AnnualStatusBadge status={row.status} />
                </li>
              ))}
            </ul>
          ))}
      </Panel>
    </>
  );
}
