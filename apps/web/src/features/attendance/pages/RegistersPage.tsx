import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ClipboardList } from 'lucide-react';
import { Panel } from '../../../components/layout/Page';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Pagination,
  SelectField,
  TextField,
} from '../../../components/ui';
import { formatDateTime } from '../../../lib/format';
import { useResource } from '../../../lib/use-resource';
import { subjects as subjectsApi } from '../../admin/api';
import { teachersApi } from '../../people/api';
import {
  TimetableYearGate,
  YearSelect,
  useTimetableYear,
  type TimetableYear,
} from '../../timetable/TimetableLayout';
import { attendanceApi, registerHref } from '../api';
import { AttendanceLayout, CountsLine, formatShortDate, formatTime } from '../attendance-shared';
import admin from '../../admin/admin.module.css';
import styles from '../attendance.module.css';

/** Administrator: search every saved register with filters (paginated). */
export function RegistersPage() {
  const selection = useTimetableYear();
  return (
    <AttendanceLayout
      title="All registers"
      description="Every saved attendance register. Filter by date, class, subject or teacher and open a register to view or correct it."
    >
      <TimetableYearGate selection={selection}>
        {(year, years) => (
          <Search
            key={year.id}
            year={year}
            yearSelect={<YearSelect years={years} year={year} onChange={selection.select} />}
          />
        )}
      </TimetableYearGate>
    </AttendanceLayout>
  );
}

function Search({ year, yearSelect }: { year: TimetableYear; yearSelect: ReactNode }) {
  const [f, setF] = useState({ from: '', to: '', sectionId: '', subjectId: '', teacherId: '' });
  const [page, setPage] = useState(1);
  const set = (patch: Partial<typeof f>) => {
    setF((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };
  const classes = useResource(`att-classes:${year.id}`, (signal) =>
    attendanceApi.classes(year.id, signal),
  );
  const subjectList = useResource('att-subjects', (signal) => subjectsApi.list(signal));
  const teacherList = useResource('att-teachers', (signal) =>
    teachersApi.list({ status: 'ALL', pageSize: 100 }, signal),
  );
  const key = JSON.stringify({ y: year.id, ...f, page });
  const list = useResource(`att-sessions:${key}`, (signal) =>
    attendanceApi.sessions(
      {
        academicYearId: year.id,
        page,
        pageSize: 25,
        ...(f.from ? { from: f.from } : {}),
        ...(f.to ? { to: f.to } : {}),
        ...(f.sectionId ? { sectionId: f.sectionId } : {}),
        ...(f.subjectId ? { subjectId: f.subjectId } : {}),
        ...(f.teacherId ? { teacherId: f.teacherId } : {}),
      },
      signal,
    ),
  );

  return (
    <>
      <div className={styles.toolbar}>
        {yearSelect}
        <TextField
          label="From"
          type="date"
          value={f.from}
          onChange={(e) => set({ from: e.target.value })}
        />
        <TextField
          label="To"
          type="date"
          value={f.to}
          onChange={(e) => set({ to: e.target.value })}
        />
        <SelectField
          label="Class and section"
          value={f.sectionId}
          placeholder="All classes"
          onChange={(e) => set({ sectionId: e.target.value })}
          options={(classes.status === 'ready' ? classes.data.items : []).map((s) => ({
            value: s.sectionId,
            label: `${s.className} ${s.sectionName}`,
          }))}
        />
        <SelectField
          label="Subject"
          value={f.subjectId}
          placeholder="All subjects"
          onChange={(e) => set({ subjectId: e.target.value })}
          options={(subjectList.status === 'ready' ? subjectList.data : []).map((s) => ({
            value: s.id,
            label: s.name,
          }))}
        />
        <SelectField
          label="Teacher"
          value={f.teacherId}
          placeholder="All teachers"
          onChange={(e) => set({ teacherId: e.target.value })}
          options={(teacherList.status === 'ready' ? teacherList.data.items : []).map((t) => ({
            value: t.id,
            label: `${t.fullName} (${t.staffCode})`,
          }))}
        />
      </div>
      <Panel>
        {list.status === 'loading' && <LoadingState />}
        {list.status === 'error' && <ErrorState message={list.error} onRetry={list.reload} />}
        {list.status === 'ready' &&
          (list.data.items.length === 0 ? (
            <EmptyState icon={ClipboardList} title="No saved registers">
              No attendance has been saved for these filters.
            </EmptyState>
          ) : (
            <>
              <div className={admin.tableWrap}>
                <table className={`${admin.table} ${admin.stacked}`}>
                  <caption className="visually-hidden">Saved registers</caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Period</th>
                      <th scope="col">Class</th>
                      <th scope="col">Subject · teacher</th>
                      <th scope="col">Marked</th>
                      <th scope="col">Last saved</th>
                      <th scope="col">
                        <span className="visually-hidden">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.items.map((r) => (
                      <tr key={r.sessionId}>
                        <td className={admin.strong}>{formatShortDate(r.date)}</td>
                        <td data-label="Period">
                          {r.period.label} · {formatTime(r.period.startTime)}
                        </td>
                        <td data-label="Class">
                          {r.section.className} {r.section.sectionName}
                        </td>
                        <td data-label="Subject">
                          {r.subject.name} · {r.teacher.fullName}
                        </td>
                        <td data-label="Marked">
                          <CountsLine counts={r.counts} compact />
                        </td>
                        <td data-label="Last saved">
                          {formatDateTime(r.updatedAt)}
                          {r.updatedBy ? ` · ${r.updatedBy}` : ''}
                        </td>
                        <td data-actions="">
                          <Link to={registerHref(r.date, r.period.id, r.section.sectionId)}>
                            Open
                            <span className="visually-hidden">
                              {' '}
                              register for {r.date}, {r.period.label}
                            </span>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={page}
                pageSize={list.data.pageSize}
                total={list.data.total}
                onPage={setPage}
                label="registers"
              />
            </>
          ))}
      </Panel>
    </>
  );
}
