import { useState } from 'react';
import { SubjectCreateSchema, type SubjectView } from '@ttlmhss/shared';
import { Library, Plus } from 'lucide-react';
import { Panel } from '../../../components/layout/Page';
import {
  Button,
  CheckboxField,
  EmptyState,
  ErrorState,
  FormDialog,
  LoadingState,
  StatusBadge,
  TextField,
  useToast,
} from '../../../components/ui';
import { useFormSubmit } from '../../../lib/use-form-submit';
import { useResource } from '../../../lib/use-resource';
import { AdminLayout } from '../AdminLayout';
import { subjects as api } from '../api';
import styles from '../admin.module.css';

export function SubjectsPage() {
  const list = useResource('subjects', (signal) => api.list(signal));
  const [editing, setEditing] = useState<{ subject: SubjectView | null } | null>(null);
  const toast = useToast();
  const nextOrder =
    list.status === 'ready' ? Math.max(0, ...list.data.map((s) => s.displayOrder)) + 1 : 1;

  return (
    <AdminLayout
      page="subjects"
      description="The master list of subjects. Teachers are linked to subjects, and timetables and exams use them. Deactivate a subject the school no longer teaches; its history is kept."
      actions={
        <Button
          icon={<Plus size={18} aria-hidden="true" />}
          onClick={() => setEditing({ subject: null })}
        >
          Add subject
        </Button>
      }
    >
      {list.status === 'loading' && <LoadingState />}
      {list.status === 'error' && <ErrorState message={list.error} onRetry={list.reload} />}
      {list.status === 'ready' && (
        <Panel>
          {list.data.length === 0 ? (
            <EmptyState icon={Library} title="No subjects yet">
              Add the subjects taught at the school.
            </EmptyState>
          ) : (
            <div className={styles.tableWrap}>
              <table className={`${styles.table} ${styles.stacked}`}>
                <thead>
                  <tr>
                    <th scope="col">Subject</th>
                    <th scope="col">Code</th>
                    <th scope="col" className={styles.num}>
                      Order
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((subject) => (
                    <tr key={subject.id} data-muted={subject.status !== 'ACTIVE' || undefined}>
                      <td className={styles.strong}>{subject.name}</td>
                      <td data-label="Code">
                        {subject.code ?? <span className={styles.muted}>—</span>}
                      </td>
                      <td data-label="Order" className={styles.num}>
                        {subject.displayOrder}
                      </td>
                      <td data-label="Status">
                        <StatusBadge status={subject.status} />
                      </td>
                      <td data-actions="">
                        <div className={styles.rowActions}>
                          <Button variant="ghost" size="sm" onClick={() => setEditing({ subject })}>
                            Edit<span className="visually-hidden"> {subject.name}</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
      {editing && (
        <SubjectDialog
          subject={editing.subject}
          nextOrder={nextOrder}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            list.reload();
            toast.show(editing.subject ? `${saved.name} saved` : `${saved.name} added`);
          }}
        />
      )}
    </AdminLayout>
  );
}

function SubjectDialog({
  subject,
  nextOrder,
  onClose,
  onSaved,
}: {
  subject: SubjectView | null;
  nextOrder: number;
  onClose: () => void;
  onSaved: (subject: SubjectView) => void;
}) {
  const [values, setValues] = useState({
    name: subject?.name ?? '',
    code: subject?.code ?? '',
    displayOrder: String(subject?.displayOrder ?? nextOrder),
  });
  const [active, setActive] = useState((subject?.status ?? 'ACTIVE') === 'ACTIVE');
  const form = useFormSubmit(['name', 'code', 'displayOrder']);
  const set = (name: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [name]: e.target.value }));

  async function submit() {
    const body = form.check(SubjectCreateSchema, {
      ...values,
      displayOrder: Number(values.displayOrder),
    });
    if (!body) return;
    const result = await form.run(() =>
      subject
        ? api.update(subject.id, { ...body, status: active ? 'ACTIVE' : 'INACTIVE' })
        : api.create(body),
    );
    if (result.ok) onSaved(result.value);
  }

  return (
    <FormDialog
      open
      title={subject ? `Edit ${subject.name}` : 'Add subject'}
      submitLabel={subject ? 'Save changes' : 'Add subject'}
      pending={form.pending}
      error={form.formError}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <TextField
        label="Subject name"
        maxLength={80}
        value={values.name}
        onChange={set('name')}
        error={form.errors.name}
        autoFocus
      />
      <div className={styles.formGrid}>
        <TextField
          label="Code"
          hint="Optional short code, for example ENG."
          maxLength={12}
          autoCapitalize="characters"
          value={values.code}
          onChange={set('code')}
          error={form.errors.code}
        />
        <TextField
          label="Display order"
          type="number"
          inputMode="numeric"
          min={0}
          max={999}
          value={values.displayOrder}
          onChange={set('displayOrder')}
          error={form.errors.displayOrder}
        />
      </div>
      {subject && (
        <CheckboxField
          label="Active"
          hint="Inactive subjects keep their history but cannot be added to new exams or timetables."
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
      )}
    </FormDialog>
  );
}
