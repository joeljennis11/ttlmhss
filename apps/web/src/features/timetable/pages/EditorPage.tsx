import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import type {
  TimetableEditorView,
  TimetableEntryView,
  TimetableOperation,
  TimetableOptions,
  TimetablePeriodView,
  Weekday,
} from '@ttlmhss/shared';
import { CalendarPlus, Layers } from 'lucide-react';
import { Panel } from '../../../components/layout/Page';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  SelectField,
  useToast,
} from '../../../components/ui';
import { ApiClientError } from '../../../lib/api-client';
import { WEEKDAY_LABELS, formatDateTime } from '../../../lib/format';
import { messageOf, useResource } from '../../../lib/use-resource';
import { timetableApi } from '../api';
import { LessonDialog, type LessonTarget, type LessonValues } from '../LessonDialog';
import {
  TimetableLayout,
  TimetableYearGate,
  YearSelect,
  useTimetableYear,
  type TimetableYear,
} from '../TimetableLayout';
import { WeekGrid, slotLabel } from '../WeekGrid';
import { frameNotice } from './ViewPages';
import styles from '../timetable.module.css';

/** Timetable editing: draft → (validated changes) → save → publish. */
export function TimetableEditorPage() {
  const selection = useTimetableYear();
  return (
    <TimetableLayout
      title="Edit timetable"
      description="Changes go into a draft. Each change is checked for clashes; Save draft stores them and Publish timetable makes the draft the live timetable."
    >
      <TimetableYearGate selection={selection}>
        {(year, years) => (
          <Editor
            key={year.id}
            year={year}
            yearSelect={<YearSelect years={years} year={year} onChange={selection.select} />}
          />
        )}
      </TimetableYearGate>
    </TimetableLayout>
  );
}

function Editor({ year, yearSelect }: { year: TimetableYear; yearSelect: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const options = useResource(`tt-options:${year.id}`, (signal) =>
    timetableApi.options(year.id, signal),
  );
  const sections = options.status === 'ready' ? options.data.sections : [];
  const sectionId =
    sections.find((s) => s.sectionId === params.get('section'))?.sectionId ??
    sections[0]?.sectionId ??
    null;

  if (options.status === 'loading') return <LoadingState />;
  if (options.status === 'error') {
    return <ErrorState message={options.error} onRetry={options.reload} />;
  }
  if (!sectionId) {
    return (
      <>
        <div className={styles.toolbar}>{yearSelect}</div>
        <Panel>
          <EmptyState icon={Layers} title="No classes to edit">
            There are no active classes and sections you can edit. Administrators add classes in
            School setup; class teachers can edit only the class they are class teacher of.
          </EmptyState>
        </Panel>
      </>
    );
  }
  return (
    <SectionEditor
      key={sectionId}
      year={year}
      sectionId={sectionId}
      options={options.data}
      yearSelect={yearSelect}
      onSection={(id) =>
        setParams(
          (p) => {
            const next = new URLSearchParams(p);
            next.set('section', id);
            return next;
          },
          { replace: true },
        )
      }
    />
  );
}

/** Entries touched by unsaved changes (shown as "Unsaved"). */
function touchedBy(ops: readonly TimetableOperation[]): Set<string> {
  return new Set(ops.map((op) => (op.op === 'create' ? op.id : op.entryId)));
}

function SectionEditor({
  year,
  sectionId,
  options,
  yearSelect,
  onSection,
}: {
  year: TimetableYear;
  sectionId: string;
  options: TimetableOptions;
  yearSelect: ReactNode;
  onSection: (id: string) => void;
}) {
  const toast = useToast();
  const saved = useResource(`tt-editor:${year.id}:${sectionId}`, (signal) =>
    timetableApi.editor(year.id, sectionId, signal),
  );
  const [pending, setPending] = useState<TimetableOperation[]>([]);
  const [preview, setPreview] = useState<TimetableEditorView | null>(null);
  const [dialog, setDialog] = useState<LessonTarget | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TimetableEntryView | null>(null);
  const [confirm, setConfirm] = useState<'publish' | 'discardDraft' | 'discardChanges' | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [publishProblems, setPublishProblems] = useState<string[]>([]);
  const unsaved = useMemo(() => touchedBy(pending), [pending]);

  // Warn before leaving the page with unsaved changes.
  useEffect(() => {
    if (pending.length === 0) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending.length]);

  if (saved.status === 'loading') return <LoadingState />;
  if (saved.status === 'error') return <ErrorState message={saved.error} onRetry={saved.reload} />;
  const view = preview ?? saved.data;
  const { draft, published } = view;
  const editable = draft !== null && !view.readOnlyYear;
  const label = `${view.section.className} ${view.section.sectionName}`;
  const notice = frameNotice(view.periods, view.workingDays, year.label);

  /** Ask the server to validate the unsaved changes plus these; show the result if accepted. */
  async function propose(ops: TimetableOperation[], where: 'dialog' | 'toast'): Promise<boolean> {
    const next = [...pending, ...ops];
    setBusy('check');
    try {
      const result = await timetableApi.changes(year.id, sectionId, next, true);
      setPending(next);
      setPreview(result);
      return true;
    } catch (error) {
      if (where === 'dialog') setDialogError(messageOf(error));
      else toast.show(messageOf(error), 'error');
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function submitLesson(values: LessonValues) {
    if (!dialog) return;
    let ops: TimetableOperation[];
    if (dialog.kind === 'add') {
      ops = [{ op: 'create', id: crypto.randomUUID(), ...values }];
    } else {
      const e = dialog.entry;
      ops = [];
      if (values.day !== e.day || values.periodId !== e.periodId) {
        ops.push({ op: 'move', entryId: e.id, day: values.day, periodId: values.periodId });
      }
      if (values.subjectId !== e.subjectId || values.teacherId !== e.teacherId) {
        ops.push({
          op: 'update',
          entryId: e.id,
          subjectId: values.subjectId,
          teacherId: values.teacherId,
        });
      }
      if (ops.length === 0) {
        setDialog(null);
        return;
      }
    }
    if (await propose(ops, 'dialog')) {
      setDialog(null);
      if (values.sectionId !== sectionId) {
        toast.show('Lesson added to the draft for another class. Save the draft to keep it.');
      }
    }
  }

  async function move(entry: TimetableEntryView, day: Weekday, period: TimetablePeriodView) {
    const ok = await propose(
      [{ op: 'move', entryId: entry.id, day, periodId: period.id }],
      'toast',
    );
    if (ok) toast.show(`${entry.subjectName} moved to ${slotLabel(day, period)} (unsaved)`);
  }

  async function run(name: string, work: () => Promise<void>) {
    setBusy(name);
    try {
      await work();
    } catch (error) {
      toast.show(messageOf(error), 'error');
    } finally {
      setBusy(null);
    }
  }

  const resetLocal = () => {
    setPending([]);
    setPreview(null);
  };

  const saveDraft = () =>
    run('save', async () => {
      const result = await timetableApi.changes(year.id, sectionId, pending, false);
      saved.replace(result);
      resetLocal();
      setPublishProblems([]);
      toast.show('Draft saved');
    });

  const startDraft = () =>
    run('start', async () => {
      const v = await timetableApi.startDraft(year.id);
      saved.reload();
      toast.show(
        v.entryCount > 0
          ? `Draft started from the published timetable (${v.entryCount} lessons)`
          : 'Draft started',
      );
    });

  const publish = () =>
    run('publish', async () => {
      setConfirm(null);
      try {
        const v = await timetableApi.publish(year.id);
        setPublishProblems([]);
        saved.reload();
        toast.show(`Timetable published (version ${v.versionNumber})`);
      } catch (error) {
        if (error instanceof ApiClientError && error.details.length > 0) {
          setPublishProblems(error.details.map((d) => d.message));
        }
        throw error;
      }
    });

  const discardDraft = () =>
    run('discardDraft', async () => {
      setConfirm(null);
      await timetableApi.discardDraft(year.id);
      resetLocal();
      setPublishProblems([]);
      saved.reload();
      toast.show('Draft discarded. The published timetable is unchanged.');
    });

  return (
    <>
      <div className={styles.toolbar}>
        {yearSelect}
        <SelectField
          label="Class and section"
          value={sectionId}
          disabled={pending.length > 0}
          hint={pending.length > 0 ? 'Save or discard your changes to switch class.' : undefined}
          onChange={(e) => onSection(e.target.value)}
          options={options.sections.map((s) => ({
            value: s.sectionId,
            label: `${s.className} ${s.sectionName}`,
          }))}
        />
      </div>

      <Panel>
        <div className={styles.statusBar}>
          <div className={styles.statusText} aria-live="polite">
            <div className={styles.statusLine}>
              {draft ? (
                <>
                  <Badge tone="warning">Draft</Badge> Version {draft.versionNumber}
                </>
              ) : published ? (
                <>
                  <Badge tone="active">Published</Badge> Version {published.versionNumber}
                </>
              ) : (
                <>
                  <Badge tone="inactive">No timetable</Badge> {year.label}
                </>
              )}
              {pending.length > 0 && (
                <Badge tone="info">
                  {pending.length} unsaved change{pending.length === 1 ? '' : 's'}
                </Badge>
              )}
            </div>
            {draft && (
              <span className={styles.statusMeta}>
                Last saved {formatDateTime(draft.updatedAt)}
                {draft.updatedBy ? ` by ${draft.updatedBy}` : ''}. Not live until published.
              </span>
            )}
            {published && (
              <span className={styles.statusMeta}>
                Live: version {published.versionNumber}, published{' '}
                {published.publishedAt ? formatDateTime(published.publishedAt) : ''}
                {published.publishedBy ? ` by ${published.publishedBy}` : ''}.
              </span>
            )}
          </div>
          {!view.readOnlyYear && (
            <div className={styles.actions}>
              {!draft && (
                <Button
                  icon={<CalendarPlus size={18} aria-hidden="true" />}
                  loading={busy === 'start'}
                  onClick={() => void startDraft()}
                >
                  {published ? 'Edit timetable (new draft)' : 'Create draft'}
                </Button>
              )}
              {draft && (
                <>
                  <Button
                    disabled={pending.length === 0 || busy !== null}
                    loading={busy === 'save'}
                    loadingLabel="Saving…"
                    onClick={() => void saveDraft()}
                  >
                    Save draft
                  </Button>
                  {pending.length > 0 && (
                    <Button
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() => setConfirm('discardChanges')}
                    >
                      Discard changes
                    </Button>
                  )}
                  {view.canPublish && (
                    <Button
                      variant="secondary"
                      disabled={pending.length > 0 || busy !== null}
                      loading={busy === 'publish'}
                      title={pending.length > 0 ? 'Save the draft before publishing' : undefined}
                      onClick={() => setConfirm('publish')}
                    >
                      Publish timetable
                    </Button>
                  )}
                  {view.canPublish && pending.length === 0 && (
                    <Button
                      variant="ghost"
                      disabled={busy !== null}
                      onClick={() => setConfirm('discardDraft')}
                    >
                      Discard draft
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </Panel>

      {view.readOnlyYear && (
        <Alert tone="info">
          {year.label} is closed. Its timetable is kept as history and cannot be changed.
        </Alert>
      )}
      {!draft && published && !view.readOnlyYear && (
        <p className={styles.hint}>
          Showing the live timetable (read-only). Editing starts a new draft from it; the live
          timetable stays as it is until the draft is published.
        </p>
      )}
      {(options.subjects.length === 0 || options.teachers.length === 0) && editable && (
        <Alert tone="warning">
          {options.subjects.length === 0
            ? 'There are no active subjects. '
            : 'There are no active teachers. '}
          Lessons need an active subject and a teacher assigned that subject.
        </Alert>
      )}
      {publishProblems.length > 0 && (
        <Alert tone="error" title="The timetable was not published">
          Fix these lessons, save the draft and publish again:
          <ul className={styles.issueList}>
            {publishProblems.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Alert>
      )}
      {publishProblems.length === 0 && draft && view.issues.length > 0 && (
        <Alert tone="warning" title="Lessons that need attention before publishing">
          <ul className={styles.issueList}>
            {view.issues.map((i) => (
              <li key={i.entryId}>{i.message}</li>
            ))}
          </ul>
        </Alert>
      )}

      <Panel title={label}>
        {notice ?? (
          <div className={styles.stack}>
            {editable && (
              <p className={styles.hint}>
                Select a free period to add a lesson, or a lesson to edit, move or remove it. With a
                mouse you can also drag a lesson to another period.
              </p>
            )}
            {!draft && !published ? (
              <EmptyState icon={CalendarPlus} title="No timetable yet">
                {view.readOnlyYear
                  ? `${year.label} has no timetable.`
                  : `Create a draft to start the ${year.label} timetable.`}
              </EmptyState>
            ) : (
              <WeekGrid
                periods={view.periods}
                workingDays={view.workingDays}
                entries={view.entries}
                show="teacher"
                caption={`${draft ? 'Draft' : 'Published'} timetable of ${label}, ${year.label}`}
                issues={view.issues}
                editing={
                  editable
                    ? {
                        unsaved,
                        onAdd: (day, period) => {
                          setDialogError(null);
                          setDialog({ kind: 'add', day, periodId: period.id });
                        },
                        onOpen: (entry) => {
                          setDialogError(null);
                          setDialog({ kind: 'edit', entry });
                        },
                        onMove: (entry, day, period) => void move(entry, day, period),
                      }
                    : null
                }
              />
            )}
          </div>
        )}
      </Panel>

      <VersionHistory
        yearId={year.id}
        refreshKey={`${draft?.id}:${draft?.updatedAt}:${published?.id}`}
      />

      {dialog && (
        <LessonDialog
          target={dialog}
          sectionId={sectionId}
          options={options}
          periods={view.periods}
          workingDays={view.workingDays}
          pending={busy === 'check'}
          error={dialogError}
          onSubmit={(values) => void submitLesson(values)}
          onRemove={(entry) => {
            setDialog(null);
            setRemoving(entry);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title="Remove lesson?"
        confirmLabel="Remove"
        tone="danger"
        pending={busy === 'check'}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const entry = removing;
          if (!entry) return;
          void propose([{ op: 'remove', entryId: entry.id }], 'toast').then((ok) => {
            if (ok) setRemoving(null);
          });
        }}
      >
        {removing && (
          <p>
            Remove {removing.subjectName} from {removing.className} {removing.sectionName},{' '}
            {WEEKDAY_LABELS[removing.day].long}{' '}
            {view.periods.find((p) => p.id === removing.periodId)?.label ?? ''}? The period becomes
            free in the draft.
          </p>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'publish'}
        title={`Publish the ${year.label} timetable?`}
        confirmLabel="Publish"
        pending={busy === 'publish'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void publish()}
      >
        <p>
          The draft (version {draft?.versionNumber}) becomes the live timetable for every class,
          teacher and student.
          {published ? ` Version ${published.versionNumber} is kept in the history.` : ''}
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'discardDraft'}
        title="Discard the draft?"
        confirmLabel="Discard draft"
        tone="danger"
        pending={busy === 'discardDraft'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void discardDraft()}
      >
        <p>
          All saved changes in draft version {draft?.versionNumber} are thrown away for every class.
          The published timetable is not changed.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'discardChanges'}
        title="Discard unsaved changes?"
        confirmLabel="Discard changes"
        tone="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          resetLocal();
          setConfirm(null);
        }}
      >
        <p>
          {pending.length} unsaved change{pending.length === 1 ? '' : 's'} will be lost. The saved
          draft stays as it is.
        </p>
      </ConfirmDialog>
    </>
  );
}

const STATUS_LABEL = { DRAFT: 'Draft', PUBLISHED: 'Published', SUPERSEDED: 'Replaced' } as const;

function VersionHistory({ yearId, refreshKey }: { yearId: string; refreshKey: string }) {
  const versions = useResource(`tt-versions:${yearId}:${refreshKey}`, (signal) =>
    timetableApi.versions(yearId, signal),
  );
  if (versions.status !== 'ready' || versions.data.items.length === 0) return null;
  return (
    <Panel
      title="Version history"
      description="Published timetables are never edited; each change is a new version."
    >
      <div className={styles.historyWrap}>
        <table className={styles.history}>
          <caption className="visually-hidden">Timetable versions</caption>
          <thead>
            <tr>
              <th scope="col">Version</th>
              <th scope="col">Status</th>
              <th scope="col">Lessons</th>
              <th scope="col">Created</th>
              <th scope="col">Published</th>
            </tr>
          </thead>
          <tbody>
            {versions.data.items.map((v) => (
              <tr key={v.id}>
                <td>{v.versionNumber}</td>
                <td>{STATUS_LABEL[v.status]}</td>
                <td>{v.entryCount}</td>
                <td>
                  {formatDateTime(v.createdAt)}
                  {v.createdBy ? ` · ${v.createdBy}` : ''}
                </td>
                <td>
                  {v.publishedAt ? formatDateTime(v.publishedAt) : '—'}
                  {v.publishedBy ? ` · ${v.publishedBy}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
