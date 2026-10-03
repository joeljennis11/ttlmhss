import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { StudentListStatusSchema, type StudentList } from '@ttlmhss/shared';
import { ArrowUpRight, Plus, Users } from 'lucide-react';
import { usePageTitle } from '../../../app/page-meta';
import { PageHeader, Panel } from '../../../components/layout/Page';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Pagination,
  SelectField,
  TextField,
} from '../../../components/ui';
import { useAuth } from '../../auth/auth-context';
import { useResource } from '../../../lib/use-resource';
import { studentsApi } from '../api';
import {
  StudentStatusBadge,
  currentYear,
  placementLabel,
  sectionOptions,
  useDebounced,
  useSchoolStructure,
  yearOptions,
} from '../people-shared';
import admin from '../../admin/admin.module.css';
import styles from '../people.module.css';

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'UNPLACED', label: 'Active, not in a class this year' },
  { value: 'INACTIVE', label: 'Deactivated' },
  { value: 'LEFT_SCHOOL', label: 'Left / transferred out' },
  { value: 'ALL', label: 'All students' },
];
const SORT_OPTIONS = [
  { value: 'class', label: 'Class and roll number' },
  { value: 'name', label: 'Name' },
  { value: 'admission', label: 'Admission number' },
];
const PAGE_SIZE = 25;

/**
 * Student management list. Search, filters, sorting and paging run on the server; the current
 * filter lives in the address so it survives reloads and the back button.
 */
export function StudentsPage() {
  usePageTitle('Students');
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const structure = useSchoolStructure();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search.trim());

  const years = structure.years.status === 'ready' ? structure.years.data : [];
  const classes = structure.classes.status === 'ready' ? structure.classes.data : [];
  const yearId = params.get('year') ?? currentYear(years)?.id ?? '';
  const classId = params.get('class') ?? '';
  const sectionId = params.get('section') ?? '';
  const statusParam = StudentListStatusSchema.safeParse(params.get('status'));
  const status = statusParam.success ? statusParam.data : 'ACTIVE';
  const sort = (
    ['class', 'name', 'admission'].includes(params.get('sort') ?? '') ? params.get('sort') : 'class'
  ) as 'class' | 'name' | 'admission';
  const page = Math.max(1, Number(params.get('page')) || 1);

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

  const ready = structure.years.status === 'ready' && structure.classes.status === 'ready';
  const key = ready ? JSON.stringify({ q, yearId, classId, sectionId, status, sort, page }) : null;
  const list = useResource<StudentList>(key, (signal) =>
    studentsApi.list(
      {
        q: q || undefined,
        academicYearId: yearId || undefined,
        classId: classId || undefined,
        sectionId: sectionId || undefined,
        status,
        sort,
        page,
        pageSize: PAGE_SIZE,
      },
      signal,
    ),
  );

  const can = (p: string) => user?.permissions.includes(p as never) ?? false;
  const sections = sectionOptions(classes, { includeInactive: true }).filter(
    (s) => !classId || s.classId === classId,
  );

  return (
    <>
      <PageHeader
        title="Students"
        description="Admit students, keep their details up to date and manage their class placements. History is never overwritten."
        actions={
          <>
            {can('students.promote') && (
              <Link to="/students/promotion" className={admin.textAction}>
                <ArrowUpRight size={16} aria-hidden="true" /> Promote students
              </Link>
            )}
            {can('students.create') && (
              <Link to="/students/new" className={`${styles.primaryLink}`}>
                <Plus size={18} aria-hidden="true" /> Admit student
              </Link>
            )}
          </>
        }
      />

      {structure.years.status === 'error' && (
        <ErrorState message={structure.years.error} onRetry={structure.years.reload} />
      )}

      <Panel>
        <div className={admin.toolbar} role="search">
          <TextField
            label="Search"
            type="search"
            placeholder="Name or admission no."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              set({ q: e.target.value.trim() || null });
            }}
          />
          <SelectField
            label="Academic year"
            value={yearId}
            onChange={(e) => set({ year: e.target.value })}
            options={yearOptions(years)}
            disabled={!ready}
          />
          <SelectField
            label="Class"
            value={classId}
            placeholder="All classes"
            onChange={(e) => set({ class: e.target.value || null, section: null })}
            options={classes.map((c) => ({ value: c.id, label: c.name }))}
            disabled={!ready}
          />
          <SelectField
            label="Section"
            value={sectionId}
            placeholder="All sections"
            onChange={(e) => set({ section: e.target.value || null })}
            options={sections.map(({ value, label }) => ({ value, label }))}
            disabled={!ready}
          />
          <SelectField
            label="Status"
            value={status}
            onChange={(e) => set({ status: e.target.value })}
            options={STATUS_OPTIONS}
          />
          <SelectField
            label="Sort by"
            value={sort}
            onChange={(e) => set({ sort: e.target.value })}
            options={SORT_OPTIONS}
          />
        </div>
      </Panel>

      <Panel>
        {list.status === 'loading' && <LoadingState label="Loading students…" />}
        {list.status === 'error' && <ErrorState message={list.error} onRetry={list.reload} />}
        {list.status === 'ready' &&
          (list.data.items.length === 0 ? (
            <EmptyState
              icon={Users}
              title={q || classId || sectionId ? 'No students match' : 'No students yet'}
            >
              {q || classId || sectionId
                ? 'Try a different search or filter.'
                : 'Admitted students will appear here.'}
            </EmptyState>
          ) : (
            <>
              <div className={admin.tableWrap}>
                <table className={`${admin.table} ${admin.stacked}`}>
                  <caption className="visually-hidden">Students</caption>
                  <thead>
                    <tr>
                      <th scope="col">Student</th>
                      <th scope="col">Admission no.</th>
                      <th scope="col">Class</th>
                      <th scope="col">Roll no.</th>
                      <th scope="col">Status</th>
                      <th scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.items.map((s) => (
                      <tr key={s.id} data-muted={s.status !== 'ACTIVE' || undefined}>
                        <td className={styles.nameCell}>
                          <Link to={`/students/${s.id}`}>{s.fullName}</Link>
                        </td>
                        <td data-label="Admission no.">{s.admissionNumber}</td>
                        <td data-label="Class">
                          {s.placement ? (
                            <>
                              {placementLabel(s.placement)}
                              {s.placement.status !== 'ACTIVE' && (
                                <span className={styles.sub}>until {s.placement.endedOn}</span>
                              )}
                            </>
                          ) : (
                            <span className={admin.muted}>Not in a class</span>
                          )}
                        </td>
                        <td data-label="Roll no.">{s.placement?.rollNumber ?? '—'}</td>
                        <td data-label="Status">
                          <StudentStatusBadge student={s} />
                        </td>
                        <td data-actions="">
                          <div className={admin.rowActions}>
                            <Link to={`/students/${s.id}`} className={admin.textAction}>
                              View<span className="visually-hidden"> {s.fullName}</span>
                            </Link>
                            {can('students.edit') && (
                              <Link to={`/students/${s.id}/edit`} className={admin.textAction}>
                                Edit<span className="visually-hidden"> {s.fullName}</span>
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
                label="students"
                onPage={(p) => set({ page: String(p) })}
              />
            </>
          ))}
      </Panel>
    </>
  );
}
