import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  GENDERS,
  GENDER_LABELS,
  StudentAdmissionSchema,
  StudentDetailsSchema,
  usernameFromIdentifier,
  type StudentView,
} from '@ttlmhss/shared';
import { usePageTitle } from '../../../app/page-meta';
import { PageHeader, Panel } from '../../../components/layout/Page';
import {
  Alert,
  Button,
  ErrorState,
  LoadingState,
  SelectField,
  TextAreaField,
  TextField,
  useToast,
} from '../../../components/ui';
import { useFormSubmit } from '../../../lib/use-form-submit';
import { useResource } from '../../../lib/use-resource';
import { studentsApi } from '../api';
import { currentYear, sectionOptions, useSchoolStructure, yearOptions } from '../people-shared';
import admin from '../../admin/admin.module.css';
import styles from '../people.module.css';

const DETAIL_FIELDS = [
  'fullName',
  'dateOfBirth',
  'gender',
  'fatherName',
  'motherName',
  'guardianName',
  'guardianRelation',
  'guardianPhone',
  'phone',
  'email',
  'emergencyPhone',
  'address',
  'city',
  'state',
  'pincode',
] as const;
const ADMISSION_FIELDS = [
  'admissionNumber',
  'admissionDate',
  'academicYearId',
  'sectionId',
  'rollNumber',
  'username',
] as const;
type Field = (typeof DETAIL_FIELDS)[number] | (typeof ADMISSION_FIELDS)[number];
type Values = Record<Field, string>;

const empty = (): Values =>
  Object.fromEntries([...DETAIL_FIELDS, ...ADMISSION_FIELDS].map((f) => [f, ''])) as Values;

const fromStudent = (s: StudentView): Values => ({
  ...empty(),
  ...Object.fromEntries(DETAIL_FIELDS.map((f) => [f, (s[f] as string | null) ?? ''])),
});

/** Empty strings become null/absent so the shared schema sees what the person meant. */
function toInput(values: Values, fields: readonly Field[]) {
  return Object.fromEntries(fields.map((f) => [f, values[f] === '' ? null : values[f]]));
}

export function StudentFormPage() {
  const { id } = useParams();
  const existing = useResource(id ? `student:${id}` : null, (signal) =>
    studentsApi.get(id!, signal),
  );
  if (!id) return <StudentForm student={null} />;
  if (existing.status === 'loading') return <LoadingState />;
  if (existing.status === 'error')
    return <ErrorState message={existing.error} onRetry={existing.reload} />;
  return <StudentForm student={existing.data} />;
}

/** Admission (new student) and editing share one form; admission adds the academic and account parts. */
function StudentForm({ student }: { student: StudentView | null }) {
  const admitting = student === null;
  usePageTitle(admitting ? 'Admit student' : `Edit ${student.fullName}`);
  const navigate = useNavigate();
  const toast = useToast();
  const structure = useSchoolStructure();
  const [values, setValues] = useState<Values>(() => (student ? fromStudent(student) : empty()));
  const form = useFormSubmit([...DETAIL_FIELDS, ...ADMISSION_FIELDS]);

  const years = structure.years.status === 'ready' ? structure.years.data : [];
  const classes = structure.classes.status === 'ready' ? structure.classes.data : [];
  const yearId =
    values.academicYearId ||
    (admitting ? (currentYear(years.filter((y) => y.status !== 'CLOSED'))?.id ?? '') : '');

  const field = (name: Field) => ({
    value: values[name],
    onChange: (e: { target: { value: string } }) =>
      setValues((v) => ({ ...v, [name]: e.target.value })),
    error: form.errors[name],
    disabled: form.pending,
  });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (admitting) {
      const input = {
        ...toInput(values, [...DETAIL_FIELDS, ...ADMISSION_FIELDS]),
        academicYearId: yearId,
      };
      const body = form.check(StudentAdmissionSchema, input);
      if (!body) return;
      const result = await form.run(() => studentsApi.admit(body));
      if (result.ok) {
        toast.show(`${result.value.fullName} admitted`);
        navigate(`/students/${result.value.id}`, { state: { admitted: true } });
      }
    } else {
      const body = form.check(StudentDetailsSchema, toInput(values, DETAIL_FIELDS));
      if (!body) return;
      const result = await form.run(() => studentsApi.update(student.id, body));
      if (result.ok) {
        toast.show('Student details saved');
        navigate(`/students/${student.id}`);
      }
    }
  }

  const back = student ? `/students/${student.id}` : '/students';

  return (
    <>
      <PageHeader
        title={admitting ? 'Admit a student' : `Edit ${student.fullName}`}
        description={
          admitting
            ? 'Creates the student record, their sign-in account and their place in a class. Fields marked * are required.'
            : 'Class and section changes use “Change class” on the student’s page so history is kept. The admission number cannot be changed.'
        }
        eyebrow={
          <Link to={back} className={admin.backLink}>
            ← {admitting ? 'Students' : student.fullName}
          </Link>
        }
      />
      <form onSubmit={onSubmit} noValidate className={admin.stack}>
        {form.formError && <Alert tone="error">{form.formError}</Alert>}

        {admitting && (
          <Panel
            title="Admission"
            description="The admission number is the student’s permanent school number."
          >
            {structure.years.status === 'error' && (
              <Alert tone="error">{structure.years.error}</Alert>
            )}
            <div className={admin.formGrid}>
              <TextField
                label="Admission number"
                required
                maxLength={30}
                autoFocus
                {...field('admissionNumber')}
              />
              <TextField label="Admission date" type="date" required {...field('admissionDate')} />
              <SelectField
                label="Academic year"
                required
                options={yearOptions(years, { openOnly: true })}
                placeholder="Choose…"
                {...field('academicYearId')}
                value={yearId}
              />
              <SelectField
                label="Class and section"
                required
                options={sectionOptions(classes)}
                placeholder="Choose…"
                {...field('sectionId')}
              />
              <TextField
                label="Roll number"
                hint="Optional. Belongs to this class; it can change when the student moves."
                maxLength={10}
                {...field('rollNumber')}
              />
            </div>
          </Panel>
        )}

        <Panel title="Personal">
          <div className={admin.formGrid}>
            <TextField
              label="Full name"
              required
              maxLength={120}
              autoFocus={!admitting}
              className={admin.span2}
              {...field('fullName')}
            />
            <TextField label="Date of birth" type="date" {...field('dateOfBirth')} />
            <SelectField
              label="Gender"
              placeholder="Not recorded"
              options={GENDERS.map((g) => ({ value: g, label: GENDER_LABELS[g] }))}
              {...field('gender')}
            />
          </div>
        </Panel>

        <Panel title="Parent / guardian">
          <div className={admin.formGrid}>
            <TextField label="Father’s name" maxLength={120} {...field('fatherName')} />
            <TextField label="Mother’s name" maxLength={120} {...field('motherName')} />
            <TextField
              label="Guardian’s name"
              hint="If someone else is the guardian."
              maxLength={120}
              {...field('guardianName')}
            />
            <TextField
              label="Relationship"
              hint="For example Uncle."
              maxLength={40}
              {...field('guardianRelation')}
            />
            <TextField
              label="Parent / guardian phone"
              type="tel"
              maxLength={30}
              {...field('guardianPhone')}
            />
          </div>
        </Panel>

        <Panel title="Contact">
          <div className={admin.formGrid}>
            <TextField label="Phone" type="tel" maxLength={30} {...field('phone')} />
            <TextField label="Email" type="email" maxLength={120} {...field('email')} />
            <TextField
              label="Emergency phone"
              type="tel"
              maxLength={30}
              {...field('emergencyPhone')}
            />
          </div>
        </Panel>

        <Panel title="Address">
          <div className={admin.formGrid}>
            <TextAreaField
              label="Address"
              maxLength={300}
              className={admin.span2}
              {...field('address')}
            />
            <TextField label="City / town" maxLength={80} {...field('city')} />
            <TextField label="State" maxLength={80} {...field('state')} />
            <TextField label="PIN code" inputMode="numeric" maxLength={6} {...field('pincode')} />
          </div>
        </Panel>

        {admitting && (
          <Panel
            title="Sign-in account"
            description="Every student gets their own account. After admission you can issue a temporary password to hand over; the student chooses their own at first sign-in."
          >
            <TextField
              label="Username"
              hint="Optional. Leave empty to use the admission number."
              placeholder={
                values.admissionNumber ? usernameFromIdentifier(values.admissionNumber) : ''
              }
              maxLength={64}
              autoCapitalize="none"
              spellCheck={false}
              className={admin.narrowField}
              {...field('username')}
            />
          </Panel>
        )}

        <div className={admin.formActions}>
          <Button
            type="submit"
            loading={form.pending}
            loadingLabel={admitting ? 'Admitting…' : 'Saving…'}
          >
            {admitting ? 'Admit student' : 'Save changes'}
          </Button>
          <Link to={back} className={admin.textAction}>
            Cancel
          </Link>
          <span className={styles.formHint}>* required</span>
        </div>
      </form>
    </>
  );
}
