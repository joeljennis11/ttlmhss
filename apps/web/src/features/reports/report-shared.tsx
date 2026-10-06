import { useState, type ReactNode } from 'react';
import type { AttendanceCounts, StudentExamResultView } from '@ttlmhss/shared';
import { Download } from 'lucide-react';
import { Badge, Button, useToast, type BadgeTone } from '../../components/ui';
import { formatPercent } from '../../lib/format';
import { messageOf } from '../../lib/use-resource';
import { downloadReport, withFormat } from './api';
import styles from './reports.module.css';

export const NOT_AVAILABLE = 'Not available';
export const pctText = (v: number | null | undefined) =>
  v === null || v === undefined ? NOT_AVAILABLE : formatPercent(v);
const num = (v: number | null | undefined) =>
  v === null || v === undefined ? '' : String(Number(v.toFixed(2)));

/** A button that asks the server for the generated file and saves it. */
export function DownloadButton({
  path,
  format = 'pdf',
  label,
  disabled,
  variant = 'secondary',
  size = 'sm',
}: {
  path: string;
  format?: 'pdf' | 'xlsx';
  label?: ReactNode;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md';
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size={size}
      variant={variant}
      disabled={disabled || busy}
      loading={busy}
      icon={<Download size={16} aria-hidden="true" />}
      onClick={async () => {
        setBusy(true);
        try {
          const name = await downloadReport(withFormat(path, format));
          toast.show(`${name} downloaded`);
        } catch (e) {
          toast.show(messageOf(e), 'error');
        } finally {
          setBusy(false);
        }
      }}
    >
      {label ?? (format === 'pdf' ? 'PDF' : 'Excel')}
    </Button>
  );
}

export function Facts({ items }: { items: readonly [string, ReactNode][] }) {
  return (
    <dl className={styles.facts}>
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v === '' || v === null ? NOT_AVAILABLE : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CountsFacts({ counts }: { counts: AttendanceCounts }) {
  return (
    <Facts
      items={[
        ['Present (P)', counts.P],
        ['Absent (A)', counts.A],
        ['Leave (L)', counts.L],
        ['Excused (C)', counts.C],
        ['Not marked', counts.notMarked],
        ['Attendance', pctText(counts.percentage)],
      ]}
    />
  );
}

const resultText = (r: 'PASS' | 'FAIL' | null) =>
  r === 'PASS' ? 'Pass' : r === 'FAIL' ? 'Fail' : '';

/** The subjects of one exam result, exactly as the report card prints them. */
export function ResultTable({
  result,
  caption,
}: {
  result: StudentExamResultView;
  caption?: string;
}) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>
            <th>Subject</th>
            <th className={styles.num}>Max</th>
            <th className={styles.num}>Obtained</th>
            <th className={styles.num}>%</th>
            <th>Grade</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {result.subjects.map((s) => (
            <tr key={s.subjectId}>
              <td>
                {s.subjectName}
                {!s.countsInResult && <span className={styles.meta}> (not counted)</span>}
              </td>
              {s.available ? (
                <>
                  <td className={styles.num}>{num(s.finalMax)}</td>
                  <td className={styles.num}>{num(s.final)}</td>
                  <td className={styles.num}>{num(s.percent)}</td>
                  <td>{s.grade ?? ''}</td>
                  <td>{resultText(s.result)}</td>
                </>
              ) : (
                <td colSpan={5} className={styles.meta}>
                  Not yet available
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResultSummary({ result }: { result: StudentExamResultView }) {
  const s = result.summary;
  if (!s) {
    return (
      <p className={styles.hint}>
        <Badge tone="warning">Incomplete</Badge> {result.availableCount} of {result.requiredCount}{' '}
        subjects published — the official report card is available once every subject is submitted.
      </p>
    );
  }
  return (
    <Facts
      items={[
        ['Total', `${num(s.total)} / ${num(s.max)}`],
        ['Percentage', pctText(s.percentage)],
        ['Result', resultText(s.result)],
        [
          `Rank (${s.rankScope === 'CLASS' ? 'class' : 'section'})`,
          s.rank !== null ? `${s.rank} of ${s.rankedOf}` : NOT_AVAILABLE,
        ],
      ]}
    />
  );
}

const STATUS: Record<string, { tone: BadgeTone; label: string }> = {
  NONE: { tone: 'inactive', label: 'Not prepared' },
  DRAFT: { tone: 'info', label: 'Draft' },
  FINALIZED: { tone: 'current', label: 'Finalized' },
  PUBLISHED: { tone: 'active', label: 'Published' },
};
export function AnnualStatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.NONE!;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
