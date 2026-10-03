import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  GENDERS,
  GENDER_LABELS,
  TeacherCreateSchema,
  TeacherDetailsSchema,
  usernameFromIdentifier,
  type TeacherView,
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
import { teachersApi } from '../api';
import admin from '../../admin/admin.module.css';
import styles from '../people.module.css';

const DETAIL_FIELDS = [
  'fullName',
  'gender',
  'dateOfBirth',
  'phone',
  'email',
  'address',
  'designation',
  'qualification',
  'joiningDate',
] as const;
type Field = (typeof DETAIL_FIELDS)[number] | 'staffCode' | 'username';
type Values = Record<Field, string>;

const empty = (): Values =>
  Object.fromEntries([...DETAIL_FIELDS, 'staffCode', 'username'].map((f) => [f, ''])) as Values;

export function TeacherFormPage() {
  const { id } = useParams();
  const existing = useResource(id ? `teacher:${id}` : null, (signal) =>
    teachersApi.get(id!, signal),
  );
  if (!id) return <TeacherForm teacher={null} />;
  if (existing.status === 'loading') return <LoadingState />;
  if (existing.status === 'error')
    return <ErrorState message={existing.error} onRetry={existing.reload} />;
  return <TeacherForm teacher={existing.data} />;
}

function TeacherForm({ teacher }: { teacher: TeacherView | null }) {
  const creating = teacher === null;
  usePageTitle(creating ? 'Add teacher' : `Edit ${teacher.fullName}`);
  const navigate = useNavigate();
  const toast = useToast();
  const [values, setValues] = useState<Values>(() =>
    teacher
      ? {
          ...empty(),
          ...Object.fromEntries(DETAIL_FIELDS.map((f) => [f, (teacher[f] as string | null) ?? ''])),
        }
      : empty(),
  );
  const form = useFormSubmit([...DETAIL_FIELDS, 'staffCode', 'username']);
  const field = (name: Field) => ({
    value: values[name],
    onChange: (e: { target: { value: string } }) =>
      setValues((v) => ({ ...v, [name]: e.target.value })),
    error: form.errors[name],
    disabled: form.pending,
  });
  const input = (fields: readonly Field[]) =>
    Object.fromEntries(fields.map((f) => [f, values[f] === '' ? null : values[f]]));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (creating) {
      const body = form.check(
        TeacherCreateSchema,
        input([...DETAIL_FIELDS, 'staffCode', 'username']),
      );
      if (!body) return;
      const result = await form.run(() => teachersApi.create(body));
      if (result.ok) {
        toast.show(`${result.value.fullName} added`);
        navigate(`/teachers/${result.value.id}`, { state: { created: true } });
      }
    } else {
      const body = form.check(TeacherDetailsSchema, input(DETAIL_FIELDS));
      if (!body) return;
      const result = await form.run(() => teachersApi.update(teacher.id, body));
      if (result.ok) {
        toast.show('Teacher details saved');
        navigate(`/teachers/${teacher.id}`);
      }
    }
  }

  const back = teacher ? `/teachers/${teacher.id}` : '/teachers';
  return (
    <>
      <PageHeader
        title={creating ? 'Add a teacher' : `Edit ${teacher.fullName}`}
        description={
          creating
            ? 'Creates the teacher record and their sign-in account (Teacher role). Fields marked * are required.'
            : 'The staff ID cannot be changed. Subjects and class-teacher roles are managed on the teacher’s page.'
        }
        eyebrow={
          <Link to={back} className={admin.backLink}>
            ← {creating ? 'Teachers' : teacher.fullName}
          </Link>
        }
      />
      <form onSubmit={onSubmit} noValidate className={admin.stack}>
        {form.formError && <Alert tone="error">{form.formError}</Alert>}
        <Panel title="Identity">
          <div className={admin.formGrid}>
            {creating && (
              <TextField
                label="Staff ID"
                required
                maxLength={30}
                autoFocus
                hint="The school’s permanent staff number."
                {...field('staffCode')}
              />
            )}
            <TextField
              label="Full name"
              required
              maxLength={120}
              autoFocus={!creating}
              {...field('fullName')}
            />
            <SelectField
              label="Gender"
              placeholder="Not recorded"
              options={GENDERS.map((g) => ({ value: g, label: GENDER_LABELS[g] }))}
              {...field('gender')}
            />
            <TextField label="Date of birth" type="date" {...field('dateOfBirth')} />
          </div>
        </Panel>
        <Panel title="At school">
          <div className={admin.formGrid}>
            <TextField
              label="Designation"
              hint="For example PG Assistant."
              maxLength={80}
              {...field('designation')}
            />
            <TextField label="Qualification" maxLength={120} {...field('qualification')} />
            <TextField label="Joining date" type="date" {...field('joiningDate')} />
          </div>
        </Panel>
        <Panel title="Contact">
          <div className={admin.formGrid}>
            <TextField label="Phone" type="tel" maxLength={30} {...field('phone')} />
            <TextField label="Email" type="email" maxLength={120} {...field('email')} />
            <TextAreaField
              label="Address"
              maxLength={300}
              className={admin.span2}
              {...field('address')}
            />
          </div>
        </Panel>
        {creating && (
          <Panel
            title="Sign-in account"
            description="After saving you can issue a temporary password to hand over; the teacher chooses their own at first sign-in."
          >
            <TextField
              label="Username"
              hint="Optional. Leave empty to use the staff ID."
              placeholder={values.staffCode ? usernameFromIdentifier(values.staffCode) : ''}
              maxLength={64}
              autoCapitalize="none"
              spellCheck={false}
              className={admin.narrowField}
              {...field('username')}
            />
          </Panel>
        )}
        <div className={admin.formActions}>
          <Button type="submit" loading={form.pending} loadingLabel="Saving…">
            {creating ? 'Add teacher' : 'Save changes'}
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
