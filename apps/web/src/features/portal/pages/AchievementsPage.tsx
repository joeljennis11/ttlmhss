import { useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  AchievementCreateSchema,
  AchievementUpdateSchema,
  type AchievementOptionsView,
  type AchievementView,
} from '@ttlmhss/shared';
import { Award, Plus } from 'lucide-react';
import { Panel } from '../../../components/layout/Page';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FormDialog,
  LoadingState,
  Pagination,
  SelectField,
  TextAreaField,
  TextField,
  useToast,
} from '../../../components/ui';
import { useFormSubmit } from '../../../lib/use-form-submit';
import { messageOf, useResource } from '../../../lib/use-resource';
import { studentsApi } from '../../people/api';
import { useDebounced } from '../../people/people-shared';
import { achievementsApi } from '../api';
import { AchievementCard, PortalLayout } from '../portal-shared';
import styles from '../portal.module.css';

const PAGE_SIZE = 12;

/**
 * /achievements — administrators (any student) and class teachers (their own class) record and
 * look after student achievements. Archive hides an achievement and keeps it; administrators may
 * delete an archived one permanently.
 */
export function AchievementsPage() {
  const [params, setParams] = useSearchParams();
  const year = params.get('year');
  const options = useResource(`ach-options:${year ?? ''}`, (signal) =>
    achievementsApi.options(year, signal),
  );
  const set = (key: string, value: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value) next.set(key, value);
        else next.delete(key);
        if (key !== 'page') next.delete('page');
        return next;
      },
      { replace: true },
    );
  return (
    <PortalLayout
      title="Achievements"
      description="Record what students achieve — academic, sports, cultural and more. Students see their own achievements in their portal."
    >
      {options.status === 'loading' && <LoadingState />}
      {options.status === 'error' && (
        <ErrorState message={options.error} onRetry={options.reload} />
      )}
      {options.status === 'ready' && <Manager options={options.data} params={params} set={set} />}
    </PortalLayout>
  );
}

function Manager({
  options,
  params,
  set,
}: {
  options: AchievementOptionsView;
  params: URLSearchParams;
  set: (key: string, value: string) => void;
}) {
  const toast = useToast();
  const [q, setQ] = useState(params.get('q') ?? '');
  const debounced = useDebounced(q);
  const query = {
    academicYearId: options.academicYearId ?? undefined,
    sectionId: params.get('section') ?? undefined,
    categoryId: params.get('category') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    status: (params.get('status') ?? 'ACTIVE') as 'ACTIVE' | 'ARCHIVED' | 'ALL',
    q: debounced || undefined,
    page: Number(params.get('page') ?? 1),
    pageSize: PAGE_SIZE,
  };
  const list = useResource(`ach-list:${JSON.stringify(query)}`, (signal) =>
    achievementsApi.list(query, signal),
  );
  const [editing, setEditing] = useState<{ item: AchievementView | null } | null>(null);
  const [pending, setPending] = useState<{
    item: AchievementView;
    action: 'archive' | 'delete';
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const year = options.years.find((y) => y.id === options.academicYearId) ?? null;

  async function act(item: AchievementView, action: 'archive' | 'restore' | 'delete') {
    setBusy(true);
    try {
      if (action === 'archive') await achievementsApi.archive(item.id);
      if (action === 'restore') await achievementsApi.restore(item.id);
      if (action === 'delete') await achievementsApi.remove(item.id);
      toast.show(
        action === 'archive'
          ? `“${item.title}” archived`
          : action === 'restore'
            ? `“${item.title}” restored`
            : `“${item.title}” deleted`,
      );
      list.reload();
    } catch (e) {
      toast.show(messageOf(e), 'error');
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <>
      <div className={styles.toolbar}>
        <SelectField
          label="Academic year"
          value={options.academicYearId ?? ''}
          onChange={(e) => set('year', e.target.value)}
          options={options.years.map((y) => ({
            value: y.id,
            label: y.status === 'CURRENT' ? `${y.label} (current)` : y.label,
          }))}
        />
        <SelectField
          label="Class"
          value={params.get('section') ?? ''}
          placeholder={options.sections.length > 1 ? 'All my classes' : undefined}
          onChange={(e) => set('section', e.target.value)}
          options={options.sections.map((s) => ({
            value: s.sectionId,
            label: `${s.className} ${s.sectionName}`,
          }))}
        />
        <SelectField
          label="Category"
          value={params.get('category') ?? ''}
          placeholder="All categories"
          onChange={(e) => set('category', e.target.value)}
          options={options.categories.map((c) => ({
            value: c.id,
            label: c.active ? c.name : `${c.name} (inactive)`,
          }))}
        />
        <TextField
          label="From"
          type="date"
          value={params.get('from') ?? ''}
          onChange={(e) => set('from', e.target.value)}
        />
        <TextField
          label="To"
          type="date"
          value={params.get('to') ?? ''}
          onChange={(e) => set('to', e.target.value)}
        />
        <SelectField
          label="Show"
          value={query.status}
          onChange={(e) => set('status', e.target.value)}
          options={[
            { value: 'ACTIVE', label: 'Active' },
            { value: 'ARCHIVED', label: 'Archived' },
            { value: 'ALL', label: 'All' },
          ]}
        />
        <TextField
          label="Search"
          placeholder="Student, admission no. or title"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div>
        <Button
          icon={<Plus size={18} aria-hidden="true" />}
          onClick={() => setEditing({ item: null })}
          disabled={!year || options.sections.length === 0}
        >
          Add achievement
        </Button>
      </div>

      {list.status === 'loading' && <LoadingState />}
      {list.status === 'error' && <ErrorState message={list.error} onRetry={list.reload} />}
      {list.status === 'ready' &&
        (list.data.items.length === 0 ? (
          <Panel>
            <EmptyState icon={Award} title="No achievements found">
              Add an achievement, or change the filters.
            </EmptyState>
          </Panel>
        ) : (
          <>
            <ul className={styles.cards} aria-label="Achievements">
              {list.data.items.map((a) => (
                <li key={a.id}>
                  <AchievementCard
                    a={a}
                    actions={
                      <>
                        <span className={styles.meta}>
                          {a.student.fullName} · {a.section.className} {a.section.sectionName}
                          {a.createdBy ? ` · added by ${a.createdBy}` : ''}
                        </span>
                        {a.canManage && (
                          <div className={styles.actions}>
                            {a.status === 'ACTIVE' ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => setEditing({ item: a })}
                                  aria-label={`Edit ${a.title}`}
                                >
                                  Edit
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setPending({ item: a, action: 'archive' })}
                                  aria-label={`Archive ${a.title}`}
                                >
                                  Archive
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={busy}
                                  onClick={() => void act(a, 'restore')}
                                  aria-label={`Restore ${a.title}`}
                                >
                                  Restore
                                </Button>
                                {options.canDelete && (
                                  <Button
                                    size="sm"
                                    variant="danger"
                                    onClick={() => setPending({ item: a, action: 'delete' })}
                                    aria-label={`Delete ${a.title}`}
                                  >
                                    Delete
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </>
                    }
                  />
                </li>
              ))}
            </ul>
            <Pagination
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              label="achievements"
              onPage={(p) => set('page', String(p))}
            />
          </>
        ))}

      {editing && year && (
        <AchievementDialog
          item={editing.item}
          options={options}
          year={year}
          onClose={() => setEditing(null)}
          onSaved={(a) => {
            setEditing(null);
            toast.show(
              editing.item ? `“${a.title}” saved` : `Achievement added for ${a.student.fullName}`,
            );
            list.reload();
          }}
        />
      )}
      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.action === 'delete'
            ? 'Delete this achievement permanently?'
            : 'Archive this achievement?'
        }
        confirmLabel={pending?.action === 'delete' ? 'Delete permanently' : 'Archive'}
        tone="danger"
        pending={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && void act(pending.item, pending.action)}
      >
        <p>
          {pending?.action === 'delete'
            ? `“${pending.item.title}” will be removed for good. The deletion is recorded in the audit log.`
            : `“${pending?.item.title}” will be hidden from ${pending?.item.student.fullName}'s portal. You can restore it later.`}
        </p>
      </ConfirmDialog>
    </>
  );
}

function AchievementDialog({
  item,
  options,
  year,
  onClose,
  onSaved,
}: {
  item: AchievementView | null;
  options: AchievementOptionsView;
  year: AchievementOptionsView['years'][number];
  onClose: () => void;
  onSaved: (a: AchievementView) => void;
}) {
  const [values, setValues] = useState({
    studentId: item?.student.id ?? '',
    categoryId: item?.category.id ?? '',
    title: item?.title ?? '',
    description: item?.description ?? '',
    achievedOn: item?.achievedOn ?? '',
  });
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const students = useResource(item ? null : `ach-students:${year.id}:${debounced}`, (signal) =>
    studentsApi.list(
      {
        academicYearId: year.id,
        q: debounced || undefined,
        status: 'ACTIVE',
        sort: 'class',
        pageSize: 50,
      },
      signal,
    ),
  );
  const form = useFormSubmit(['studentId', 'categoryId', 'title', 'description', 'achievedOn']);
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit() {
    if (item) {
      const body = form.check(AchievementUpdateSchema, {
        categoryId: values.categoryId,
        title: values.title,
        description: values.description,
        achievedOn: values.achievedOn,
      });
      if (!body) return;
      const r = await form.run(() => achievementsApi.update(item.id, body));
      if (r.ok) onSaved(r.value);
    } else {
      const body = form.check(AchievementCreateSchema, { ...values, academicYearId: year.id });
      if (!body) return;
      const r = await form.run(() => achievementsApi.create(body));
      if (r.ok) onSaved(r.value);
    }
  }

  const studentOptions =
    students.status === 'ready'
      ? students.data.items
          .filter((s) => s.placement)
          .map((s) => ({
            value: s.id,
            label: `${s.fullName} (${s.admissionNumber}) — ${s.placement!.className} ${s.placement!.sectionName}`,
          }))
      : [];

  return (
    <FormDialog
      open
      wide
      title={item ? `Edit — ${item.title}` : `Add an achievement (${year.label})`}
      submitLabel={item ? 'Save changes' : 'Add achievement'}
      pending={form.pending}
      error={form.formError}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      {item ? (
        <p className={styles.hint}>
          {item.student.fullName} · {item.section.className} {item.section.sectionName}
        </p>
      ) : (
        <>
          <TextField
            label="Find a student"
            placeholder="Name or admission number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <SelectField
            label="Student"
            placeholder={students.status === 'loading' ? 'Loading…' : 'Choose a student'}
            options={studentOptions}
            value={values.studentId}
            onChange={set('studentId')}
            error={form.errors.studentId}
          />
        </>
      )}
      <SelectField
        label="Category"
        placeholder="Choose a category"
        options={options.categories
          .filter((c) => c.active || c.id === item?.category.id)
          .map((c) => ({ value: c.id, label: c.name }))}
        value={values.categoryId}
        onChange={set('categoryId')}
        error={form.errors.categoryId}
      />
      <TextField
        label="Title"
        maxLength={120}
        value={values.title}
        onChange={set('title')}
        error={form.errors.title}
      />
      <TextAreaField
        label="Description"
        hint="Optional."
        maxLength={1000}
        value={values.description}
        onChange={set('description')}
        error={form.errors.description}
      />
      <TextField
        label="Date"
        type="date"
        min={year.startDate}
        max={year.endDate}
        value={values.achievedOn}
        onChange={set('achievedOn')}
        error={form.errors.achievedOn}
      />
      <p className={styles.hint}>
        Certificates and photos cannot be attached yet; keep the original at the school office.
      </p>
    </FormDialog>
  );
}
