import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  ANNOUNCEMENT_AUDIENCE_LABELS,
  AnnouncementInputSchema,
  type AnnouncementAudience,
  type AnnouncementOptionsView,
  type AnnouncementView,
} from '@ttlmhss/shared';
import { ArrowLeft, Megaphone, Plus } from 'lucide-react';
import { usePageTitle } from '../../../app/page-meta';
import { PageHeader, Panel } from '../../../components/layout/Page';
import {
  Button,
  CheckboxField,
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
import { formatDate, formatDateTime } from '../../../lib/format';
import { useFormSubmit } from '../../../lib/use-form-submit';
import { messageOf, useResource } from '../../../lib/use-resource';
import { useAuth } from '../../auth/auth-context';
import { useDebounced } from '../../people/people-shared';
import { todayIso } from '../../attendance/attendance-shared';
import { announcementsApi } from '../api';
import { AnnouncementBadges, AnnouncementCard } from '../shared';
import styles from '../communication.module.css';

const PAGE_SIZE = 12;

/** Can this user open the management page (administrators; class teachers with the permission)? */
function useCanManage() {
  const { user } = useAuth();
  return (
    !!user &&
    user.permissions.includes('announcements.manage') &&
    (user.roles.includes('ADMIN') || user.roles.includes('CLASS_TEACHER'))
  );
}

// ---------------------------------------------------------------------------
// Everyone: the announcements meant for me
// ---------------------------------------------------------------------------

/** /announcements — active announcements for the signed-in user's own audience. */
export function AnnouncementsPage() {
  usePageTitle('Announcements');
  const manage = useCanManage();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const feed = useResource(`ann-feed:${page}`, (signal) =>
    announcementsApi.feed(page, PAGE_SIZE, signal),
  );
  return (
    <>
      <PageHeader
        title="Announcements"
        description="Notices from the school for you. Expired and archived notices are not shown."
        actions={
          manage && (
            <Link to="/announcements/manage" className={styles.linkButton}>
              Manage announcements
            </Link>
          )
        }
      />
      {feed.status === 'loading' && <LoadingState />}
      {feed.status === 'error' && <ErrorState message={feed.error} onRetry={feed.reload} />}
      {feed.status === 'ready' &&
        (feed.data.items.length === 0 ? (
          <Panel>
            <EmptyState icon={Megaphone} title="No announcements right now." />
          </Panel>
        ) : (
          <div className={styles.stack}>
            <ul className={styles.cards} aria-label="Announcements">
              {feed.data.items.map((a) => (
                <li key={a.id}>
                  <AnnouncementCard a={a} />
                </li>
              ))}
            </ul>
            <Pagination
              page={feed.data.page}
              pageSize={feed.data.pageSize}
              total={feed.data.total}
              label="announcements"
              onPage={(p) => setParams({ page: String(p) })}
            />
          </div>
        ))}
    </>
  );
}

/** /announcements/:id — the full announcement (the server checks the audience). */
export function AnnouncementDetailPage() {
  const { id = '' } = useParams();
  const item = useResource(`ann:${id}`, (signal) => announcementsApi.get(id, signal));
  usePageTitle(item.status === 'ready' ? item.data.title : 'Announcement');
  const back = (
    <Link to="/announcements" className={styles.link}>
      <ArrowLeft size={14} aria-hidden="true" /> Announcements
    </Link>
  );
  if (item.status === 'loading') return <LoadingState />;
  if (item.status === 'error') {
    return (
      <>
        <PageHeader title="Announcement" eyebrow={back} />
        <ErrorState message={item.error} onRetry={item.reload} />
      </>
    );
  }
  const a = item.data;
  return (
    <>
      <PageHeader
        title={a.title}
        eyebrow={back}
        description={
          <>
            {a.publishedAt ? formatDateTime(a.publishedAt) : 'Not published'} · {a.audienceLabel}
            {a.author ? ` · ${a.author}` : ''}
            {a.expiresOn ? ` · until ${formatDate(a.expiresOn)}` : ''}
          </>
        }
      />
      <Panel>
        <div className={styles.stack}>
          {a.canManage && (
            <div className={styles.badges}>
              <AnnouncementBadges a={a} />
            </div>
          )}
          <p className={styles.body}>{a.body}</p>
        </div>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
// Administrators and class teachers: writing and looking after announcements
// ---------------------------------------------------------------------------

/** /announcements/manage — list with filters; create, edit, publish, archive, restore. */
export function AnnouncementManagePage() {
  usePageTitle('Manage announcements');
  const options = useResource('ann-options', (signal) => announcementsApi.options(signal));
  return (
    <>
      <PageHeader
        title="Manage announcements"
        eyebrow={
          <Link to="/announcements" className={styles.link}>
            <ArrowLeft size={14} aria-hidden="true" /> Announcements
          </Link>
        }
        description="Write notices for the whole school, staff, a class or a section. Archived notices are kept as history."
      />
      {options.status === 'loading' && <LoadingState />}
      {options.status === 'error' && (
        <ErrorState message={options.error} onRetry={options.reload} />
      )}
      {options.status === 'ready' && <Manager options={options.data} />}
    </>
  );
}

function Manager({ options }: { options: AnnouncementOptionsView }) {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
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
  const [q, setQ] = useState(params.get('q') ?? '');
  const debounced = useDebounced(q);
  const query = {
    academicYearId: params.get('year') ?? options.academicYear?.id ?? undefined,
    status: (params.get('status') ?? 'ALL') as 'ALL' | 'DRAFT' | 'PUBLISHED' | 'ARCHIVED',
    audience: (params.get('audience') || undefined) as AnnouncementAudience | undefined,
    q: debounced || undefined,
    page: Number(params.get('page') ?? 1),
    pageSize: PAGE_SIZE,
  };
  const list = useResource(`ann-list:${JSON.stringify(query)}`, (signal) =>
    announcementsApi.list(query, signal),
  );
  const [editing, setEditing] = useState<{ item: AnnouncementView | null } | null>(null);
  const [archiving, setArchiving] = useState<AnnouncementView | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(a: AnnouncementView, action: 'publish' | 'archive' | 'restore') {
    setBusy(true);
    try {
      await announcementsApi[action](a.id);
      toast.show(
        action === 'publish'
          ? `“${a.title}” published`
          : action === 'archive'
            ? `“${a.title}” archived`
            : `“${a.title}” restored`,
      );
      list.reload();
    } catch (e) {
      toast.show(messageOf(e), 'error');
    } finally {
      setBusy(false);
      setArchiving(null);
    }
  }

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <SelectField
          label="Academic year"
          value={query.academicYearId ?? ''}
          onChange={(e) => set('year', e.target.value)}
          options={options.years.map((y) => ({
            value: y.id,
            label: y.status === 'CURRENT' ? `${y.label} (current)` : y.label,
          }))}
        />
        <SelectField
          label="Status"
          value={query.status}
          onChange={(e) => set('status', e.target.value)}
          options={[
            { value: 'ALL', label: 'All' },
            { value: 'DRAFT', label: 'Drafts' },
            { value: 'PUBLISHED', label: 'Published' },
            { value: 'ARCHIVED', label: 'Archived' },
          ]}
        />
        <SelectField
          label="Audience"
          value={query.audience ?? ''}
          placeholder="All audiences"
          onChange={(e) => set('audience', e.target.value)}
          options={options.audiences.map((a) => ({
            value: a,
            label: ANNOUNCEMENT_AUDIENCE_LABELS[a],
          }))}
        />
        <TextField
          label="Search"
          placeholder="Title"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            set('page', '');
          }}
        />
      </div>
      <div>
        <Button
          icon={<Plus size={18} aria-hidden="true" />}
          disabled={!options.academicYear || options.audiences.length === 0}
          onClick={() => setEditing({ item: null })}
        >
          New announcement
        </Button>
      </div>

      {list.status === 'loading' && <LoadingState />}
      {list.status === 'error' && <ErrorState message={list.error} onRetry={list.reload} />}
      {list.status === 'ready' &&
        (list.data.items.length === 0 ? (
          <Panel>
            <EmptyState icon={Megaphone} title="No announcements found">
              Write a new announcement, or change the filters.
            </EmptyState>
          </Panel>
        ) : (
          <>
            <ul className={styles.cards} aria-label="Announcements">
              {list.data.items.map((a) => (
                <li key={a.id}>
                  <AnnouncementCard
                    a={a}
                    showStatus
                    actions={
                      a.canManage && (
                        <div className={styles.actions}>
                          {a.status !== 'ARCHIVED' && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setEditing({ item: a })}
                              aria-label={`Edit ${a.title}`}
                            >
                              Edit
                            </Button>
                          )}
                          {a.status === 'DRAFT' && (
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() => void act(a, 'publish')}
                              aria-label={`Publish ${a.title}`}
                            >
                              Publish
                            </Button>
                          )}
                          {a.status === 'ARCHIVED' ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              onClick={() => void act(a, 'restore')}
                              aria-label={`Restore ${a.title}`}
                            >
                              Restore
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setArchiving(a)}
                              aria-label={`Archive ${a.title}`}
                            >
                              Archive
                            </Button>
                          )}
                        </div>
                      )
                    }
                  />
                </li>
              ))}
            </ul>
            <Pagination
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              label="announcements"
              onPage={(p) => set('page', String(p))}
            />
          </>
        ))}

      {editing && (
        <AnnouncementDialog
          item={editing.item}
          options={options}
          onClose={() => setEditing(null)}
          onSaved={(a) => {
            setEditing(null);
            toast.show(
              editing.item
                ? `“${a.title}” saved`
                : a.status === 'PUBLISHED'
                  ? `“${a.title}” published`
                  : `“${a.title}” saved as a draft`,
            );
            list.reload();
          }}
        />
      )}
      <ConfirmDialog
        open={archiving !== null}
        title="Archive this announcement?"
        confirmLabel="Archive"
        tone="danger"
        pending={busy}
        onCancel={() => setArchiving(null)}
        onConfirm={() => archiving && void act(archiving, 'archive')}
      >
        <p>
          “{archiving?.title}” will no longer be shown to its audience. It is kept as history and
          can be restored.
        </p>
      </ConfirmDialog>
    </div>
  );
}

function AnnouncementDialog({
  item,
  options,
  onClose,
  onSaved,
}: {
  item: AnnouncementView | null;
  options: AnnouncementOptionsView;
  onClose: () => void;
  onSaved: (a: AnnouncementView) => void;
}) {
  const [values, setValues] = useState({
    title: item?.title ?? '',
    body: item?.body ?? '',
    audience: (item?.audience ?? options.audiences[0] ?? 'SECTION') as AnnouncementAudience,
    classId: item?.classId ?? '',
    sectionId:
      item?.sectionId ?? (options.sections.length === 1 ? options.sections[0]!.sectionId : ''),
    expiresOn: item?.expiresOn ?? '',
  });
  const [publish, setPublish] = useState(true);
  const fields = ['title', 'body', 'audience', 'classId', 'sectionId', 'expiresOn'];
  const form = useFormSubmit((path) => fields.includes(path.replace(/^announcement\./, '')));
  const err = (f: string) => form.errors[f] ?? form.errors[`announcement.${f}`];
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit() {
    const input = form.check(AnnouncementInputSchema, {
      ...values,
      classId: values.audience === 'CLASS' ? values.classId : null,
      sectionId: values.audience === 'SECTION' ? values.sectionId : null,
    });
    if (!input) return;
    const r = await form.run(() =>
      item
        ? announcementsApi.update(item.id, input)
        : announcementsApi.create({ announcement: input, publish }),
    );
    if (r.ok) onSaved(r.value);
  }

  return (
    <FormDialog
      open
      wide
      title={item ? `Edit — ${item.title}` : 'New announcement'}
      description={options.academicYear ? `Academic year ${options.academicYear.label}` : undefined}
      submitLabel={item ? 'Save changes' : publish ? 'Publish' : 'Save draft'}
      pending={form.pending}
      error={form.formError}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <TextField
        label="Title"
        maxLength={120}
        value={values.title}
        onChange={set('title')}
        error={err('title')}
      />
      <TextAreaField
        label="Message"
        maxLength={4000}
        rows={6}
        value={values.body}
        onChange={set('body')}
        error={err('body')}
      />
      <SelectField
        label="Audience"
        value={values.audience}
        onChange={set('audience')}
        options={options.audiences.map((a) => ({
          value: a,
          label: ANNOUNCEMENT_AUDIENCE_LABELS[a],
        }))}
        error={err('audience')}
        hint={
          options.audiences.length === 1
            ? 'Class teachers post to their own class section.'
            : 'Teachers and staff: teachers and administrators only. A class or section: its students, its class teacher and administrators.'
        }
      />
      {values.audience === 'CLASS' && (
        <SelectField
          label="Class"
          placeholder="Choose a class"
          value={values.classId}
          onChange={set('classId')}
          options={options.classes.map((c) => ({ value: c.id, label: c.name }))}
          error={err('classId')}
        />
      )}
      {values.audience === 'SECTION' && (
        <SelectField
          label="Class section"
          placeholder="Choose a class section"
          value={values.sectionId}
          onChange={set('sectionId')}
          options={options.sections.map((s) => ({
            value: s.sectionId,
            label: `${s.className} ${s.sectionName}`,
          }))}
          error={err('sectionId')}
        />
      )}
      <TextField
        label="Show until (optional)"
        type="date"
        min={todayIso()}
        hint="The last day it is shown. Leave empty to show it until it is archived."
        value={values.expiresOn}
        onChange={set('expiresOn')}
        error={err('expiresOn')}
      />
      {!item && (
        <CheckboxField
          label="Publish now"
          hint="Untick to save a draft that only managers can see."
          checked={publish}
          onChange={(e) => setPublish(e.target.checked)}
        />
      )}
    </FormDialog>
  );
}
