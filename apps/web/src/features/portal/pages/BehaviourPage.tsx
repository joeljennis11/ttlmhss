import { useState } from 'react';
import { useSearchParams } from 'react-router';
import type { BehaviourOptionsView, BehaviourSheetView } from '@ttlmhss/shared';
import { History, Save, Send, Smile } from 'lucide-react';
import { Panel } from '../../../components/layout/Page';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FormDialog,
  LoadingState,
  SelectField,
  TextAreaField,
  useToast,
} from '../../../components/ui';
import { ApiClientError } from '../../../lib/api-client';
import { formatDateTime } from '../../../lib/format';
import { useMediaQuery } from '../../../lib/use-media-query';
import { messageOf, useResource } from '../../../lib/use-resource';
import { useLeaveGuard } from '../../attendance/attendance-shared';
import { behaviourApi } from '../api';
import { PortalLayout } from '../portal-shared';
import styles from '../portal.module.css';

/**
 * /behaviour — exam-based behaviour for a class (class teacher: own section; administrators: any).
 * Year → exam → class, then one row per student with a 1–5 rating per configured category and an
 * optional remark. Save draft → Submit (published to students); corrections need a reason.
 */
export function BehaviourPage() {
  const [params, setParams] = useSearchParams();
  const year = params.get('year');
  const options = useResource(`behaviour-options:${year ?? ''}`, (signal) =>
    behaviourApi.options(year, signal),
  );
  const data = options.status === 'ready' ? options.data : null;
  const examId =
    data?.exams.find((e) => e.id === params.get('exam'))?.id ?? data?.exams[0]?.id ?? null;
  const sectionId =
    data?.sections.find((s) => s.sectionId === params.get('section'))?.sectionId ??
    data?.sections[0]?.sectionId ??
    null;
  const set = (key: string, value: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.set(key, value);
        if (key === 'year') next.delete('exam');
        return next;
      },
      { replace: true },
    );

  return (
    <PortalLayout
      title="Behaviour"
      description="Behaviour is assessed once per exam for each student, in every configured category, from 1 to 5."
    >
      {options.status === 'loading' && <LoadingState />}
      {options.status === 'error' && (
        <ErrorState message={options.error} onRetry={options.reload} />
      )}
      {data && (
        <>
          <Pickers data={data} examId={examId} sectionId={sectionId} onChange={set} />
          {data.setupProblems.map((p) => (
            <Alert key={p} tone="warning">
              {p}
            </Alert>
          ))}
          {data.sections.length === 0 ? (
            <Panel>
              <EmptyState icon={Smile} title="No class to show">
                Behaviour is recorded by the class teacher of a class, or by an administrator.
              </EmptyState>
            </Panel>
          ) : !examId ? (
            <Panel>
              <EmptyState icon={Smile} title="No open exams in this year">
                Behaviour is recorded per exam, once an exam is opened.
              </EmptyState>
            </Panel>
          ) : sectionId ? (
            <SheetLoader key={`${examId}:${sectionId}`} examId={examId} sectionId={sectionId} />
          ) : null}
        </>
      )}
    </PortalLayout>
  );
}

function Pickers({
  data,
  examId,
  sectionId,
  onChange,
}: {
  data: BehaviourOptionsView;
  examId: string | null;
  sectionId: string | null;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div className={styles.toolbar}>
      <SelectField
        label="Academic year"
        value={data.academicYearId ?? ''}
        onChange={(e) => onChange('year', e.target.value)}
        options={data.years.map((y) => ({
          value: y.id,
          label: y.status === 'CURRENT' ? `${y.label} (current)` : y.label,
        }))}
      />
      {data.exams.length > 0 && (
        <SelectField
          label="Exam"
          value={examId ?? ''}
          onChange={(e) => onChange('exam', e.target.value)}
          options={data.exams.map((e) => ({ value: e.id, label: e.name }))}
        />
      )}
      {data.sections.length > 0 && (
        <SelectField
          label="Class"
          value={sectionId ?? ''}
          onChange={(e) => onChange('section', e.target.value)}
          options={data.sections.map((s) => ({
            value: s.sectionId,
            label: `${s.className} ${s.sectionName}`,
          }))}
        />
      )}
    </div>
  );
}

function SheetLoader({ examId, sectionId }: { examId: string; sectionId: string }) {
  const view = useResource(`behaviour-sheet:${examId}:${sectionId}`, (signal) =>
    behaviourApi.sheet({ examId, sectionId }, signal),
  );
  if (view.status === 'loading') return <LoadingState />;
  if (view.status === 'error') return <ErrorState message={view.error} onRetry={view.reload} />;
  return (
    <Sheet
      key={`${view.data.revision ?? 0}:${view.data.status}`}
      view={view.data}
      onChanged={view.replace}
      onReload={view.reload}
    />
  );
}

interface Edit {
  ratings: Record<string, number | null>;
  remark: string;
}

function Sheet({
  view,
  onChanged,
  onReload,
}: {
  view: BehaviourSheetView;
  onChanged: (v: BehaviourSheetView) => void;
  onReload: () => void;
}) {
  const toast = useToast();
  const phone = useMediaQuery('(max-width: 767px)');
  const { access } = view;
  const active = view.categories.filter((c) => c.active);
  const [edits, setEdits] = useState<Map<string, Edit>>(new Map());
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null);
  const [error, setError] = useState<{ message: string; stale: boolean } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  type Row = BehaviourSheetView['rows'][number];

  const current = (row: Row): Edit =>
    edits.get(row.studentId) ?? { ratings: { ...row.ratings }, remark: row.remark ?? '' };
  const changed = view.rows.filter((row) => {
    const e = edits.get(row.studentId);
    if (!e) return false;
    return (
      (e.remark.trim() || null) !== row.remark ||
      active.some((c) => (e.ratings[c.id] ?? null) !== (row.ratings[c.id] ?? null))
    );
  });
  const dirty = changed.length > 0;
  const guard = useLeaveGuard(
    dirty,
    'Your behaviour ratings are not saved yet. If you leave now they will be lost.',
  );
  const complete = (row: Row) => active.every((c) => (current(row).ratings[c.id] ?? null) !== null);
  const onRoll = view.rows.filter((r) => r.onRoll);
  const completeNow = onRoll.filter(complete).length;
  const set = (row: Row, change: Partial<Edit>) =>
    setEdits((prev) => new Map(prev).set(row.studentId, { ...current(row), ...change }));

  function failed(e: unknown) {
    const stale = e instanceof ApiClientError && e.status === 409 && /Reload it/.test(e.message);
    setError({ message: messageOf(e), stale });
  }

  async function save(withReason: string | null) {
    const tooLong = changed.find((r) => current(r).remark.length > 300);
    if (tooLong) {
      setError({
        message: `The remark for ${tooLong.fullName} is longer than 300 characters.`,
        stale: false,
      });
      return;
    }
    setBusy('save');
    setError(null);
    try {
      const result = await behaviourApi.save({
        examId: view.exam.id,
        sectionId: view.section.sectionId,
        revision: view.revision,
        rows: changed.map((row) => ({
          studentId: row.studentId,
          ratings: active.map((c) => ({
            categoryId: c.id,
            rating: current(row).ratings[c.id] ?? null,
          })),
          remark: current(row).remark,
        })),
        ...(withReason ? { reason: withReason } : {}),
      });
      setEdits(new Map());
      setReasonOpen(false);
      setReason('');
      onChanged(result);
      toast.show(
        withReason
          ? 'Correction saved'
          : `Draft saved · ${result.counts.complete} / ${result.counts.total} students complete`,
      );
    } catch (e) {
      setReasonOpen(false);
      failed(e);
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    setBusy('submit');
    setError(null);
    try {
      const result = await behaviourApi.submit({
        examId: view.exam.id,
        sectionId: view.section.sectionId,
        revision: view.revision ?? 1,
      });
      setConfirm(false);
      onChanged(result);
      toast.show('Behaviour submitted — students can now see it');
    } catch (e) {
      setConfirm(false);
      failed(e);
    } finally {
      setBusy(null);
    }
  }

  const ratingSelect = (row: Row, categoryId: string, name: string) => (
    <select
      className={styles.control}
      aria-label={`${name} for ${row.fullName}`}
      value={current(row).ratings[categoryId] ?? ''}
      disabled={!access.canEdit || !row.onRoll || busy !== null}
      onChange={(e) =>
        set(row, {
          ratings: {
            ...current(row).ratings,
            [categoryId]: e.target.value === '' ? null : Number(e.target.value),
          },
        })
      }
    >
      <option value="">– Not rated</option>
      {view.labels.map((l) => (
        <option key={l.rating} value={l.rating}>
          {l.rating} — {l.label}
        </option>
      ))}
    </select>
  );
  const remarkInput = (row: Row) => (
    <input
      className={styles.control}
      type="text"
      maxLength={300}
      aria-label={`Remark for ${row.fullName}`}
      placeholder="Optional"
      value={current(row).remark}
      disabled={!access.canEdit || !row.onRoll || busy !== null}
      onChange={(e) => set(row, { remark: e.target.value })}
    />
  );

  return (
    <>
      {guard}
      {access.readOnlyReason && <Alert tone="info">{access.readOnlyReason}</Alert>}
      {access.correction && access.canEdit && (
        <Alert tone="info" title="Submitted — students can see this">
          Changes are corrections: saving asks for a reason, and every change is recorded.
        </Alert>
      )}
      {error && (
        <Alert tone="error" title={error.stale ? 'Someone else changed this sheet' : 'Not saved'}>
          {error.message}
          {error.stale && (
            <div>
              <Button variant="secondary" size="sm" onClick={onReload}>
                Reload (your unsaved changes are discarded)
              </Button>
            </div>
          )}
        </Alert>
      )}
      <Panel>
        <div className={styles.bar}>
          <div className={styles.statusLine}>
            <Badge
              tone={
                view.status === 'SUBMITTED'
                  ? 'active'
                  : view.revision === null
                    ? 'inactive'
                    : 'info'
              }
            >
              {view.status === 'SUBMITTED'
                ? 'Submitted · visible to students'
                : view.revision === null
                  ? 'Not started'
                  : 'Draft'}
            </Badge>
            <strong aria-live="polite">
              {completeNow} / {onRoll.length} students complete
            </strong>
            {dirty && <Badge tone="info">{changed.length} unsaved</Badge>}
            <span className={styles.meta}>
              {view.submitted
                ? `Submitted ${formatDateTime(view.submitted.at)}${view.submitted.by ? ` by ${view.submitted.by}` : ''}.`
                : 'Drafts are not visible to students.'}
            </span>
          </div>
          {access.canEdit && (
            <div className={styles.actions}>
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
                variant={access.correction ? 'primary' : 'secondary'}
                icon={<Save size={18} aria-hidden="true" />}
                disabled={!dirty}
                loading={busy === 'save'}
                loadingLabel="Saving…"
                onClick={() => {
                  if (access.correction) {
                    setReasonError(null);
                    setReasonOpen(true);
                  } else void save(null);
                }}
              >
                {access.correction ? 'Save correction' : 'Save draft'}
              </Button>
              {access.canSubmit && (
                <Button
                  icon={<Send size={18} aria-hidden="true" />}
                  disabled={
                    dirty ||
                    view.revision === null ||
                    completeNow !== onRoll.length ||
                    busy !== null
                  }
                  onClick={() => setConfirm(true)}
                >
                  Submit behaviour
                </Button>
              )}
            </div>
          )}
        </div>
      </Panel>

      <Panel title={`${view.exam.name} — ${view.section.className} ${view.section.sectionName}`}>
        {view.rows.length === 0 ? (
          <p className={styles.hint}>No students are placed in this class for this exam.</p>
        ) : phone ? (
          <ul className={styles.sheetCards} aria-label="Behaviour">
            {view.rows.map((row) => (
              <li
                key={row.studentId}
                className={styles.sheetCard}
                data-unsaved={changed.includes(row) ? '' : undefined}
              >
                <span className={styles.strong}>
                  {row.rollNumber ? `${row.rollNumber}. ` : ''}
                  {row.fullName}
                </span>
                {active.map((c) => (
                  <label key={c.id}>
                    {c.name}
                    {ratingSelect(row, c.id, c.name)}
                  </label>
                ))}
                <label>
                  Remark
                  {remarkInput(row)}
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table} aria-label="Behaviour">
              <thead>
                <tr>
                  <th scope="col">Roll</th>
                  <th scope="col">Student</th>
                  {active.map((c) => (
                    <th key={c.id} scope="col" title={c.description ?? undefined}>
                      {c.name}
                    </th>
                  ))}
                  <th scope="col">Remark</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => (
                  <tr key={row.studentId} data-unsaved={changed.includes(row) ? '' : undefined}>
                    <td>{row.rollNumber ?? '—'}</td>
                    <td className={styles.strong}>
                      {row.fullName}
                      <span className={styles.sub}>
                        {row.admissionNumber}
                        {!row.onRoll && ' · no longer in this class'}
                      </span>
                    </td>
                    {active.map((c) => (
                      <td key={c.id}>{ratingSelect(row, c.id, c.name)}</td>
                    ))}
                    <td>{remarkInput(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={styles.hint} style={{ marginTop: 'var(--space-3)' }}>
          Ratings: {view.labels.map((l) => `${l.rating} = ${l.label}`).join(' · ')}
        </p>
      </Panel>

      <Panel
        title="History"
        actions={
          <Button
            variant="ghost"
            size="sm"
            icon={<History size={16} aria-hidden="true" />}
            aria-expanded={showHistory}
            onClick={() => setShowHistory((v) => !v)}
          >
            {showHistory ? 'Hide history' : 'Show history'}
          </Button>
        }
      >
        {showHistory ? (
          <SheetHistory view={view} />
        ) : (
          <p className={styles.hint}>Every rating, submission and correction is recorded.</p>
        )}
      </Panel>

      <ConfirmDialog
        open={confirm}
        title="Submit behaviour?"
        confirmLabel="Submit"
        pending={busy === 'submit'}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void submit()}
      >
        <p>
          {onRoll.length} students of {view.section.className} {view.section.sectionName} will see
          their ratings and remarks for {view.exam.name}. Later changes are corrections with a
          reason.
        </p>
      </ConfirmDialog>
      <FormDialog
        open={reasonOpen}
        title="Why is this being corrected?"
        description={
          <p>Students already see this behaviour. The reason is recorded with the change.</p>
        }
        submitLabel="Save correction"
        pending={busy === 'save'}
        onClose={() => setReasonOpen(false)}
        onSubmit={() => {
          if (reason.trim().length < 5) {
            setReasonError('Give a reason of at least 5 characters');
            return;
          }
          void save(reason.trim());
        }}
      >
        <TextAreaField
          label="Reason"
          required
          maxLength={300}
          value={reason}
          error={reasonError ?? undefined}
          onChange={(e) => setReason(e.target.value)}
        />
      </FormDialog>
    </>
  );
}

function SheetHistory({ view }: { view: BehaviourSheetView }) {
  const key = { examId: view.exam.id, sectionId: view.section.sectionId };
  const history = useResource(
    `behaviour-history:${key.examId}:${key.sectionId}:${view.revision ?? 0}`,
    (signal) => behaviourApi.history(key, signal),
  );
  if (history.status === 'loading') return <LoadingState />;
  if (history.status === 'error')
    return <ErrorState message={history.error} onRetry={history.reload} />;
  if (history.data.length === 0) return <p className={styles.hint}>Nothing recorded yet.</p>;
  return (
    <ul className={styles.list} aria-label="History">
      {history.data.map((h, i) => (
        <li key={`${h.at}:${i}`} className={styles.listItem}>
          <span>
            <strong>{h.summary}</strong>
            <span className={styles.sub}>
              {formatDateTime(h.at)}
              {h.actor ? ` · ${h.actor}` : ''}
              {h.reason ? ` · Reason: ${h.reason}` : ''}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
