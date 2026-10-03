import { useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  MARK_LIMIT,
  hasAtMostTwoDecimals,
  scoreSubject,
  toHundredths,
  type MarkComponent,
  type MarkSheetRowView,
  type MarkSheetView,
  type MarkStructure,
} from '@ttlmhss/shared';
import { History, LockOpen, Save, Send } from 'lucide-react';
import { Panel } from '../../../components/layout/Page';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  ErrorState,
  FormDialog,
  LoadingState,
  TextAreaField,
  useToast,
} from '../../../components/ui';
import { ApiClientError } from '../../../lib/api-client';
import { formatDateTime } from '../../../lib/format';
import { useMediaQuery } from '../../../lib/use-media-query';
import { messageOf, useResource } from '../../../lib/use-resource';
import { useLeaveGuard } from '../../attendance/attendance-shared';
import { marksApi } from '../api';
import {
  MarksLayout,
  ResultMark,
  SheetStatusBadge,
  StageBadge,
  describeMaximum,
  formatMark,
} from '../marks-shared';
import styles from '../marks.module.css';

type Edit = Record<MarkComponent, string>;

/** /marks/sheet?examSubjectId=…&sectionId=… — one subject's marks for one class/section. */
export function MarkSheetPage() {
  const [params] = useSearchParams();
  const examSubjectId = params.get('examSubjectId') ?? '';
  const sectionId = params.get('sectionId') ?? '';
  const valid = examSubjectId !== '' && sectionId !== '';
  const view = useResource(valid ? `mark-sheet:${examSubjectId}:${sectionId}` : null, (signal) =>
    marksApi.sheet({ examSubjectId, sectionId }, signal),
  );
  const title =
    view.status === 'ready'
      ? `${view.data.subject.name} — ${view.data.section.className} ${view.data.section.sectionName}`
      : 'Mark sheet';

  return (
    <MarksLayout
      title={title}
      eyebrow={
        <Link to="/marks" className={styles.hint}>
          ← Marks
        </Link>
      }
    >
      {!valid && <ErrorState message="This link is incomplete. Open the sheet from Marks." />}
      {valid && view.status === 'loading' && <LoadingState />}
      {valid && view.status === 'error' && (
        <ErrorState message={view.error} onRetry={view.reload} />
      )}
      {valid && view.status === 'ready' && (
        <Sheet
          key={`${view.data.revision ?? 0}:${view.data.status}`}
          view={view.data}
          onChanged={view.replace}
          onReload={view.reload}
        />
      )}
    </MarksLayout>
  );
}

const asText = (n: number | null) => (n === null ? '' : String(n));

/** '' and '-' mean "not entered"; anything else must be a mark within the maximum. */
function parse(text: string, max: number): { value: number | null; error: string | null } {
  const t = text.trim();
  if (t === '' || t === '-') return { value: null, error: null };
  if (!/^\d+(\.\d+)?$/.test(t)) return { value: null, error: 'Enter a number (or leave blank)' };
  const n = Number(t);
  if (!hasAtMostTwoDecimals(n)) return { value: null, error: 'At most two decimals' };
  if (n > Math.min(max, MARK_LIMIT)) return { value: null, error: `At most ${max}` };
  return { value: n, error: null };
}

function toStructure(view: MarkSheetView): MarkStructure {
  const max = (key: MarkComponent) =>
    view.structure.components.find((c) => c.key === key)?.max ?? null;
  return {
    theoryMax: max('theory') ?? 0,
    internalMax: max('internal'),
    practicalMax: max('practical'),
    passMarks: view.structure.passMarks,
    normalizedMax: view.structure.normalizedMax,
    includeInResult: view.structure.includeInResult,
    gradeScale: view.structure.gradeScale
      ? { id: '', name: view.structure.gradeScale.name, bands: view.structure.gradeScale.bands }
      : null,
  };
}

function Sheet({
  view,
  onChanged,
  onReload,
}: {
  view: MarkSheetView;
  onChanged: (v: MarkSheetView) => void;
  onReload: () => void;
}) {
  const toast = useToast();
  const phone = useMediaQuery('(max-width: 767px)');
  const { access, structure } = view;
  const components = structure.components;
  const [edits, setEdits] = useState<Map<string, Edit>>(new Map());
  const [busy, setBusy] = useState<'save' | 'submit' | 'unlock' | null>(null);
  const [error, setError] = useState<{ message: string; stale: boolean } | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const calc = toStructure(view);

  const original = (row: MarkSheetRowView): Edit => ({
    theory: asText(row.marks.theory),
    internal: asText(row.marks.internal),
    practical: asText(row.marks.practical),
  });
  const current = (row: MarkSheetRowView) => edits.get(row.studentId) ?? original(row);
  const parsed = (row: MarkSheetRowView) => {
    const e = current(row);
    const out = {} as Record<MarkComponent, { value: number | null; error: string | null }>;
    for (const key of ['theory', 'internal', 'practical'] as const) {
      const max = components.find((c) => c.key === key)?.max ?? 0;
      out[key] = parse(e[key], max);
    }
    return out;
  };
  const changed = view.rows.filter((row) => {
    const e = edits.get(row.studentId);
    if (!e) return false;
    const p = parsed(row);
    return components.some((c) => p[c.key].error !== null || p[c.key].value !== row.marks[c.key]);
  });
  const invalid = changed.some((row) => components.some((c) => parsed(row)[c.key].error));
  const dirty = changed.length > 0;
  const guard = useLeaveGuard(
    dirty,
    'Your marks are not saved yet. If you leave now they will be lost.',
  );

  const onRoll = view.rows.filter((r) => r.onRoll);
  const enteredNow = onRoll.filter((row) => {
    const p = parsed(row);
    return components.every((c) => p[c.key].error === null && p[c.key].value !== null);
  }).length;

  const setValue = (row: MarkSheetRowView, key: MarkComponent, text: string) =>
    setEdits((prev) => new Map(prev).set(row.studentId, { ...current(row), [key]: text }));

  function failed(e: unknown) {
    const stale =
      e instanceof ApiClientError && e.status === 409 && /Reload the sheet/.test(e.message);
    setError({ message: messageOf(e), stale });
  }

  async function save() {
    if (invalid) {
      setError({
        message: 'Some marks are not valid. Correct the highlighted boxes.',
        stale: false,
      });
      return;
    }
    setBusy('save');
    setError(null);
    try {
      const result = await marksApi.save({
        examSubjectId: view.examSubjectId,
        sectionId: view.sectionId,
        revision: view.revision,
        marks: changed.map((row) => {
          const p = parsed(row);
          return {
            studentId: row.studentId,
            theory: p.theory.value,
            internal: p.internal.value,
            practical: p.practical.value,
          };
        }),
      });
      setEdits(new Map());
      onChanged(result);
      toast.show(
        `Draft saved · ${result.counts.entered} / ${result.counts.total} students entered`,
      );
    } catch (e) {
      failed(e);
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    setBusy('submit');
    setError(null);
    try {
      const result = await marksApi.submit({
        examSubjectId: view.examSubjectId,
        sectionId: view.sectionId,
        revision: view.revision ?? 1,
      });
      setConfirmSubmit(false);
      onChanged(result);
      toast.show(`${view.subject.name} marks submitted and locked`);
    } catch (e) {
      setConfirmSubmit(false);
      failed(e);
    } finally {
      setBusy(null);
    }
  }

  async function unlock() {
    if (reason.trim().length < 5) {
      setReasonError('Give a reason of at least 5 characters');
      return;
    }
    setBusy('unlock');
    setError(null);
    try {
      const result = await marksApi.unlock({
        examSubjectId: view.examSubjectId,
        sectionId: view.sectionId,
        revision: view.revision ?? 1,
        reason: reason.trim(),
      });
      setUnlockOpen(false);
      setReason('');
      onChanged(result);
      toast.show('Marks unlocked for correction — remember to submit again');
    } catch (e) {
      setUnlockOpen(false);
      failed(e);
    } finally {
      setBusy(null);
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const { row, col } = e.currentTarget.dataset;
    const next = document.querySelector<HTMLInputElement>(
      `input[data-col="${col}"][data-row="${Number(row) + 1}"]`,
    );
    next?.focus();
    next?.select();
  };

  const input = (row: MarkSheetRowView, index: number, key: MarkComponent, label: string) => {
    const p = parsed(row)[key];
    const max = components.find((c) => c.key === key)!.max;
    const id = `mark-${row.studentId}-${key}`;
    const editable = access.canEdit && row.onRoll;
    return (
      <>
        <input
          id={id}
          className={styles.markInput}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-label={`${label} for ${row.fullName} (out of ${max})`}
          aria-invalid={p.error ? true : undefined}
          aria-describedby={p.error ? `${id}-error` : undefined}
          placeholder="-"
          value={current(row)[key]}
          disabled={!editable || busy !== null}
          data-row={index}
          data-col={key}
          onKeyDown={onKeyDown}
          onChange={(e) => setValue(row, key, e.target.value)}
        />
        {p.error && (
          <span id={`${id}-error`} className={styles.cellError}>
            {p.error}
          </span>
        )}
      </>
    );
  };

  /** Preview of what this row would be (server recomputes on submit). */
  const preview = (row: MarkSheetRowView) => {
    if (!edits.has(row.studentId) || view.status === 'SUBMITTED') return row;
    const p = parsed(row);
    const raw = {
      theory: p.theory.value === null ? null : toHundredths(p.theory.value),
      internal: p.internal.value === null ? null : toHundredths(p.internal.value),
      practical: p.practical.value === null ? null : toHundredths(p.practical.value),
    };
    const score = components.some((c) => p[c.key].error) ? null : scoreSubject(calc, raw);
    return {
      ...row,
      total: score ? score.totalCm / 100 : null,
      normalized: score && score.normalizedCm !== null ? score.normalizedCm / 100 : null,
      grade: score?.grade ?? null,
      result: score ? (score.passed ? ('PASS' as const) : ('FAIL' as const)) : null,
    };
  };

  const allEntered = enteredNow === onRoll.length && onRoll.length > 0;

  return (
    <>
      {guard}
      <Panel>
        <dl className={styles.facts}>
          <div>
            <dt>Exam</dt>
            <dd>
              {view.exam.name} <StageBadge stage={view.exam.stage} />
            </dd>
          </div>
          <div>
            <dt>Academic year</dt>
            <dd>{view.academicYear.label}</dd>
          </div>
          <div>
            <dt>Class</dt>
            <dd>
              {view.section.className} {view.section.sectionName}
            </dd>
          </div>
          <div>
            <dt>Subject</dt>
            <dd>{view.subject.name}</dd>
          </div>
          <div>
            <dt>Maximum marks</dt>
            <dd>{describeMaximum(structure)}</dd>
          </div>
          <div>
            <dt>Pass marks</dt>
            <dd>{structure.passMarks}</dd>
          </div>
          {structure.normalizedMax !== null && (
            <div>
              <dt>Converted to</dt>
              <dd>out of {structure.normalizedMax} (marks entered are kept)</dd>
            </div>
          )}
          <div>
            <dt>Grade scale</dt>
            <dd>{structure.gradeScale?.name ?? 'No grades'}</dd>
          </div>
          <div>
            <dt>Mark entry</dt>
            <dd>{view.teacher ? view.teacher.fullName : 'Administrators only'}</dd>
          </div>
        </dl>
      </Panel>

      {view.unlocked && (
        <Alert tone="warning" title="Unlocked for correction">
          Unlocked by {view.unlocked.by ?? 'an administrator'} on {formatDateTime(view.unlocked.at)}
          : “{view.unlocked.reason}”. Students do not see this subject until it is submitted again.
        </Alert>
      )}
      {access.readOnlyReason && <Alert tone="info">{access.readOnlyReason}</Alert>}
      {error && (
        <Alert tone="error" title={error.stale ? 'Someone else changed these marks' : 'Not saved'}>
          {error.message}
          {error.stale && (
            <div>
              <Button variant="secondary" size="sm" onClick={onReload}>
                Reload the sheet (your unsaved changes are discarded)
              </Button>
            </div>
          )}
        </Alert>
      )}

      <Panel>
        <div className={styles.bar}>
          <div className={styles.barInfo}>
            <div className={styles.statusLine}>
              <SheetStatusBadge status={view.revision === null ? null : view.status} />
              <span className={styles.progress} aria-live="polite">
                {enteredNow} / {onRoll.length} students entered
              </span>
              {dirty && (
                <Badge tone="info">
                  {changed.length} unsaved change{changed.length === 1 ? '' : 's'}
                </Badge>
              )}
            </div>
            <p className={styles.hint}>
              {view.submitted
                ? `Submitted ${formatDateTime(view.submitted.at)}${view.submitted.by ? ` by ${view.submitted.by}` : ''}.`
                : view.updatedAt && view.revision !== null
                  ? `Draft saved ${formatDateTime(view.updatedAt)}. Students cannot see drafts.`
                  : 'Nothing saved yet. Leave a box blank for “not entered”; type 0 for a real zero.'}
            </p>
          </div>
          <div className={styles.actions}>
            {access.canEdit && (
              <>
                {dirty && (
                  <Button
                    variant="ghost"
                    onClick={() => setEdits(new Map())}
                    disabled={busy !== null}
                  >
                    Discard changes
                  </Button>
                )}
                <Button
                  variant="secondary"
                  icon={<Save size={18} aria-hidden="true" />}
                  onClick={() => void save()}
                  disabled={!dirty}
                  loading={busy === 'save'}
                  loadingLabel="Saving…"
                >
                  Save draft
                </Button>
              </>
            )}
            {access.canSubmit && (
              <Button
                icon={<Send size={18} aria-hidden="true" />}
                onClick={() => setConfirmSubmit(true)}
                disabled={dirty || !allEntered || view.revision === null || busy !== null}
                title={
                  dirty
                    ? 'Save your changes first'
                    : !allEntered
                      ? 'Enter every mark first'
                      : undefined
                }
              >
                Submit marks
              </Button>
            )}
            {access.canUnlock && (
              <Button
                variant="secondary"
                icon={<LockOpen size={18} aria-hidden="true" />}
                onClick={() => {
                  setReasonError(null);
                  setUnlockOpen(true);
                }}
              >
                Unlock for correction
              </Button>
            )}
          </div>
        </div>
        {access.canSubmit && !allEntered && (
          <p className={styles.hint} style={{ marginTop: 'var(--space-3)' }}>
            Submit becomes available when every student has every mark (0 for a real zero) and the
            draft is saved.
          </p>
        )}
      </Panel>

      <Panel title={`Students (${onRoll.length})`}>
        {view.rows.length === 0 ? (
          <p className={styles.hint}>No students are placed in this class for this exam.</p>
        ) : phone ? (
          <ul className={styles.cards} aria-label="Marks">
            {view.rows.map((row, i) => {
              const shown = preview(row);
              return (
                <li
                  key={row.studentId}
                  className={styles.card}
                  data-unsaved={changed.includes(row) ? '' : undefined}
                >
                  <div className={styles.cardHead}>
                    <span className={styles.roll}>{row.rollNumber ?? '—'}</span>
                    <span className={styles.name}>
                      {row.fullName}
                      {!row.onRoll && <span className={styles.sub}>No longer in this class</span>}
                    </span>
                  </div>
                  <div className={styles.cardFields}>
                    {components.map((c) => (
                      <label key={c.key} htmlFor={`mark-${row.studentId}-${c.key}`}>
                        {c.label} (/{c.max}){input(row, i, c.key, c.label)}
                      </label>
                    ))}
                  </div>
                  <div className={styles.cardResult}>
                    <span>
                      Total <strong>{formatMark(shown.total)}</strong> / {structure.totalMax}
                    </span>
                    {structure.gradeScale && <span>Grade {shown.grade ?? '—'}</span>}
                    <ResultMark result={shown.result} />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table} aria-label="Marks">
              <thead>
                <tr>
                  <th scope="col">Roll</th>
                  <th scope="col">Student</th>
                  {components.map((c) => (
                    <th key={c.key} scope="col">
                      {c.label} (/{c.max})
                    </th>
                  ))}
                  <th scope="col" className={styles.num}>
                    Total /{structure.totalMax}
                  </th>
                  {structure.normalizedMax !== null && (
                    <th scope="col" className={styles.num}>
                      Out of {structure.normalizedMax}
                    </th>
                  )}
                  {structure.gradeScale && <th scope="col">Grade</th>}
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row, i) => {
                  const shown = preview(row);
                  return (
                    <tr
                      key={row.studentId}
                      data-unsaved={changed.includes(row) ? '' : undefined}
                      data-off-roll={row.onRoll ? undefined : ''}
                    >
                      <td className={styles.roll}>{row.rollNumber ?? '—'}</td>
                      <td className={styles.name}>
                        {row.fullName}
                        <span className={styles.sub}>
                          {row.admissionNumber}
                          {!row.onRoll && ' · no longer in this class'}
                        </span>
                      </td>
                      {components.map((c) => (
                        <td key={c.key}>{input(row, i, c.key, c.label)}</td>
                      ))}
                      <td className={styles.num}>
                        {shown.total === null ? (
                          <span className={styles.notEntered}>-</span>
                        ) : (
                          shown.total
                        )}
                      </td>
                      {structure.normalizedMax !== null && (
                        <td className={styles.num}>{formatMark(shown.normalized)}</td>
                      )}
                      {structure.gradeScale && <td>{shown.grade ?? '—'}</td>}
                      <td>
                        <ResultMark result={shown.result} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="History"
        actions={
          <Button
            variant="ghost"
            size="sm"
            icon={<History size={16} aria-hidden="true" />}
            onClick={() => setShowHistory((v) => !v)}
            aria-expanded={showHistory}
          >
            {showHistory ? 'Hide history' : 'Show history'}
          </Button>
        }
      >
        {showHistory ? (
          <SheetHistory view={view} />
        ) : (
          <p className={styles.hint}>Every entry, submission and unlock is recorded.</p>
        )}
      </Panel>

      <ConfirmDialog
        open={confirmSubmit}
        title={`Submit ${view.subject.name} marks?`}
        confirmLabel="Submit and lock"
        pending={busy === 'submit'}
        onCancel={() => setConfirmSubmit(false)}
        onConfirm={() => void submit()}
      >
        <p>
          {onRoll.length} students in {view.section.className} {view.section.sectionName}. After
          submitting, the marks are locked and {view.subject.name} becomes visible to the students.
          Only an administrator or the class teacher can unlock them for correction.
        </p>
      </ConfirmDialog>

      <FormDialog
        open={unlockOpen}
        title="Unlock these marks for correction?"
        description={
          <p>
            The sheet goes back to editing and must be submitted again. Students do not see{' '}
            {view.subject.name} until then. The reason is recorded in the history.
          </p>
        }
        submitLabel="Unlock"
        pendingLabel="Unlocking…"
        pending={busy === 'unlock'}
        onSubmit={() => void unlock()}
        onClose={() => setUnlockOpen(false)}
      >
        <TextAreaField
          label="Reason"
          required
          value={reason}
          maxLength={300}
          error={reasonError ?? undefined}
          hint="For example: Incorrect mark entered for roll 4."
          onChange={(e) => setReason(e.target.value)}
        />
      </FormDialog>
    </>
  );
}

function SheetHistory({ view }: { view: MarkSheetView }) {
  const history = useResource(
    `mark-history:${view.examSubjectId}:${view.sectionId}:${view.revision ?? 0}`,
    (signal) =>
      marksApi.history({ examSubjectId: view.examSubjectId, sectionId: view.sectionId }, signal),
  );
  if (history.status === 'loading') return <LoadingState />;
  if (history.status === 'error')
    return <ErrorState message={history.error} onRetry={history.reload} />;
  if (history.data.length === 0) return <p className={styles.hint}>Nothing recorded yet.</p>;
  return (
    <ul className={styles.history} aria-label="History">
      {history.data.map((h, i) => (
        <li key={`${h.at}:${i}`}>
          <strong>{h.summary}</strong>
          <span className={styles.sub}>
            {formatDateTime(h.at)}
            {h.actor ? ` · ${h.actor}` : ''}
            {h.reason ? ` · Reason: ${h.reason}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}
