import { useState } from 'react';
import {
  ClassCreateSchema,
  SectionCreateSchema,
  type ClassView,
  type SectionView,
} from '@ttlmhss/shared';
import { Layers, Plus } from 'lucide-react';
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
import { classes as api } from '../api';
import styles from '../admin.module.css';

type Dialog =
  | { kind: 'class'; cls: ClassView | null }
  | { kind: 'section'; cls: ClassView; section: SectionView | null };

export function ClassesPage() {
  const list = useResource('classes', (signal) => api.list(signal));
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const toast = useToast();

  const nextOrder =
    list.status === 'ready' ? Math.max(0, ...list.data.map((c) => c.displayOrder)) + 1 : 1;

  return (
    <AdminLayout
      page="classes"
      description="The classes the school runs and their sections. Classes are listed in display order. Deactivate a class or section instead of deleting it, so its history stays intact."
      actions={
        <Button
          icon={<Plus size={18} aria-hidden="true" />}
          onClick={() => setDialog({ kind: 'class', cls: null })}
        >
          Add class
        </Button>
      }
    >
      {list.status === 'loading' && <LoadingState />}
      {list.status === 'error' && <ErrorState message={list.error} onRetry={list.reload} />}
      {list.status === 'ready' && (
        <Panel>
          {list.data.length === 0 ? (
            <EmptyState icon={Layers} title="No classes yet">
              Add the classes the school runs (for example LKG, UKG, I … XII), then add sections to
              each class.
            </EmptyState>
          ) : (
            <ul className={styles.classList}>
              {list.data.map((cls) => (
                <li key={cls.id} className={styles.classItem}>
                  <div>
                    <span className={styles.className}>{cls.name}</span>{' '}
                    {cls.status !== 'ACTIVE' && <StatusBadge status={cls.status} />}
                    <div className={styles.meta}>Order {cls.displayOrder}</div>
                  </div>
                  <div className={styles.chips} role="group" aria-label={`Sections of ${cls.name}`}>
                    {cls.sections.length === 0 && (
                      <span className={styles.muted}>No sections yet</span>
                    )}
                    {cls.sections.map((section) => (
                      <button
                        key={section.id}
                        type="button"
                        className={styles.chip}
                        data-inactive={section.status !== 'ACTIVE' || undefined}
                        onClick={() => setDialog({ kind: 'section', cls, section })}
                        aria-label={`Edit section ${cls.name} ${section.name}${section.status !== 'ACTIVE' ? ' (inactive)' : ''}`}
                      >
                        {section.name}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`${styles.chip} ${styles.chipAdd}`}
                      onClick={() => setDialog({ kind: 'section', cls, section: null })}
                    >
                      <Plus size={14} aria-hidden="true" />
                      Section<span className="visually-hidden"> for {cls.name}</span>
                    </button>
                  </div>
                  <div className={styles.rowActions}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDialog({ kind: 'class', cls })}
                    >
                      Edit<span className="visually-hidden"> {cls.name}</span>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {dialog?.kind === 'class' && (
        <ClassDialog
          cls={dialog.cls}
          nextOrder={nextOrder}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setDialog(null);
            list.reload();
            toast.show(dialog.cls ? `${saved.name} saved` : `${saved.name} added`);
          }}
        />
      )}
      {dialog?.kind === 'section' && (
        <SectionDialog
          cls={dialog.cls}
          section={dialog.section}
          onClose={() => setDialog(null)}
          onSaved={(message) => {
            setDialog(null);
            list.reload();
            toast.show(message);
          }}
        />
      )}
    </AdminLayout>
  );
}

function ClassDialog({
  cls,
  nextOrder,
  onClose,
  onSaved,
}: {
  cls: ClassView | null;
  nextOrder: number;
  onClose: () => void;
  onSaved: (cls: ClassView) => void;
}) {
  const [name, setName] = useState(cls?.name ?? '');
  const [order, setOrder] = useState(String(cls?.displayOrder ?? nextOrder));
  const [active, setActive] = useState((cls?.status ?? 'ACTIVE') === 'ACTIVE');
  const form = useFormSubmit(['name', 'displayOrder']);

  async function submit() {
    const body = form.check(ClassCreateSchema, { name, displayOrder: Number(order) });
    if (!body) return;
    const result = await form.run(() =>
      cls
        ? api.update(cls.id, { ...body, status: active ? 'ACTIVE' : 'INACTIVE' })
        : api.create(body),
    );
    if (result.ok) onSaved(result.value);
  }

  return (
    <FormDialog
      open
      title={cls ? `Edit ${cls.name}` : 'Add class'}
      submitLabel={cls ? 'Save changes' : 'Add class'}
      pending={form.pending}
      error={form.formError}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <TextField
        label="Class name"
        hint="As the school writes it, for example LKG, I, X or XII."
        maxLength={30}
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={form.errors.name}
        autoFocus
      />
      <TextField
        label="Display order"
        hint="Classes are listed from the lowest number up."
        type="number"
        inputMode="numeric"
        min={0}
        max={999}
        value={order}
        onChange={(e) => setOrder(e.target.value)}
        error={form.errors.displayOrder}
      />
      {cls && (
        <CheckboxField
          label="Active"
          hint="Inactive classes are kept with their history but cannot be used for new records."
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
      )}
    </FormDialog>
  );
}

function SectionDialog({
  cls,
  section,
  onClose,
  onSaved,
}: {
  cls: ClassView;
  section: SectionView | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(section?.name ?? '');
  const [active, setActive] = useState((section?.status ?? 'ACTIVE') === 'ACTIVE');
  const form = useFormSubmit(['name']);

  async function submit() {
    const body = form.check(SectionCreateSchema, { name });
    if (!body) return;
    const result = await form.run(() =>
      section
        ? api.updateSection(section.id, { name: body.name, status: active ? 'ACTIVE' : 'INACTIVE' })
        : api.addSection(cls.id, body.name),
    );
    if (result.ok) {
      onSaved(
        section
          ? `Section ${cls.name} ${body.name} saved`
          : `Section ${cls.name} ${body.name} added`,
      );
    }
  }

  return (
    <FormDialog
      open
      title={section ? `Edit section ${cls.name} ${section.name}` : `Add a section to ${cls.name}`}
      submitLabel={section ? 'Save changes' : 'Add section'}
      pending={form.pending}
      error={form.formError}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <TextField
        label="Section name"
        hint="For example A, B or C."
        maxLength={10}
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={form.errors.name}
        autoFocus
      />
      {section && (
        <CheckboxField
          label="Active"
          hint="Inactive sections keep their history but cannot be used for new records."
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
      )}
    </FormDialog>
  );
}
