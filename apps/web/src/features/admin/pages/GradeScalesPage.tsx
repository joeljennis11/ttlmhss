import { useState } from 'react';
import { GradeSchemeInputSchema, orderGradeBands, type GradeSchemeView } from '@ttlmhss/shared';
import { Percent, Plus, Trash2 } from 'lucide-react';
import { Panel } from '../../../components/layout/Page';
import {
  Button,
  CheckboxField,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FormDialog,
  LoadingState,
  StatusBadge,
  TextField,
  useToast,
} from '../../../components/ui';
import { formatPercent } from '../../../lib/format';
import { useFormSubmit } from '../../../lib/use-form-submit';
import { messageOf, useResource } from '../../../lib/use-resource';
import { AdminLayout } from '../AdminLayout';
import { gradeScales as api } from '../api';
import styles from '../admin.module.css';

export function GradeScalesPage() {
  const list = useResource('grade-scales', (signal) => api.list(signal));
  const [editing, setEditing] = useState<{ scale: GradeSchemeView | null } | null>(null);
  const [removing, setRemoving] = useState<GradeSchemeView | null>(null);
  const [pending, setPending] = useState(false);
  const toast = useToast();

  async function remove() {
    if (!removing) return;
    setPending(true);
    try {
      await api.remove(removing.id);
      toast.show(`${removing.name} deleted`);
      setRemoving(null);
      list.reload();
    } catch (error) {
      toast.show(messageOf(error), 'error');
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminLayout
      page="grades"
      description="Each grade starts at a minimum percentage and runs up to the next grade, so ranges can never overlap or leave gaps. Exams (and individual exam subjects) choose which scale to use."
      actions={
        <Button
          icon={<Plus size={18} aria-hidden="true" />}
          onClick={() => setEditing({ scale: null })}
        >
          Add grade scale
        </Button>
      }
    >
      {list.status === 'loading' && <LoadingState />}
      {list.status === 'error' && <ErrorState message={list.error} onRetry={list.reload} />}
      {list.status === 'ready' &&
        (list.data.length === 0 ? (
          <Panel>
            <EmptyState icon={Percent} title="No grade scales yet">
              Add the school’s grading scale: each grade and the lowest percentage that earns it.
            </EmptyState>
          </Panel>
        ) : (
          <div className={styles.scaleGrid}>
            {list.data.map((scale) => (
              <Panel
                key={scale.id}
                title={scale.name}
                description={scale.inUse ? 'Used by an exam.' : 'Not used by any exam yet.'}
                actions={
                  <>
                    {scale.status !== 'ACTIVE' && <StatusBadge status={scale.status} />}
                    <Button variant="ghost" size="sm" onClick={() => setEditing({ scale })}>
                      Edit<span className="visually-hidden"> {scale.name}</span>
                    </Button>
                    {!scale.inUse && (
                      <Button variant="ghost" size="sm" onClick={() => setRemoving(scale)}>
                        Delete<span className="visually-hidden"> {scale.name}</span>
                      </Button>
                    )}
                  </>
                }
              >
                <table className={styles.table}>
                  <caption className="visually-hidden">Grades in {scale.name}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Grade</th>
                      <th scope="col">Percentage</th>
                      <th scope="col">Remark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scale.bands.map((band) => (
                      <tr key={band.label}>
                        <td className={styles.strong}>{band.label}</td>
                        <td className={styles.nowrap}>
                          {formatPercent(band.minPercent)} –{' '}
                          {band.maxPercent === 100
                            ? '100%'
                            : `below ${formatPercent(band.maxPercent)}`}
                        </td>
                        <td>{band.remark ?? <span className={styles.muted}>—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            ))}
          </div>
        ))}

      {editing && (
        <ScaleDialog
          scale={editing.scale}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            list.reload();
            toast.show(editing.scale ? `${saved.name} saved` : `${saved.name} added`);
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title={`Delete ${removing?.name ?? ''}?`}
        confirmLabel="Delete scale"
        tone="danger"
        pending={pending}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      >
        <p>No exam uses this scale, so it can be deleted. This cannot be undone.</p>
      </ConfirmDialog>
    </AdminLayout>
  );
}

interface BandRow {
  key: number;
  label: string;
  minPercent: string;
  remark: string;
}

const BAND_FIELD = /^(name|bands\.\d+\.(label|minPercent|remark))$/;

function ScaleDialog({
  scale,
  onClose,
  onSaved,
}: {
  scale: GradeSchemeView | null;
  onClose: () => void;
  onSaved: (scale: GradeSchemeView) => void;
}) {
  const [name, setName] = useState(scale?.name ?? '');
  const [active, setActive] = useState((scale?.status ?? 'ACTIVE') === 'ACTIVE');
  const [rows, setRows] = useState<BandRow[]>(() =>
    scale
      ? scale.bands.map((b, i) => ({
          key: i,
          label: b.label,
          minPercent: String(b.minPercent),
          remark: b.remark ?? '',
        }))
      : [
          { key: 0, label: '', minPercent: '', remark: '' },
          { key: 1, label: '', minPercent: '0', remark: '' },
        ],
  );
  const [nextKey, setNextKey] = useState(rows.length);
  const form = useFormSubmit((path) => BAND_FIELD.test(path));

  const update = (key: number, field: keyof Omit<BandRow, 'key'>, value: string) =>
    setRows((list) => list.map((r) => (r.key === key ? { ...r, [field]: value } : r)));

  const input = {
    name,
    status: active ? 'ACTIVE' : 'INACTIVE',
    bands: rows.map((r) => ({
      label: r.label,
      minPercent: r.minPercent === '' ? NaN : Number(r.minPercent),
      remark: r.remark,
    })),
  };

  // Live preview of the resulting ranges (only for rows with a valid number).
  const preview = orderGradeBands(
    input.bands
      .filter(
        (b) =>
          b.label.trim() &&
          Number.isFinite(b.minPercent) &&
          b.minPercent >= 0 &&
          b.minPercent <= 100,
      )
      .map((b) => ({ ...b, remark: null })),
  );

  async function submit() {
    const body = form.check(GradeSchemeInputSchema, input);
    if (!body) return;
    const result = await form.run(() => (scale ? api.update(scale.id, body) : api.create(body)));
    if (result.ok) onSaved(result.value);
  }

  return (
    <FormDialog
      open
      wide
      title={scale ? `Edit ${scale.name}` : 'Add grade scale'}
      description="Enter each grade and the lowest percentage that earns it. One grade must start at 0%."
      submitLabel={scale ? 'Save scale' : 'Add scale'}
      pending={form.pending}
      error={form.formError}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <TextField
        label="Scale name"
        maxLength={60}
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={form.errors.name}
        autoFocus
      />
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Grades</legend>
        <div className={styles.bandRows}>
          {rows.map((row, i) => (
            <div key={row.key} className={styles.bandRow}>
              <TextField
                label={`Grade ${i + 1}`}
                maxLength={10}
                value={row.label}
                onChange={(e) => update(row.key, 'label', e.target.value)}
                error={form.errors[`bands.${i}.label`]}
              />
              <TextField
                label="From %"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="0.01"
                value={row.minPercent}
                onChange={(e) => update(row.key, 'minPercent', e.target.value)}
                error={form.errors[`bands.${i}.minPercent`]}
              />
              <TextField
                label="Remark"
                hint={i === 0 ? 'Optional, e.g. Outstanding.' : undefined}
                maxLength={60}
                value={row.remark}
                onChange={(e) => update(row.key, 'remark', e.target.value)}
                error={form.errors[`bands.${i}.remark`]}
              />
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setRows((list) => list.filter((r) => r.key !== row.key))}
                disabled={rows.length <= 2}
                aria-label={`Remove grade ${i + 1}${row.label ? ` (${row.label})` : ''}`}
              >
                <Trash2 size={18} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
        <div className={styles.addRow}>
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus size={16} aria-hidden="true" />}
            disabled={rows.length >= 20}
            onClick={() => {
              setRows((list) => [...list, { key: nextKey, label: '', minPercent: '', remark: '' }]);
              setNextKey((k) => k + 1);
            }}
          >
            Add grade
          </Button>
        </div>
      </fieldset>
      {preview.length > 0 && (
        <div className={styles.preview}>
          <p className={styles.strong}>Resulting ranges</p>
          <p>
            {preview
              .map(
                (b) =>
                  `${b.label}: ${formatPercent(b.minPercent)}–${b.maxPercent === 100 ? '100%' : `<${formatPercent(b.maxPercent)}`}`,
              )
              .join(' · ')}
          </p>
        </div>
      )}
      {scale && (
        <CheckboxField
          label="Active"
          hint="Inactive scales stay attached to past exams but cannot be chosen for new ones."
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
      )}
    </FormDialog>
  );
}
