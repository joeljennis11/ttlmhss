import { useState } from 'react';
import {
  EXAM_STAGE_LABELS,
  type ExamMarksMatrixView,
  type ExamStage,
  type ExamView,
} from '@ttlmhss/shared';
import { Panel } from '../../components/layout/Page';
import {
  Alert,
  Button,
  ConfirmDialog,
  ErrorState,
  LoadingState,
  useToast,
} from '../../components/ui';
import { messageOf, type Resource } from '../../lib/use-resource';
import { examAdminApi } from '../marks/api';
import { SheetStatusBadge, StageBadge, describeMaximum } from '../marks/marks-shared';
import styles from './admin.module.css';

type Matrix = Resource<ExamMarksMatrixView> & {
  reload: () => void;
  replace: (data: ExamMarksMatrixView) => void;
};

const ACTIONS: Record<
  ExamStage,
  { to: ExamStage; label: string; text: string; danger?: boolean }[]
> = {
  DRAFT: [
    {
      to: 'OPEN',
      label: 'Open for marks',
      text: 'Authorised teachers can then enter and submit marks. Students see each subject as soon as its marks are submitted.',
    },
  ],
  OPEN: [
    {
      to: 'CLOSED',
      label: 'Close exam',
      text: 'Marks can no longer be entered, submitted or unlocked. Subjects not submitted stay unavailable to students. You can reopen the exam later.',
      danger: true,
    },
    {
      to: 'DRAFT',
      label: 'Back to draft',
      text: 'Only possible while no marks have been entered. Teachers can no longer open the exam.',
    },
  ],
  CLOSED: [
    {
      to: 'OPEN',
      label: 'Reopen for marks',
      text: 'Authorised teachers can enter marks again, and submitted marks can be unlocked.',
    },
  ],
};

/** Phase 8B: the exam's marks lifecycle (Draft → Open for marks → Closed). */
export function StagePanel({
  exam,
  matrix,
  onChanged,
}: {
  exam: ExamView;
  matrix: Matrix;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [pending, setPending] = useState<ExamStage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = ACTIONS[exam.stage].find((a) => a.to === pending);

  async function change(stage: ExamStage) {
    setBusy(true);
    setError(null);
    try {
      const result = await examAdminApi.setStage(exam.id, stage);
      matrix.replace(result);
      onChanged();
      toast.show(`${exam.name}: ${EXAM_STAGE_LABELS[stage]}`);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <Panel
      title="Marks and results"
      description="Draft: being set up. Open for marks: authorised teachers enter and submit marks. Closed: marks are frozen."
      actions={<StageBadge stage={exam.stage} />}
    >
      {error && <Alert tone="error">{error}</Alert>}
      {matrix.status === 'ready' && (
        <>
          {matrix.data.calendarNotes.map((note) => (
            <Alert key={note} tone="warning" title="Exam date and calendar">
              {note}
            </Alert>
          ))}
          <p className={styles.meta}>
            {matrix.data.counts.sheets} mark sheets · {matrix.data.counts.submitted} submitted ·{' '}
            {matrix.data.counts.withoutTeacher} without an authorised teacher
          </p>
        </>
      )}
      {exam.status !== 'ACTIVE' && (
        <p className={styles.meta}>Make the exam active to open it for marks.</p>
      )}
      <div className={styles.formActions}>
        {ACTIONS[exam.stage].map((a) => (
          <Button
            key={a.to}
            variant={a.to === 'OPEN' ? 'primary' : 'secondary'}
            onClick={() => setPending(a.to)}
            disabled={busy || (a.to === 'OPEN' && exam.status !== 'ACTIVE')}
          >
            {a.label}
          </Button>
        ))}
      </div>
      <ConfirmDialog
        open={action !== undefined}
        title={action ? `${action.label}: ${exam.name}?` : ''}
        confirmLabel={action?.label ?? 'Confirm'}
        tone={action?.danger ? 'danger' : 'primary'}
        pending={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && void change(pending)}
      >
        <p>{action?.text}</p>
      </ConfirmDialog>
    </Panel>
  );
}

/**
 * Phase 8B: who enters each subject's marks for each section of the chosen class. Only teachers
 * who teach the subject (Teacher → Subject) are offered; the timetable is never used.
 */
export function MarkEntryPanel({ classId, matrix }: { classId: string; matrix: Matrix }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (matrix.status === 'loading') return <LoadingState />;
  if (matrix.status === 'error')
    return <ErrorState message={matrix.error} onRetry={matrix.reload} />;
  const rows = matrix.data.rows.filter((r) => r.classId === classId);

  async function assign(examSubjectId: string, sectionId: string, teacherId: string | null) {
    const key = `${examSubjectId}:${sectionId}`;
    setBusy(key);
    setError(null);
    try {
      const result = await examAdminApi.setTeacher(examSubjectId, sectionId, teacherId);
      matrix.replace(result);
      const row = result.rows.find(
        (r) => r.examSubjectId === examSubjectId && r.sectionId === sectionId,
      );
      toast.show(
        row?.teacher
          ? `${row.teacher.fullName} can enter ${row.subjectName} marks for ${row.className} ${row.sectionName}`
          : 'Mark entry is now for administrators only',
      );
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel
      title="Mark entry"
      description="Choose the teacher who enters each subject's marks for each section. A class teacher can view (and unlock) every sheet of their class but enters marks only where chosen here."
    >
      {error && <Alert tone="error">{error}</Alert>}
      {rows.length === 0 ? (
        <p className={styles.meta}>Save the subjects of this class first.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table} aria-label="Mark entry teachers">
            <thead>
              <tr>
                <th scope="col">Subject</th>
                <th scope="col">Section</th>
                <th scope="col">Maximum</th>
                <th scope="col" className={styles.num}>
                  Pass
                </th>
                <th scope="col">Enters marks</th>
                <th scope="col">Status</th>
                <th scope="col" className={styles.num}>
                  Entered
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = `${r.examSubjectId}:${r.sectionId}`;
                const options = [...(matrix.data.teachersBySubject[r.subjectId] ?? [])];
                if (r.teacher && !options.some((t) => t.id === r.teacher!.id))
                  options.push(r.teacher);
                return (
                  <tr key={key}>
                    <td className={styles.strong}>{r.subjectName}</td>
                    <td>
                      {r.className} {r.sectionName}
                    </td>
                    <td className={styles.nowrap}>{describeMaximum(r.structure)}</td>
                    <td className={styles.num}>{r.structure.passMarks}</td>
                    <td>
                      <select
                        className={styles.teacherSelect}
                        aria-label={`Teacher who enters ${r.subjectName} marks for ${r.className} ${r.sectionName}`}
                        value={r.teacher?.id ?? ''}
                        disabled={busy !== null}
                        onChange={(e) =>
                          void assign(r.examSubjectId, r.sectionId, e.target.value || null)
                        }
                      >
                        <option value="">Administrators only</option>
                        {options.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.fullName} ({t.staffCode})
                          </option>
                        ))}
                      </select>
                      {r.teacherProblem && (
                        <span className={styles.meta} style={{ display: 'block' }}>
                          {r.teacherProblem}
                        </span>
                      )}
                      {options.length === 0 && (
                        <span className={styles.meta} style={{ display: 'block' }}>
                          No active teacher has this subject.
                        </span>
                      )}
                    </td>
                    <td>
                      <SheetStatusBadge status={r.status} />
                    </td>
                    <td className={styles.num}>{r.entered}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
