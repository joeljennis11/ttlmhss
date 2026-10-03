import { useState } from 'react';
import {
  ClassTeacherAssignSchema,
  type AcademicYearView,
  type ClassTeacherAssignmentView,
  type ClassView,
} from '@ttlmhss/shared';
import { Alert, CheckboxField, FormDialog, SelectField } from '../../components/ui';
import { useFormSubmit } from '../../lib/use-form-submit';
import { classTeachersApi } from './api';
import { currentYear, sectionOptions, yearOptions } from './people-shared';

/**
 * Assign a class teacher: Teacher + Academic year + Class/Section. If the section already has a
 * class teacher the person must tick "Replace" — reassignment is deliberate and the previous
 * assignment is kept as history.
 */
export function ClassTeacherDialog({
  title,
  years,
  classes,
  teachers,
  fixed,
  current,
  onClose,
  onDone,
}: {
  title: string;
  years: AcademicYearView[];
  classes: ClassView[];
  teachers: { value: string; label: string }[];
  /** Pre-chosen values (e.g. the teacher on their own page, or the section on the board). */
  fixed: { teacherId?: string; sectionId?: string; academicYearId?: string };
  /** The section's existing class teacher, when known. */
  current?: ClassTeacherAssignmentView | null;
  onClose: () => void;
  onDone: (a: ClassTeacherAssignmentView) => void;
}) {
  const open = years.filter((y) => y.status !== 'CLOSED');
  const [values, setValues] = useState({
    academicYearId: fixed.academicYearId ?? currentYear(open)?.id ?? '',
    sectionId: fixed.sectionId ?? '',
    teacherId: fixed.teacherId ?? '',
  });
  const [replace, setReplace] = useState(false);
  const form = useFormSubmit(['academicYearId', 'sectionId', 'teacherId']);
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));
  const conflict = form.errors.teacherId?.some((m) => m.includes('replace'));

  async function submit() {
    const body = form.check(ClassTeacherAssignSchema, { ...values, replace });
    if (!body) return;
    const result = await form.run(() => classTeachersApi.assign(body));
    if (result.ok) onDone(result.value);
  }

  return (
    <FormDialog
      open
      title={title}
      description="Class teacher scope is limited to this class and section in this academic year."
      submitLabel={replace ? 'Replace class teacher' : 'Assign'}
      pending={form.pending}
      error={form.formError}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      {!fixed.academicYearId && (
        <SelectField
          label="Academic year"
          required
          options={yearOptions(open)}
          value={values.academicYearId}
          onChange={set('academicYearId')}
          error={form.errors.academicYearId}
        />
      )}
      {!fixed.sectionId && (
        <SelectField
          label="Class and section"
          required
          placeholder="Choose…"
          options={sectionOptions(classes)}
          value={values.sectionId}
          onChange={set('sectionId')}
          error={form.errors.sectionId}
        />
      )}
      {!fixed.teacherId && (
        <SelectField
          label="Teacher"
          required
          placeholder="Choose…"
          options={teachers}
          value={values.teacherId}
          onChange={set('teacherId')}
          error={form.errors.teacherId}
        />
      )}
      {fixed.teacherId && form.errors.teacherId && (
        <Alert tone="error">{form.errors.teacherId.join(' ')}</Alert>
      )}
      {(current || conflict) && (
        <CheckboxField
          label={
            current
              ? `Replace ${current.teacherName} as class teacher`
              : 'Replace the current class teacher'
          }
          hint="Their assignment ends today and stays in the history."
          checked={replace}
          onChange={(e) => setReplace(e.target.checked)}
        />
      )}
    </FormDialog>
  );
}
