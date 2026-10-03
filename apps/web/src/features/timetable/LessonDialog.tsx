import { useState } from 'react';
import type {
  TimetableEntryView,
  TimetableOptions,
  TimetablePeriodView,
  Weekday,
} from '@ttlmhss/shared';
import { Trash2 } from 'lucide-react';
import { Alert, Button, FormDialog, SelectField } from '../../components/ui';
import { WEEKDAY_LABELS } from '../../lib/format';
import { periodTime } from './WeekGrid';
import styles from './timetable.module.css';

export type LessonTarget =
  { kind: 'add'; day: Weekday; periodId: string } | { kind: 'edit'; entry: TimetableEntryView };

export interface LessonValues {
  sectionId: string;
  day: Weekday;
  periodId: string;
  subjectId: string;
  teacherId: string;
}

/**
 * Add or edit one lesson: class/section → day + period → subject → teacher. The teacher list shows
 * only teachers assigned the chosen subject (Teacher → Subject); the server checks it again along
 * with every conflict, and its message is shown here if the change is refused.
 */
export function LessonDialog({
  target,
  sectionId,
  options,
  periods,
  workingDays,
  pending,
  error,
  onSubmit,
  onRemove,
  onClose,
}: {
  target: LessonTarget;
  sectionId: string;
  options: TimetableOptions;
  periods: readonly TimetablePeriodView[];
  workingDays: readonly Weekday[];
  pending: boolean;
  error: string | null;
  onSubmit: (values: LessonValues) => void;
  onRemove: (entry: TimetableEntryView) => void;
  onClose: () => void;
}) {
  const editing = target.kind === 'edit' ? target.entry : null;
  const [values, setValues] = useState<LessonValues>(() =>
    editing
      ? {
          sectionId: editing.sectionId,
          day: editing.day,
          periodId: editing.periodId,
          subjectId: editing.subjectId,
          teacherId: editing.teacherId,
        }
      : {
          sectionId,
          day: target.kind === 'add' ? target.day : 'MON',
          periodId: target.kind === 'add' ? target.periodId : '',
          subjectId: '',
          teacherId: '',
        },
  );
  const [touched, setTouched] = useState(false);
  const set = (patch: Partial<LessonValues>) => setValues((v) => ({ ...v, ...patch }));

  const lessonPeriods = periods.filter(
    (p) => p.kind === 'LESSON' && (p.status === 'ACTIVE' || p.id === values.periodId),
  );
  const teachers = options.teachers.filter((t) => t.subjectIds.includes(values.subjectId));
  // The current teacher stays listed even if no longer assigned (the server will say why).
  const teacherChoices =
    editing &&
    !teachers.some((t) => t.id === values.teacherId) &&
    values.subjectId === editing.subjectId
      ? [
          ...teachers,
          {
            id: editing.teacherId,
            fullName: editing.teacherName,
            staffCode: editing.staffCode,
            subjectIds: [],
          },
        ]
      : teachers;
  const subjectChoices =
    editing && !options.subjects.some((s) => s.id === editing.subjectId)
      ? [
          ...options.subjects,
          { id: editing.subjectId, name: editing.subjectName, code: editing.subjectCode },
        ]
      : options.subjects;

  const missing = {
    sectionId: !values.sectionId ? 'Choose a class and section' : undefined,
    periodId: !values.periodId ? 'Choose a period' : undefined,
    subjectId: !values.subjectId ? 'Choose a subject' : undefined,
    teacherId: !values.teacherId ? 'Choose a teacher' : undefined,
  };
  const invalid = Object.values(missing).some(Boolean);
  const show = (key: keyof typeof missing) => (touched ? missing[key] : undefined);

  const sectionLabel = (id: string) => {
    const s = options.sections.find((x) => x.sectionId === id);
    return s
      ? `${s.className} ${s.sectionName}`
      : editing
        ? `${editing.className} ${editing.sectionName}`
        : '';
  };

  return (
    <FormDialog
      open
      title={editing ? `Edit lesson — ${sectionLabel(values.sectionId)}` : 'Add lesson'}
      submitLabel={editing ? 'Apply change' : 'Add lesson'}
      pendingLabel="Checking…"
      pending={pending}
      error={error}
      onClose={onClose}
      onSubmit={() => {
        setTouched(true);
        if (!invalid) onSubmit(values);
      }}
      description={
        <p className={styles.hint}>
          The change is checked for clashes now and kept as an unsaved change until you save the
          draft.
        </p>
      }
    >
      {options.subjects.length === 0 && (
        <Alert tone="warning">There are no active subjects. Add subjects in School setup.</Alert>
      )}
      {options.teachers.length === 0 && (
        <Alert tone="warning">There are no active teachers. Add teachers first.</Alert>
      )}
      {editing ? (
        <p className={styles.hint}>
          Class and section: <strong>{sectionLabel(values.sectionId)}</strong>
        </p>
      ) : (
        <SelectField
          label="Class and section"
          required
          value={values.sectionId}
          error={show('sectionId')}
          placeholder="Choose…"
          onChange={(e) => set({ sectionId: e.target.value })}
          options={options.sections.map((s) => ({
            value: s.sectionId,
            label: `${s.className} ${s.sectionName}`,
          }))}
        />
      )}
      <SelectField
        label="Day"
        required
        value={values.day}
        onChange={(e) => set({ day: e.target.value as Weekday })}
        options={workingDays.map((d) => ({ value: d, label: WEEKDAY_LABELS[d].long }))}
      />
      <SelectField
        label="Period"
        required
        value={values.periodId}
        error={show('periodId')}
        placeholder="Choose…"
        onChange={(e) => set({ periodId: e.target.value })}
        options={lessonPeriods.map((p) => ({
          value: p.id,
          label: `${p.label} (${periodTime(p)})`,
        }))}
      />
      <SelectField
        label="Subject"
        required
        value={values.subjectId}
        error={show('subjectId')}
        placeholder="Choose…"
        onChange={(e) => {
          const subjectId = e.target.value;
          const keep = options.teachers.some(
            (t) => t.id === values.teacherId && t.subjectIds.includes(subjectId),
          );
          set({ subjectId, teacherId: keep ? values.teacherId : '' });
        }}
        options={subjectChoices.map((s) => ({
          value: s.id,
          label: s.code ? `${s.name} (${s.code})` : s.name,
        }))}
      />
      <SelectField
        label="Teacher"
        required
        value={values.teacherId}
        error={show('teacherId')}
        placeholder={values.subjectId ? 'Choose…' : 'Choose a subject first'}
        disabled={!values.subjectId}
        hint={
          values.subjectId && teachers.length === 0
            ? 'No active teacher is assigned this subject. Assign it on the teacher’s profile first.'
            : 'Only teachers assigned this subject are listed.'
        }
        onChange={(e) => set({ teacherId: e.target.value })}
        options={teacherChoices.map((t) => ({
          value: t.id,
          label: `${t.fullName} (${t.staffCode})`,
        }))}
      />
      {editing && (
        <div>
          <Button
            variant="danger"
            size="sm"
            icon={<Trash2 size={16} aria-hidden="true" />}
            onClick={() => onRemove(editing)}
            disabled={pending}
          >
            Remove lesson
          </Button>
        </div>
      )}
    </FormDialog>
  );
}
