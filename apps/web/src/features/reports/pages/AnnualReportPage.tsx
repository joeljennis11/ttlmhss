import { useState } from 'react';
import { Link, useParams } from 'react-router';
import type { AnnualReportContent, AnnualReportView } from '@ttlmhss/shared';
import { ArrowLeft } from 'lucide-react';
import { usePageTitle } from '../../../app/page-meta';
import { PageHeader, Panel } from '../../../components/layout/Page';
import {
  Alert,
  Button,
  ConfirmDialog,
  ErrorState,
  FormDialog,
  LoadingState,
  TextAreaField,
  useToast,
} from '../../../components/ui';
import { formatDate, formatDateTime } from '../../../lib/format';
import { useFormSubmit } from '../../../lib/use-form-submit';
import { messageOf, useResource } from '../../../lib/use-resource';
import { RatingText } from '../../portal/portal-shared';
import { reportPaths, reportsApi } from '../api';
import {
  AnnualStatusBadge,
  CountsFacts,
  DownloadButton,
  Facts,
  NOT_AVAILABLE,
  ResultTable,
  pctText,
} from '../report-shared';
import styles from '../reports.module.css';

/**
 * /reports/annual/:yearId/:studentId — one student's annual report for staff: the draft (computed
 * live) or the frozen official content, the remark, and the lifecycle actions the server allows.
 */
export function AnnualReportPage() {
  const { yearId = '', studentId = '' } = useParams();
  const report = useResource(`annual:${yearId}:${studentId}`, (s) =>
    reportsApi.annual({ academicYearId: yearId, studentId }, s),
  );
  usePageTitle('Annual report');
  const back = (
    <Link to={`/reports?tab=annual&year=${yearId}`} className={styles.rowTitle}>
      <ArrowLeft size={14} aria-hidden="true" /> Annual reports
    </Link>
  );
  if (report.status === 'loading') return <LoadingState />;
  if (report.status === 'error') {
    return (
      <>
        <PageHeader title="Annual report" eyebrow={back} />
        <ErrorState message={report.error} onRetry={report.reload} />
      </>
    );
  }
  return (
    <AnnualReport
      view={report.data}
      back={back}
      onChange={report.replace}
      pdfPath={reportPaths.annual({ academicYearId: yearId, studentId })}
    />
  );
}

function AnnualReport({
  view,
  back,
  onChange,
  pdfPath,
}: {
  view: AnnualReportView;
  back: React.ReactNode;
  onChange: (v: AnnualReportView) => void;
  pdfPath: string;
}) {
  const toast = useToast();
  const c = view.content;
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'finalize' | 'publish' | 'unpublish' | null>(null);
  const [reopening, setReopening] = useState(false);

  async function act(work: () => Promise<AnnualReportView>, message: string) {
    setBusy(true);
    try {
      onChange(await work());
      toast.show(message);
    } catch (e) {
      toast.show(messageOf(e), 'error');
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  return (
    <>
      <PageHeader
        title={`Annual report — ${c.student.fullName}`}
        eyebrow={back}
        description={`${c.section.className} ${c.section.sectionName} · Academic year ${c.academicYear.label}`}
        actions={
          <DownloadButton
            path={pdfPath}
            variant="primary"
            size="md"
            label={view.frozen ? 'Download PDF' : 'Draft PDF'}
          />
        }
      />
      <div className={styles.stack}>
        <Panel>
          <div className={styles.stack}>
            <div className={styles.actions}>
              <AnnualStatusBadge status={view.status} />
              {view.finalized && (
                <span className={styles.meta}>
                  Finalized {formatDateTime(view.finalized.at)}
                  {view.finalized.by ? ` by ${view.finalized.by}` : ''}
                </span>
              )}
              {view.published && (
                <span className={styles.meta}>
                  · Published {formatDateTime(view.published.at)}
                  {view.published.by ? ` by ${view.published.by}` : ''}
                </span>
              )}
            </div>
            {view.frozen ? (
              <p className={styles.hint}>
                This is the frozen official content. Later changes to marks, attendance or settings
                do not change it.
              </p>
            ) : (
              <p className={styles.hint}>
                Draft: computed from the current records each time it is opened. Students cannot see
                it.
              </p>
            )}
            {!view.frozen && c.problems.length > 0 && (
              <Alert tone="warning" title="Cannot be finalized yet">
                <ul>
                  {c.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </Alert>
            )}
            <div className={styles.actions}>
              {view.actions.prepare && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => reportsApi.prepare(c.academicYear.id, c.student.id),
                      'Draft prepared',
                    )
                  }
                >
                  Prepare draft
                </Button>
              )}
              {view.status === 'DRAFT' && (
                <Button
                  disabled={busy || !view.actions.finalize || !c.finalRemark}
                  onClick={() => setConfirm('finalize')}
                >
                  Finalize
                </Button>
              )}
              {view.actions.publish && (
                <Button disabled={busy} onClick={() => setConfirm('publish')}>
                  Publish to student
                </Button>
              )}
              {view.actions.unpublish && (
                <Button variant="secondary" disabled={busy} onClick={() => setConfirm('unpublish')}>
                  Unpublish
                </Button>
              )}
              {view.actions.reopen && (
                <Button variant="ghost" disabled={busy} onClick={() => setReopening(true)}>
                  Reopen as draft
                </Button>
              )}
            </div>
          </div>
        </Panel>

        <AnnualContent c={c} />

        <Panel title="G. Remarks">
          {view.actions.editRemark && view.id ? (
            <RemarkEditor view={view} onSaved={onChange} />
          ) : c.finalRemark ? (
            <p className={styles.box}>{c.finalRemark}</p>
          ) : (
            <p className={styles.hint}>
              {view.status === 'NONE' ? 'Prepare the draft to write the remark.' : NOT_AVAILABLE}
            </p>
          )}
          {!view.frozen && c.suggestedRemark && (
            <div className={styles.stack} style={{ marginTop: 'var(--space-4)' }}>
              <span className={styles.subhead}>
                System suggestion (not a teacher remark; never printed on the official report)
              </span>
              <p className={`${styles.box} ${styles.suggestion}`}>{c.suggestedRemark}</p>
            </div>
          )}
        </Panel>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === 'finalize'
            ? 'Finalize this annual report?'
            : confirm === 'publish'
              ? 'Publish to the student?'
              : 'Unpublish this report?'
        }
        confirmLabel={
          confirm === 'finalize' ? 'Finalize' : confirm === 'publish' ? 'Publish' : 'Unpublish'
        }
        pending={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() =>
          confirm &&
          void act(
            () => reportsApi.step(view.id!, confirm, view.revision!),
            confirm === 'finalize'
              ? 'Annual report finalized'
              : confirm === 'publish'
                ? 'Published to the student'
                : 'Unpublished',
          )
        }
      >
        <p>
          {confirm === 'finalize'
            ? 'The content and the remark are frozen as the official report. Later changes to marks, attendance or settings will not change it.'
            : confirm === 'publish'
              ? `${c.student.fullName} will be able to see and download this report.`
              : 'The student will no longer see this report until it is published again.'}
        </p>
      </ConfirmDialog>
      {reopening && (
        <ReopenDialog
          view={view}
          onClose={() => setReopening(false)}
          onDone={(v) => {
            setReopening(false);
            onChange(v);
            toast.show('Reopened as a draft');
          }}
        />
      )}
    </>
  );
}

function RemarkEditor({
  view,
  onSaved,
}: {
  view: AnnualReportView;
  onSaved: (v: AnnualReportView) => void;
}) {
  const toast = useToast();
  const [remark, setRemark] = useState(view.content.finalRemark ?? '');
  const form = useFormSubmit(['remark']);
  return (
    <div className={styles.stack}>
      <TextAreaField
        label="Class teacher's final remark"
        hint="Required before finalizing. Printed on the official report."
        rows={4}
        maxLength={1000}
        value={remark}
        onChange={(e) => setRemark(e.target.value)}
        error={form.errors.remark}
      />
      {form.formError && <Alert tone="error">{form.formError}</Alert>}
      <div className={styles.actions}>
        <Button
          disabled={form.pending}
          onClick={async () => {
            const r = await form.run(() =>
              reportsApi.remark(view.id!, { remark, revision: view.revision! }),
            );
            if (r.ok) {
              onSaved(r.value);
              toast.show('Remark saved');
            }
          }}
        >
          Save remark
        </Button>
        {view.content.suggestedRemark && (
          <Button variant="ghost" onClick={() => setRemark(view.content.suggestedRemark)}>
            Start from the suggestion
          </Button>
        )}
      </div>
    </div>
  );
}

function ReopenDialog({
  view,
  onClose,
  onDone,
}: {
  view: AnnualReportView;
  onClose: () => void;
  onDone: (v: AnnualReportView) => void;
}) {
  const [reason, setReason] = useState('');
  const form = useFormSubmit(['reason']);
  return (
    <FormDialog
      open
      title="Reopen as a draft"
      submitLabel="Reopen"
      pending={form.pending}
      error={form.formError}
      onClose={onClose}
      onSubmit={() =>
        void form
          .run(() => reportsApi.reopen(view.id!, view.revision!, reason))
          .then((r) => r.ok && onDone(r.value))
      }
    >
      <TextAreaField
        label="Reason"
        hint="Recorded in the audit log. The frozen content is discarded and recalculated from the current records."
        rows={3}
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        error={form.errors.reason}
      />
    </FormDialog>
  );
}

/** Sections A–F, the same content the PDF prints. */
export function AnnualContent({ c }: { c: AnnualReportContent }) {
  const withResults = c.exams.filter((e) => e.result);
  return (
    <>
      <Panel title="A. Student information">
        <Facts
          items={[
            ['Student', c.student.fullName],
            ['Admission number', c.student.admissionNumber],
            ['Class and section', `${c.section.className} ${c.section.sectionName}`],
            ['Roll number', c.student.rollNumber ?? NOT_AVAILABLE],
            [
              'Academic year',
              `${c.academicYear.label} (${formatDate(c.academicYear.startDate)} – ${formatDate(c.academicYear.endDate)})`,
            ],
          ]}
        />
      </Panel>
      <Panel title="B. Examination performance">
        {c.exams.length === 0 ? (
          <p className={styles.hint}>No exams with results in this year.</p>
        ) : (
          <div className={styles.stack}>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Exam</th>
                    <th className={styles.num}>Weightage</th>
                    <th className={styles.num}>Total</th>
                    <th className={styles.num}>Percentage</th>
                    <th>Result</th>
                    <th>Rank</th>
                  </tr>
                </thead>
                <tbody>
                  {c.exams.map((e) => {
                    const s = e.result?.summary ?? null;
                    return (
                      <tr key={e.exam.id}>
                        <td>{e.exam.name}</td>
                        <td className={styles.num}>{e.weightagePercent}%</td>
                        <td className={styles.num}>
                          {s ? `${s.total} / ${s.max}` : e.result ? 'Incomplete' : NOT_AVAILABLE}
                        </td>
                        <td className={styles.num}>{s ? pctText(s.percentage) : ''}</td>
                        <td>{s ? (s.result === 'PASS' ? 'Pass' : 'Fail') : ''}</td>
                        <td>{s && s.rank !== null ? `${s.rank} of ${s.rankedOf}` : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {withResults.map((e) => (
              <ResultTable key={e.exam.id} result={e.result!} caption={e.exam.name} />
            ))}
          </div>
        )}
      </Panel>
      <Panel
        title="C. Attendance"
        description={`${formatDate(c.attendance.from)} – ${formatDate(c.attendance.to)} · P ÷ (P + A)`}
      >
        <CountsFacts counts={c.attendance.counts} />
      </Panel>
      <Panel title="D. Behaviour">
        {c.behaviour.length === 0 ? (
          <p className={styles.hint}>Not yet assessed.</p>
        ) : (
          <div className={styles.stack}>
            {c.behaviour.map((b) => (
              <div key={b.exam.id}>
                <h3 className={styles.subhead}>{b.exam.name}</h3>
                <ul className={styles.list}>
                  {b.ratings.map((r) => (
                    <li key={r.categoryId} className={styles.row}>
                      <span>{r.categoryName}</span>
                      <RatingText rating={r.rating} label={r.label} />
                    </li>
                  ))}
                </ul>
                {b.remark && <p className={styles.hint}>Remark: {b.remark}</p>}
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel title="E. Achievements">
        {c.achievements.length === 0 ? (
          <p className={styles.hint}>No records.</p>
        ) : (
          <ul className={styles.list}>
            {c.achievements.map((a) => (
              <li key={a.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <span className={styles.rowTitle}>{a.title}</span>
                  <span className={styles.meta}>
                    {a.category.name} · {formatDate(a.achievedOn)}
                    {a.description ? ` · ${a.description}` : ''}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel
        title="F. Overall academic performance"
        description="Sum of (exam percentage × weightage) ÷ 100, with the weightages configured for the year."
      >
        <div className={styles.stack}>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Exam</th>
                  <th className={styles.num}>Percentage</th>
                  <th className={styles.num}>Weightage</th>
                  <th className={styles.num}>Weighted</th>
                </tr>
              </thead>
              <tbody>
                {c.annual.contributions.map((x) => (
                  <tr key={x.examId}>
                    <td>{x.examName}</td>
                    <td className={styles.num}>{pctText(x.percentage)}</td>
                    <td className={styles.num}>{x.weightagePercent}%</td>
                    <td className={styles.num}>{x.weighted ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Facts
            items={[
              ['Total weightage', `${c.annual.weightageTotalPercent}%`],
              [
                'Annual percentage',
                <span key="a" className={styles.big}>
                  {pctText(c.annual.percentage)}
                </span>,
              ],
            ]}
          />
        </div>
      </Panel>
    </>
  );
}
