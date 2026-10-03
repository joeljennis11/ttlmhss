import type { ReactNode } from 'react';
import {
  EXAM_STAGE_LABELS,
  type ExamRef,
  type ExamStage,
  type MarkSheetStatus,
  type MarkStructureView,
  type ResultValue,
} from '@ttlmhss/shared';
import { usePageTitle } from '../../app/page-meta';
import { PageHeader } from '../../components/layout/Page';
import { Badge, type BadgeTone } from '../../components/ui';
import { formatDate } from '../../lib/format';
import styles from './marks.module.css';

/** "42.5" / "-" for not entered. */
export const formatMark = (value: number | null) => (value === null ? '-' : String(value));

const SHEET: Record<MarkSheetStatus | 'NONE', { tone: BadgeTone; label: string }> = {
  NONE: { tone: 'inactive', label: 'Not started' },
  DRAFT: { tone: 'info', label: 'Draft' },
  SUBMITTED: { tone: 'active', label: 'Submitted · locked' },
  UNLOCKED: { tone: 'warning', label: 'Unlocked for correction' },
};

export function SheetStatusBadge({ status }: { status: MarkSheetStatus | null }) {
  const s = SHEET[status ?? 'NONE'];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const STAGE_TONE: Record<ExamStage, BadgeTone> = {
  DRAFT: 'info',
  OPEN: 'active',
  CLOSED: 'inactive',
};

export function StageBadge({ stage }: { stage: ExamStage }) {
  return <Badge tone={STAGE_TONE[stage]}>{EXAM_STAGE_LABELS[stage]}</Badge>;
}

/** Pass / Fail in words (with a symbol), never colour alone. */
export function ResultMark({ result }: { result: ResultValue | null }) {
  if (result === null) return <span className={styles.notEntered}>—</span>;
  return (
    <span className={styles.result} data-result={result}>
      <span aria-hidden="true">{result === 'PASS' ? '✓' : '✗'}</span>
      {result === 'PASS' ? 'Pass' : 'Fail'}
    </span>
  );
}

export function examDates(exam: Pick<ExamRef, 'startDate' | 'endDate'>): string {
  if (!exam.startDate) return 'Dates not set';
  if (!exam.endDate || exam.endDate === exam.startDate) return formatDate(exam.startDate);
  return `${formatDate(exam.startDate)} – ${formatDate(exam.endDate)}`;
}

/** "Theory 80 + Practical 20 = 100" — what a subject's maximum is made of. */
export function describeMaximum(s: MarkStructureView): string {
  if (s.components.length === 1) return String(s.totalMax);
  return `${s.components.map((c) => `${c.label} ${c.max}`).join(' + ')} = ${s.totalMax}`;
}

export function MarksLayout({
  title,
  description,
  eyebrow,
  children,
}: {
  title: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
}) {
  usePageTitle(title);
  return (
    <>
      <PageHeader title={title} description={description} eyebrow={eyebrow} />
      <div className={styles.stack}>{children}</div>
    </>
  );
}
