import { useState } from 'react';
import { Link } from 'react-router';
import {
  CONTINUING_OUTCOMES,
  PROMOTION_OUTCOME_LABELS,
  PromotionOutcome,
  PromotionRequestSchema,
  type PromotionCandidate,
  type PromotionResult,
} from '@ttlmhss/shared';
import { Users } from 'lucide-react';
import { usePageTitle } from '../../../app/page-meta';
import { PageHeader, Panel } from '../../../components/layout/Page';
import {
  Alert,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  SelectField,
  useToast,
} from '../../../components/ui';
import { useFormSubmit } from '../../../lib/use-form-submit';
import { useResource } from '../../../lib/use-resource';
import { promotionApi } from '../api';
import { currentYear, sectionOptions, useSchoolStructure, yearOptions } from '../people-shared';
import admin from '../../admin/admin.module.css';
import styles from '../people.module.css';

interface Row {
  include: boolean;
  outcome: PromotionOutcome;
  targetSectionId: string;
  rollNumber: string;
}

/**
 * Year-end promotion workflow: choose the source class → review students and set each one's
 * outcome → review the summary → confirm. The server applies everything in one transaction.
 */
export function PromotionPage() {
  usePageTitle('Promote students');
  const structure = useSchoolStructure();
  const years = structure.years.status === 'ready' ? structure.years.data : [];
  const classes = structure.classes.status === 'ready' ? structure.classes.data : [];

  const [sourceYearId, setSourceYearId] = useState('');
  const [sourceSectionId, setSourceSectionId] = useState('');
  const [targetYearId, setTargetYearId] = useState('');
  const sourceYear = years.find((y) => y.id === (sourceYearId || currentYear(years)?.id));
  const later = years
    .filter((y) => y.status !== 'CLOSED' && sourceYear && y.startDate > sourceYear.startDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const targetYear = later.find((y) => y.id === targetYearId) ?? later[0] ?? null;

  const key =
    sourceYear && sourceSectionId
      ? `promotion:${sourceYear.id}:${sourceSectionId}:${targetYear?.id ?? ''}`
      : null;
  const candidates = useResource(key, (signal) =>
    promotionApi.candidates(
      {
        sourceAcademicYearId: sourceYear!.id,
        sourceSectionId,
        ...(targetYear ? { targetAcademicYearId: targetYear.id } : {}),
      },
      signal,
    ),
  );

  if (structure.years.status === 'loading' || structure.classes.status === 'loading')
    return <LoadingState />;
  if (structure.years.status === 'error')
    return <ErrorState message={structure.years.error} onRetry={structure.years.reload} />;

  return (
    <>
      <PageHeader
        title="Promote students"
        description="Move a class to the next academic year. Each student gets their own outcome; previous years stay in their history."
        eyebrow={
          <Link to="/students" className={admin.backLink}>
            ← Students
          </Link>
        }
      />
      <ol className={styles.steps} aria-label="Steps">
        <li aria-current={!key ? 'step' : undefined}>Choose class</li>
        <li aria-current={key ? 'step' : undefined}>Set outcomes</li>
        <li>Review and confirm</li>
      </ol>
      <div className={admin.stack}>
        <Panel title="From">
          <div className={admin.toolbar}>
            <SelectField
              label="Academic year"
              options={yearOptions(years)}
              value={sourceYear?.id ?? ''}
              onChange={(e) => {
                setSourceYearId(e.target.value);
                setTargetYearId('');
              }}
            />
            <SelectField
              label="Class and section"
              placeholder="Choose…"
              options={sectionOptions(classes, { includeInactive: true })}
              value={sourceSectionId}
              onChange={(e) => setSourceSectionId(e.target.value)}
            />
            <SelectField
              label="Into academic year"
              placeholder={later.length ? undefined : 'No later year'}
              options={yearOptions(later)}
              value={targetYear?.id ?? ''}
              onChange={(e) => setTargetYearId(e.target.value)}
              hint={later.length ? undefined : 'Add the next year in School setup to promote.'}
            />
          </div>
        </Panel>

        {key && candidates.status === 'loading' && <LoadingState label="Loading students…" />}
        {key && candidates.status === 'error' && (
          <ErrorState message={candidates.error} onRetry={candidates.reload} />
        )}
        {key && candidates.status === 'ready' && sourceYear && (
          <Decisions
            key={key}
            candidates={candidates.data}
            sourceYearId={sourceYear.id}
            sourceSectionId={sourceSectionId}
            targetYearId={targetYear?.id ?? null}
            targetYearLabel={targetYear?.label ?? null}
            sourceLabel={`${sectionOptions(classes, { includeInactive: true }).find((o) => o.value === sourceSectionId)?.label ?? ''}, ${sourceYear.label}`}
            sectionChoices={sectionOptions(classes)}
            onDone={candidates.reload}
          />
        )}
      </div>
    </>
  );
}

function Decisions({
  candidates,
  sourceYearId,
  sourceSectionId,
  targetYearId,
  targetYearLabel,
  sourceLabel,
  sectionChoices,
  onDone,
}: {
  candidates: PromotionCandidate[];
  sourceYearId: string;
  sourceSectionId: string;
  targetYearId: string | null;
  targetYearLabel: string | null;
  sourceLabel: string;
  sectionChoices: { value: string; label: string }[];
  onDone: () => void;
}) {
  const toast = useToast();
  const eligible = candidates.filter((c) => !c.targetPlacement);
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      eligible.map((c) => [
        c.studentId,
        {
          include: Boolean(targetYearId),
          outcome: targetYearId ? 'PROMOTED' : 'LEFT',
          targetSectionId: '',
          rollNumber: c.rollNumber ?? '',
        },
      ]),
    ),
  );
  const [bulkSection, setBulkSection] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<PromotionResult | null>(null);
  const form = useFormSubmit((p) =>
    /^(targetAcademicYearId|decisions\.\d+\.(studentId|targetSectionId|rollNumber|outcome))$/.test(
      p,
    ),
  );

  const chosen = eligible.filter((c) => rows[c.studentId]?.include);
  const counts: Record<PromotionOutcome, number> = {
    PROMOTED: 0,
    NOT_PROMOTED: 0,
    TRANSFERRED: 0,
    LEFT: 0,
  };
  for (const c of chosen) counts[rows[c.studentId]!.outcome]++;
  const update = (id: string, change: Partial<Row>) =>
    setRows((r) => ({ ...r, [id]: { ...r[id]!, ...change } }));
  const errorFor = (studentId: string, field: string) => {
    const index = chosen.findIndex((c) => c.studentId === studentId);
    return index < 0 ? undefined : form.errors[`decisions.${index}.${field}`];
  };

  const request = () => ({
    sourceAcademicYearId: sourceYearId,
    sourceSectionId,
    targetAcademicYearId: targetYearId,
    decisions: chosen.map((c) => {
      const r = rows[c.studentId]!;
      const continues = CONTINUING_OUTCOMES.includes(r.outcome);
      return {
        studentId: c.studentId,
        outcome: r.outcome,
        targetSectionId: continues ? r.targetSectionId || null : null,
        rollNumber: continues && r.rollNumber.trim() ? r.rollNumber.trim() : null,
      };
    }),
  });

  function review() {
    if (form.check(PromotionRequestSchema, request())) setConfirming(true);
  }

  async function submit() {
    const body = form.check(PromotionRequestSchema, request());
    if (!body) return setConfirming(false);
    const outcome = await form.run(() => promotionApi.promote(body));
    setConfirming(false);
    if (outcome.ok) {
      setResult(outcome.value);
      toast.show('Promotion saved');
    }
  }

  if (result) {
    return (
      <Panel title="Done">
        <dl className={styles.summaryList}>
          {(
            [
              ['Promoted', result.promoted],
              ['Not promoted', result.notPromoted],
              ['Transferred out', result.transferred],
              ['Left school', result.left],
            ] as const
          ).map(([label, n]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{n}</dd>
            </div>
          ))}
        </dl>
        <div className={admin.formActions}>
          <Button onClick={onDone}>Continue with this class</Button>
          <Link to="/students" className={admin.textAction}>
            Back to students
          </Link>
        </div>
      </Panel>
    );
  }

  if (candidates.length === 0) {
    return (
      <Panel>
        <EmptyState icon={Users} title="No students in this class">
          Only students currently placed in {sourceLabel} can be promoted from it.
        </EmptyState>
      </Panel>
    );
  }

  return (
    <Panel
      title={`Students in ${sourceLabel}`}
      description={
        targetYearLabel
          ? `Promoted and not-promoted students move into ${targetYearLabel}. Transferred and left students go off roll.`
          : 'There is no later year, so only “Transferred out” and “Left school” can be recorded.'
      }
    >
      {form.formError && <Alert tone="error">{form.formError}</Alert>}
      {candidates.length > eligible.length && (
        <Alert tone="info">
          {candidates.length - eligible.length} student(s) already have a class in {targetYearLabel}{' '}
          and are not listed for promotion.
        </Alert>
      )}
      <div className={styles.assignRow}>
        <SelectField
          label="Next class for all promoted students"
          placeholder="Choose…"
          options={sectionChoices}
          value={bulkSection}
          onChange={(e) => setBulkSection(e.target.value)}
        />
        <Button
          variant="secondary"
          disabled={!bulkSection}
          onClick={() =>
            setRows((r) =>
              Object.fromEntries(
                Object.entries(r).map(([id, row]) => [
                  id,
                  row.outcome === 'PROMOTED' && row.include
                    ? { ...row, targetSectionId: bulkSection }
                    : row,
                ]),
              ),
            )
          }
        >
          Apply to promoted
        </Button>
      </div>
      <div className={styles.spaced}>
        <div className={admin.tableWrap}>
          <table className={`${admin.table} ${admin.stacked} ${styles.decisionTable}`}>
            <caption className="visually-hidden">Outcome for each student</caption>
            <thead>
              <tr>
                <th scope="col">Include</th>
                <th scope="col">Student</th>
                <th scope="col">Outcome</th>
                <th scope="col">Next class</th>
                <th scope="col">New roll no.</th>
              </tr>
            </thead>
            <tbody>
              {eligible.map((c) => {
                const r = rows[c.studentId]!;
                const continues = CONTINUING_OUTCOMES.includes(r.outcome);
                const sectionError = errorFor(c.studentId, 'targetSectionId');
                const rollError = errorFor(c.studentId, 'rollNumber');
                const studentError = errorFor(c.studentId, 'studentId');
                return (
                  <tr key={c.studentId} data-muted={!r.include || undefined}>
                    <td>
                      <input
                        type="checkbox"
                        checked={r.include}
                        aria-label={`Include ${c.fullName}`}
                        onChange={(e) => update(c.studentId, { include: e.target.checked })}
                      />
                    </td>
                    <td className={admin.strong}>
                      {c.fullName}
                      <span className={styles.sub}>
                        {c.admissionNumber}
                        {c.rollNumber ? ` · roll ${c.rollNumber}` : ''}
                      </span>
                      {studentError && (
                        <span className={styles.cellError}>{studentError.join(' ')}</span>
                      )}
                    </td>
                    <td data-label="Outcome">
                      <select
                        aria-label={`Outcome for ${c.fullName}`}
                        value={r.outcome}
                        disabled={!r.include}
                        onChange={(e) =>
                          update(c.studentId, { outcome: e.target.value as PromotionOutcome })
                        }
                      >
                        {PromotionOutcome.values.map((o) => (
                          <option
                            key={o}
                            value={o}
                            disabled={!targetYearId && CONTINUING_OUTCOMES.includes(o)}
                          >
                            {PROMOTION_OUTCOME_LABELS[o]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Next class">
                      {continues ? (
                        <>
                          <select
                            aria-label={`Next class for ${c.fullName}`}
                            value={r.targetSectionId}
                            disabled={!r.include}
                            aria-invalid={sectionError ? true : undefined}
                            onChange={(e) =>
                              update(c.studentId, { targetSectionId: e.target.value })
                            }
                          >
                            <option value="">Choose…</option>
                            {sectionChoices.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          {sectionError && (
                            <span className={styles.cellError}>{sectionError.join(' ')}</span>
                          )}
                        </>
                      ) : (
                        <span className={admin.muted}>Off roll</span>
                      )}
                    </td>
                    <td data-label="New roll no.">
                      {continues ? (
                        <>
                          <input
                            type="text"
                            aria-label={`New roll number for ${c.fullName}`}
                            value={r.rollNumber}
                            maxLength={10}
                            disabled={!r.include}
                            aria-invalid={rollError ? true : undefined}
                            onChange={(e) => update(c.studentId, { rollNumber: e.target.value })}
                          />
                          {rollError && (
                            <span className={styles.cellError}>{rollError.join(' ')}</span>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className={admin.formActions}>
        <Button disabled={chosen.length === 0} onClick={review}>
          Review {chosen.length} {chosen.length === 1 ? 'student' : 'students'}
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Confirm promotion"
        confirmLabel="Promote now"
        pending={form.pending}
        onConfirm={() => void submit()}
        onCancel={() => setConfirming(false)}
      >
        <p>
          From {sourceLabel}
          {targetYearLabel ? ` into ${targetYearLabel}` : ''}:
        </p>
        <ul>
          {(Object.keys(counts) as PromotionOutcome[])
            .filter((o) => counts[o] > 0)
            .map((o) => (
              <li key={o}>
                {PROMOTION_OUTCOME_LABELS[o]}: {counts[o]}
              </li>
            ))}
        </ul>
        <p>
          Transferred and left students are taken off roll and their accounts disabled. Everything
          is saved together, or nothing is.
        </p>
      </ConfirmDialog>
    </Panel>
  );
}
