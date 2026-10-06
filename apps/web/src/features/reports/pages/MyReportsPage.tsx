import { useState } from 'react';
import { FileText } from 'lucide-react';
import { usePageTitle } from '../../../app/page-meta';
import { PageHeader, Panel } from '../../../components/layout/Page';
import { Badge, EmptyState, ErrorState, LoadingState, TextField } from '../../../components/ui';
import { formatDate, formatDateTime } from '../../../lib/format';
import { useResource } from '../../../lib/use-resource';
import { todayIso } from '../../attendance/attendance-shared';
import { resultsApi } from '../../marks/api';
import { reportPaths, reportsApi } from '../api';
import { DownloadButton, pctText } from '../report-shared';
import styles from '../reports.module.css';

/**
 * /portal/reports — the signed-in student's own reports. The server always uses the session's
 * student: report cards only for complete results, annual reports only once published.
 */
export function MyReportsPage() {
  usePageTitle('My reports');
  const exams = useResource('my-report-exams', (s) => resultsApi.myExams(null, s));
  const annual = useResource('my-annual', (s) => reportsApi.myAnnual(s));
  return (
    <>
      <PageHeader
        title="My reports"
        description="Download your official reports as A4 PDF files."
      />
      <div className={styles.stack}>
        <Panel title="Annual reports">
          {annual.status === 'loading' && <LoadingState />}
          {annual.status === 'error' && (
            <ErrorState message={annual.error} onRetry={annual.reload} />
          )}
          {annual.status === 'ready' &&
            (annual.data.items.length === 0 ? (
              <p className={styles.hint}>
                Not published: your annual report appears here once the school publishes it.
              </p>
            ) : (
              <ul className={styles.list} aria-label="Annual reports">
                {annual.data.items.map((r) => (
                  <li key={r.id} className={styles.row}>
                    <div className={styles.rowMain}>
                      <span className={styles.rowTitle}>Annual report {r.academicYear.label}</span>
                      <span className={styles.meta}>Published {formatDateTime(r.publishedAt)}</span>
                    </div>
                    <DownloadButton
                      path={reportPaths.annual({ academicYearId: r.academicYear.id })}
                      label={
                        <span aria-label={`Annual report ${r.academicYear.label} PDF`}>PDF</span>
                      }
                    />
                  </li>
                ))}
              </ul>
            ))}
        </Panel>

        <Panel
          title="Exam report cards"
          description="Available once every subject of the exam has been submitted."
        >
          {exams.status === 'loading' && <LoadingState />}
          {exams.status === 'error' && <ErrorState message={exams.error} onRetry={exams.reload} />}
          {exams.status === 'ready' &&
            (exams.data.exams.length === 0 ? (
              <EmptyState icon={FileText} title="No exams yet" />
            ) : (
              <ul className={styles.list} aria-label="Exam report cards">
                {exams.data.exams.map((e) => (
                  <ExamCardRow key={e.id} examId={e.id} name={e.name} />
                ))}
              </ul>
            ))}
        </Panel>

        <AttendanceReport />

        <Panel
          title="Performance report"
          description="All your results, attendance, behaviour and achievements of this year."
        >
          <DownloadButton path={reportPaths.performance({})} label="Download performance report" />
        </Panel>
      </div>
    </>
  );
}

function ExamCardRow({ examId, name }: { examId: string; name: string }) {
  const card = useResource(`my-card:${examId}`, (s) => reportsApi.examCard({ examId }, s));
  const complete = card.status === 'ready' && card.data.official;
  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <span className={styles.rowTitle}>{name}</span>
        <span className={styles.meta}>
          {card.status === 'ready'
            ? complete
              ? `Complete · ${pctText(card.data.result.summary?.percentage)}`
              : `Incomplete · ${card.data.result.availableCount} of ${card.data.result.requiredCount} subjects published`
            : card.status === 'error'
              ? card.error
              : 'Loading…'}
        </span>
      </div>
      {complete ? (
        <DownloadButton
          path={reportPaths.examCard({ examId })}
          label={<span aria-label={`Report card PDF for ${name}`}>PDF</span>}
        />
      ) : (
        <Badge tone="inactive">Incomplete</Badge>
      )}
    </li>
  );
}

function AttendanceReport() {
  const today = todayIso();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  return (
    <Panel
      title="Attendance report"
      description={`Lesson by lesson with your attendance percentage (P ÷ (P + A)) for ${formatDate(from)} – ${formatDate(to)}.`}
    >
      <div className={styles.toolbar}>
        <TextField
          label="From"
          type="date"
          value={from}
          max={to}
          onChange={(e) => setFrom(e.target.value)}
        />
        <TextField
          label="To"
          type="date"
          value={to}
          min={from}
          onChange={(e) => setTo(e.target.value)}
        />
        <DownloadButton
          path={reportPaths.studentAttendance({ from, to })}
          label="Download attendance report"
          disabled={!from || !to || from > to}
        />
      </div>
    </Panel>
  );
}
