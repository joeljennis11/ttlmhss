import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { GraduationCap, Plus } from 'lucide-react';
import { usePageTitle } from '../../../app/page-meta';
import { PageHeader, Panel } from '../../../components/layout/Page';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Pagination,
  SelectField,
  StatusBadge,
  TextField,
} from '../../../components/ui';
import { useAuth } from '../../auth/auth-context';
import { useResource } from '../../../lib/use-resource';
import { subjects as subjectsApi } from '../../admin/api';
import { teachersApi } from '../api';
import { useDebounced } from '../people-shared';
import admin from '../../admin/admin.module.css';
import styles from '../people.module.css';

const PAGE_SIZE = 25;

export function TeachersPage() {
  usePageTitle('Teachers');
  const { user } = useAuth();
  const can = (p: string) => user?.permissions.includes(p as never) ?? false;
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search.trim());
  const subjectId = params.get('subject') ?? '';
  const designation = params.get('designation') ?? '';
  const status = (
    ['ACTIVE', 'INACTIVE', 'ALL'].includes(params.get('status') ?? '')
      ? params.get('status')
      : 'ACTIVE'
  ) as 'ACTIVE' | 'INACTIVE' | 'ALL';
  const page = Math.max(1, Number(params.get('page')) || 1);

  const subjects = useResource('subjects', (signal) => subjectsApi.list(signal));
  const designations = useResource('designations', (signal) => teachersApi.designations(signal));
  const list = useResource(JSON.stringify({ q, subjectId, designation, status, page }), (signal) =>
    teachersApi.list(
      {
        q: q || undefined,
        subjectId: subjectId || undefined,
        designation: designation || undefined,
        status,
        page,
        pageSize: PAGE_SIZE,
      },
      signal,
    ),
  );

  const set = (changes: Record<string, string | null>) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        for (const [k, v] of Object.entries(changes)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        if (!('page' in changes)) next.delete('page');
        return next;
      },
      { replace: true },
    );

  return (
    <>
      <PageHeader
        title="Teachers"
        description="Add teachers, the subjects they teach and their class-teacher roles. Which classes they teach comes from the timetable (a later phase)."
        actions={
          <>
            {can('class_teacher_assignments.manage') && (
              <Link to="/class-teachers" className={admin.textAction}>
                Class teachers
              </Link>
            )}
            {can('teachers.create') && (
              <Link to="/teachers/new" className={styles.primaryLink}>
                <Plus size={18} aria-hidden="true" /> Add teacher
              </Link>
            )}
          </>
        }
      />
      <Panel>
        <div className={admin.toolbar} role="search">
          <TextField
            label="Search"
            type="search"
            placeholder="Name or staff ID"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              set({ q: e.target.value.trim() || null });
            }}
          />
          <SelectField
            label="Subject"
            placeholder="All subjects"
            value={subjectId}
            onChange={(e) => set({ subject: e.target.value || null })}
            options={
              subjects.status === 'ready'
                ? subjects.data.map((s) => ({ value: s.id, label: s.name }))
                : []
            }
          />
          <SelectField
            label="Designation"
            placeholder="All designations"
            value={designation}
            onChange={(e) => set({ designation: e.target.value || null })}
            options={
              designations.status === 'ready'
                ? designations.data.map((d) => ({ value: d, label: d }))
                : []
            }
          />
          <SelectField
            label="Status"
            value={status}
            onChange={(e) => set({ status: e.target.value })}
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
              { value: 'ALL', label: 'All teachers' },
            ]}
          />
        </div>
      </Panel>
      <Panel>
        {list.status === 'loading' && <LoadingState label="Loading teachers…" />}
        {list.status === 'error' && <ErrorState message={list.error} onRetry={list.reload} />}
        {list.status === 'ready' &&
          (list.data.items.length === 0 ? (
            <EmptyState
              icon={GraduationCap}
              title={q || subjectId || designation ? 'No teachers match' : 'No teachers yet'}
            >
              {q || subjectId || designation
                ? 'Try a different search or filter.'
                : 'Teachers you add will appear here.'}
            </EmptyState>
          ) : (
            <>
              <div className={admin.tableWrap}>
                <table className={`${admin.table} ${admin.stacked}`}>
                  <caption className="visually-hidden">Teachers</caption>
                  <thead>
                    <tr>
                      <th scope="col">Teacher</th>
                      <th scope="col">Staff ID</th>
                      <th scope="col">Subjects</th>
                      <th scope="col">Class teacher</th>
                      <th scope="col">Status</th>
                      <th scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.items.map((t) => (
                      <tr key={t.id} data-muted={t.status !== 'ACTIVE' || undefined}>
                        <td className={styles.nameCell}>
                          <Link to={`/teachers/${t.id}`}>{t.fullName}</Link>
                          {t.designation && <span className={styles.sub}>{t.designation}</span>}
                        </td>
                        <td data-label="Staff ID">{t.staffCode}</td>
                        <td data-label="Subjects">
                          {t.subjects.length ? (
                            <>
                              {t.subjects
                                .slice(0, 3)
                                .map((s) => s.name)
                                .join(', ')}
                              {t.subjects.length > 3 && (
                                <span className={styles.sub}>+{t.subjects.length - 3} more</span>
                              )}
                            </>
                          ) : (
                            <span className={admin.muted}>None yet</span>
                          )}
                        </td>
                        <td data-label="Class teacher">
                          {t.classTeacherOf.length ? (
                            t.classTeacherOf
                              .map((a) => `${a.className} ${a.sectionName}`)
                              .join(', ')
                          ) : (
                            <span className={admin.muted}>—</span>
                          )}
                        </td>
                        <td data-label="Status">
                          <StatusBadge status={t.status} />
                        </td>
                        <td data-actions="">
                          <div className={admin.rowActions}>
                            <Link to={`/teachers/${t.id}`} className={admin.textAction}>
                              View<span className="visually-hidden"> {t.fullName}</span>
                            </Link>
                            {can('teachers.edit') && (
                              <Link to={`/teachers/${t.id}/edit`} className={admin.textAction}>
                                Edit<span className="visually-hidden"> {t.fullName}</span>
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={list.data.page}
                pageSize={list.data.pageSize}
                total={list.data.total}
                label="teachers"
                onPage={(p) => set({ page: String(p) })}
              />
            </>
          ))}
      </Panel>
    </>
  );
}
