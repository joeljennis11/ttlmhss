import { useState } from 'react';
import type { StudentAttendanceView } from '@ttlmhss/shared';
import { CalendarX2 } from 'lucide-react';
import { Panel } from '../../../components/layout/Page';
import { Button, EmptyState, ErrorState, LoadingState, TextField } from '../../../components/ui';
import { useMediaQuery } from '../../../lib/use-media-query';
import { useResource } from '../../../lib/use-resource';
import { attendanceApi } from '../api';
import {
  AttendanceLayout,
  StatusLegend,
  StatusMark,
  SummaryTiles,
  formatShortDate,
  shiftDate,
  todayIso,
} from '../attendance-shared';
import styles from '../attendance.module.css';

/** A student's own period-wise attendance (read-only), with totals for the chosen dates. */
export function MyAttendancePage() {
  const today = todayIso();
  const [from, setFrom] = useState(shiftDate(today, -27));
  const [to, setTo] = useState(today);
  const view = useResource(`att-me:${from}:${to}`, (signal) => attendanceApi.me(from, to, signal));
  return (
    <AttendanceLayout
      title="My attendance"
      description="Your attendance for each period. Attendance % counts only Present and Absent periods."
    >
      <div className={styles.toolbar}>
        <TextField
          label="From"
          type="date"
          value={from}
          max={to}
          onChange={(e) => e.target.value && setFrom(e.target.value)}
        />
        <TextField
          label="To"
          type="date"
          value={to}
          min={from}
          max={today}
          onChange={(e) => e.target.value && setTo(e.target.value)}
        />
      </div>
      {view.status === 'loading' && <LoadingState />}
      {view.status === 'error' && <ErrorState message={view.error} onRetry={view.reload} />}
      {view.status === 'ready' && <Body view={view.data} />}
    </AttendanceLayout>
  );
}

function Body({ view }: { view: StudentAttendanceView }) {
  const phone = useMediaQuery('(max-width: 767px)');
  const [list, setList] = useState(false);
  return (
    <>
      <Panel title="Summary">
        <SummaryTiles counts={view.counts} />
      </Panel>
      <Panel
        title="By day"
        actions={
          !phone && view.days.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={list}
              onClick={() => setList((v) => !v)}
            >
              {list ? 'Show as grid' : 'Show each lesson'}
            </Button>
          ) : undefined
        }
      >
        {view.days.length === 0 ? (
          <EmptyState icon={CalendarX2} title="No lessons in these dates">
            Choose other dates, or check back after your lessons have taken place.
          </EmptyState>
        ) : (
          <div className={styles.stack} style={{ gap: 'var(--space-3)' }}>
            <StatusLegend />
            {phone ? (
              <ul className={styles.dayCards}>
                {view.days.map((d) => (
                  <li key={d.date} className={styles.dayCard}>
                    <h3>{formatShortDate(d.date)}</h3>
                    <ul className={styles.chips}>
                      {view.periods
                        .filter((p) => d.cells[p.id])
                        .map((p) => (
                          <li key={p.id}>
                            {p.label}: <StatusMark status={d.cells[p.id]!.status} />{' '}
                            {d.cells[p.id]!.subjectName} · {d.cells[p.id]!.teacherName}
                          </li>
                        ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : list ? (
              <div className={styles.scroll} role="region" aria-label="Lessons" tabIndex={0}>
                <table className={styles.matrix}>
                  <caption className="visually-hidden">Attendance for each lesson</caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Period</th>
                      <th scope="col">Subject</th>
                      <th scope="col">Teacher</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.days.flatMap((d) =>
                      view.periods
                        .filter((p) => d.cells[p.id])
                        .map((p) => {
                          const cell = d.cells[p.id]!;
                          return (
                            <tr key={`${d.date}:${p.id}`}>
                              <th scope="row">{formatShortDate(d.date)}</th>
                              <td>{p.label}</td>
                              <td>{cell.subjectName}</td>
                              <td>{cell.teacherName}</td>
                              <td>
                                <StatusMark status={cell.status} />
                              </td>
                            </tr>
                          );
                        }),
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div
                className={styles.scroll}
                role="region"
                aria-label="Attendance by day"
                tabIndex={0}
              >
                <table className={styles.matrix}>
                  <caption className="visually-hidden">Attendance by day and period</caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      {view.periods.map((p) => (
                        <th key={p.id} scope="col">
                          {p.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {view.days.map((d) => (
                      <tr key={d.date}>
                        <th scope="row">{formatShortDate(d.date)}</th>
                        {view.periods.map((p) => {
                          const cell = d.cells[p.id];
                          return (
                            <td
                              key={p.id}
                              className={styles.cell}
                              title={cell ? `${cell.subjectName} · ${cell.teacherName}` : undefined}
                            >
                              {cell ? (
                                <StatusMark status={cell.status} />
                              ) : (
                                <span aria-label="No lesson">·</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Panel>
    </>
  );
}
