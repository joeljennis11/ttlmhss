import { useState } from 'react';
import { CategoryCreateSchema, type CategoryView } from '@ttlmhss/shared';
import { Plus, type LucideIcon } from 'lucide-react';
import { Panel } from '../../components/layout/Page';
import {
  Button,
  CheckboxField,
  ConfirmDialog,
  EmptyState,
  FormDialog,
  StatusBadge,
  TextField,
  useToast,
} from '../../components/ui';
import { useFormSubmit } from '../../lib/use-form-submit';
import { messageOf } from '../../lib/use-resource';
import { categories as api, type CategoryKind } from './api';
import styles from './admin.module.css';

/**
 * Behaviour and achievement categories share one editor. "Add suggested" inserts the example
 * categories from the specification ONLY when the administrator chooses to; nothing is seeded.
 */
export function CategoryManager({
  kind,
  title,
  description,
  icon,
  emptyText,
  suggested,
  items,
  onChanged,
}: {
  kind: CategoryKind;
  title: string;
  description: string;
  icon: LucideIcon;
  emptyText: string;
  suggested: readonly string[];
  items: CategoryView[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<{ item: CategoryView | null } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const existing = new Set(items.map((i) => i.name.toLowerCase()));
  const missing = suggested.filter((name) => !existing.has(name.toLowerCase()));
  const nextOrder = Math.max(0, ...items.map((i) => i.displayOrder)) + 1;

  async function addSuggested() {
    setAdding(true);
    let added = 0;
    try {
      for (const [i, name] of missing.entries()) {
        await api.create(kind, { name, description: null, displayOrder: nextOrder + i });
        added++;
      }
      toast.show(`${added} ${added === 1 ? 'category' : 'categories'} added`);
      setSuggesting(false);
    } catch (error) {
      toast.show(messageOf(error), 'error');
    } finally {
      setAdding(false);
      onChanged();
    }
  }

  return (
    <Panel
      title={title}
      description={description}
      actions={
        <>
          {missing.length > 0 && (
            <Button variant="secondary" size="sm" onClick={() => setSuggesting(true)}>
              Add suggested
            </Button>
          )}
          <Button
            size="sm"
            icon={<Plus size={16} aria-hidden="true" />}
            onClick={() => setEditing({ item: null })}
          >
            Add category
          </Button>
        </>
      }
    >
      {items.length === 0 ? (
        <EmptyState icon={icon} title="No categories yet">
          {emptyText}
        </EmptyState>
      ) : (
        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.stacked}`}>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Description</th>
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
              {items.map((item) => (
                <tr key={item.id} data-muted={item.status !== 'ACTIVE' || undefined}>
                  <td className={styles.strong}>{item.name}</td>
                  <td data-label="Description">
                    {item.description ?? <span className={styles.muted}>—</span>}
                  </td>
                  <td data-label="Order" className={styles.num}>
                    {item.displayOrder}
                  </td>
                  <td data-label="Status">
                    <StatusBadge status={item.status} />
                  </td>
                  <td data-actions="">
                    <div className={styles.rowActions}>
                      <Button variant="ghost" size="sm" onClick={() => setEditing({ item })}>
                        Edit<span className="visually-hidden"> {item.name}</span>
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <CategoryDialog
          kind={kind}
          item={editing.item}
          nextOrder={nextOrder}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            onChanged();
            toast.show(editing.item ? `${saved.name} saved` : `${saved.name} added`);
          }}
        />
      )}
      <ConfirmDialog
        open={suggesting}
        title="Add the suggested categories?"
        confirmLabel={`Add ${missing.length}`}
        pending={adding}
        onConfirm={() => void addSuggested()}
        onCancel={() => setSuggesting(false)}
      >
        <p>These starting points will be added. You can rename or deactivate them afterwards:</p>
        <p className={styles.strong}>{missing.join(', ')}</p>
      </ConfirmDialog>
    </Panel>
  );
}

function CategoryDialog({
  kind,
  item,
  nextOrder,
  onClose,
  onSaved,
}: {
  kind: CategoryKind;
  item: CategoryView | null;
  nextOrder: number;
  onClose: () => void;
  onSaved: (item: CategoryView) => void;
}) {
  const [values, setValues] = useState({
    name: item?.name ?? '',
    description: item?.description ?? '',
    displayOrder: String(item?.displayOrder ?? nextOrder),
  });
  const [active, setActive] = useState((item?.status ?? 'ACTIVE') === 'ACTIVE');
  const form = useFormSubmit(['name', 'description', 'displayOrder']);
  const set = (name: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [name]: e.target.value }));

  async function submit() {
    const body = form.check(CategoryCreateSchema, {
      ...values,
      displayOrder: Number(values.displayOrder),
    });
    if (!body) return;
    const result = await form.run(() =>
      item
        ? api.update(kind, item.id, { ...body, status: active ? 'ACTIVE' : 'INACTIVE' })
        : api.create(kind, body),
    );
    if (result.ok) onSaved(result.value);
  }

  return (
    <FormDialog
      open
      title={item ? `Edit ${item.name}` : 'Add category'}
      submitLabel={item ? 'Save changes' : 'Add category'}
      pending={form.pending}
      error={form.formError}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <TextField
        label="Name"
        maxLength={60}
        value={values.name}
        onChange={set('name')}
        error={form.errors.name}
        autoFocus
      />
      <TextField
        label="Description"
        hint="Optional."
        maxLength={200}
        value={values.description}
        onChange={set('description')}
        error={form.errors.description}
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
        className={styles.narrowField}
      />
      {item && (
        <CheckboxField
          label="Active"
          hint="Inactive categories keep their history but cannot be used for new records."
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
      )}
    </FormDialog>
  );
}
