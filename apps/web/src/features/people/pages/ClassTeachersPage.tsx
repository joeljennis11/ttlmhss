import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { ClassTeacherBoard } from '@ttlmhss/shared';
import { Layers } from 'lucide-react';
import { usePageTitle } from '../../../app/page-meta';
import { PageHeader, Panel } from '../../../components/layout/Page';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  SelectField,
  useToast,
} from '../../../components/ui';
import { formatDate } from '../../../lib/format';
import { messageOf, useResource } from '../../../lib/use-resource';
import { classTeachersApi, teachersApi } from '../api';
import { ClassTeacherDialog } from '../ClassTeacherDialog';
import { currentYear, useSchoolStructure, yearOptions } from '../people-shared';
import admin from '../../admin/admin.module.css';

type Row = ClassTeacherBoard['rows'][number];

/** Class teacher for every class/section of a year, with assign / replace / end. */
export function ClassTeachersPage() {
  usePageTitle('Class teachers');
  const toast = useToast();
  const structure = useSchoolStructure();
  const [params, setParams] = useSearchParams();
  const years = structure.years.status === 'ready' ? structure.years.data : [];
  const yearId = params.get('year') ?? currentYear(years)?.id ?? null;
  const year = years.find((y) => y.id === yearId) ?? null;
  const board = useResource(yearId ? `ct-board:${yearId}` : null, (signal) =>
    classTeachersApi.board(yearId!, signal),
  );
  const teachers = useResource('active-teachers', (signal) =>
    teachersApi.list({ status: 'ACTIVE', pageSize: 100 }, signal),
  );
  const [editing, setEditing] = useState<Row | null>(null);
  const [ending, setEnding] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);

  async function end() {
    if (!ending?.assignment) return;
    setBusy(true);
    try {
      await classTeachersApi.end(ending.assignment.id);
      toast.show('Class teacher assignment ended');
      setEnding(null);
      board.reload();
    } catch (error) {
      toast.show(messageOf(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  const closed = year?.status === 'CLOSED';

  return (
    <>
      <PageHeader
        title="Class teachers"
        description="One class teacher per class and section in each academic year. Replacing a class teacher keeps the earlier assignment in the history."
        eyebrow={
          <Link to="/teachers" className={admin.backLink}>
            ← Teachers
          </Link>
        }
      />
      {structure.years.status === 'loading' && <LoadingState />}
      {structure.years.status === 'error' && (
        <ErrorState message={structure.years.error} onRetry={structure.years.reload} />
      )}
      {structure.years.status === 'ready' && !yearId && (
        <Panel>
          <EmptyState icon={Layers} title="Add an academic year first" />
        </Panel>
      )}
      {yearId && (
        <div className={admin.stack}>
          <div className={admin.toolbar}>
            <SelectField
              label="Academic year"
              options={yearOptions(years)}
              value={yearId}
              onChange={(e) => setParams({ year: e.target.value }, { replace: true })}
            />
          </div>
          <Panel>
            {board.status === 'loading' && <LoadingState />}
            {board.status === 'error' && (
              <ErrorState message={board.error} onRetry={board.reload} />
            )}
            {board.status === 'ready' &&
              (board.data.rows.length === 0 ? (
                <EmptyState icon={Layers} title="No active classes">
                  Add classes and sections in School setup first.
                </EmptyState>
              ) : (
                <div className={admin.tableWrap}>
                  <table className={`${admin.table} ${admin.stacked}`}>
                    <caption className="visually-hidden">Class teachers for {year?.label}</caption>
                    <thead>
                      <tr>
                        <th scope="col">Class</th>
                        <th scope="col">Class teacher</th>
                        <th scope="col">Since</th>
                        <th scope="col">
                          <span className="visually-hidden">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {board.data.rows.map((row) => (
                        <tr key={row.sectionId}>
                          <td className={admin.strong}>
                            {row.className} {row.sectionName}
                          </td>
                          <td data-label="Class teacher">
                            {row.assignment ? (
                              <Link to={`/teachers/${row.assignment.teacherId}`}>
                                {row.assignment.teacherName}
                              </Link>
                            ) : (
                              <span className={admin.muted}>Not assigned</span>
                            )}
                          </td>
                          <td data-label="Since">
                            {row.assignment ? formatDate(row.assignment.assignedOn) : '—'}
                          </td>
                          <td data-actions="">
                            {!closed && (
                              <div className={admin.rowActions}>
                                <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
                                  {row.assignment ? 'Replace' : 'Assign'}
                                  <span className="visually-hidden">
                                    {' '}
                                    class teacher for {row.className} {row.sectionName}
                                  </span>
                                </Button>
                                {row.assignment && (
                                  <Button variant="ghost" size="sm" onClick={() => setEnding(row)}>
                                    End
                                    <span className="visually-hidden">
                                      {' '}
                                      class teacher role for {row.className} {row.sectionName}
                                    </span>
                                  </Button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
          </Panel>
        </div>
      )}

      {editing && structure.classes.status === 'ready' && (
        <ClassTeacherDialog
          title={`${editing.assignment ? 'Replace' : 'Assign'} class teacher — ${editing.className} ${editing.sectionName}`}
          years={years}
          classes={structure.classes.data}
          teachers={
            teachers.status === 'ready'
              ? teachers.data.items
                  .filter((t) => t.id !== editing.assignment?.teacherId)
                  .map((t) => ({ value: t.id, label: `${t.fullName} (${t.staffCode})` }))
              : []
          }
          fixed={{ academicYearId: yearId!, sectionId: editing.sectionId }}
          current={editing.assignment}
          onClose={() => setEditing(null)}
          onDone={(a) => {
            setEditing(null);
            board.reload();
            toast.show(`${a.teacherName} is class teacher of ${a.className} ${a.sectionName}`);
          }}
        />
      )}
      <ConfirmDialog
        open={ending !== null}
        title="End class teacher role?"
        confirmLabel="End role"
        pending={busy}
        onConfirm={() => void end()}
        onCancel={() => setEnding(null)}
      >
        <p>
          {ending?.assignment?.teacherName} stops being class teacher of {ending?.className}{' '}
          {ending?.sectionName} today. The assignment stays in the history.
        </p>
      </ConfirmDialog>
    </>
  );
}
