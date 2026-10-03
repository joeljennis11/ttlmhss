import { useState, type FormEvent } from 'react';
import {
  RatingLabelsUpdateSchema,
  SUGGESTED_BEHAVIOUR_CATEGORIES,
  SUGGESTED_RATING_LABELS,
  type RatingLabelView,
} from '@ttlmhss/shared';
import { Smile } from 'lucide-react';
import { Panel } from '../../../components/layout/Page';
import {
  Alert,
  Button,
  ErrorState,
  LoadingState,
  TextField,
  useToast,
} from '../../../components/ui';
import { useFormSubmit } from '../../../lib/use-form-submit';
import { useResource } from '../../../lib/use-resource';
import { AdminLayout } from '../AdminLayout';
import { CategoryManager } from '../CategoryManager';
import { behaviour } from '../api';
import styles from '../admin.module.css';

export function BehaviourPage() {
  const config = useResource('behaviour', (signal) => behaviour.get(signal));
  return (
    <AdminLayout
      page="behaviour"
      description="Behaviour is rated with each exam result, not daily. Teachers give each category a rating from 1 to 5 with an optional remark."
    >
      {config.status === 'loading' && <LoadingState />}
      {config.status === 'error' && <ErrorState message={config.error} onRetry={config.reload} />}
      {config.status === 'ready' && (
        <>
          <CategoryManager
            kind="behaviour"
            title="Behaviour categories"
            description="What is rated, for example Discipline or Punctuality."
            icon={Smile}
            emptyText="Add the behaviour categories the school rates."
            suggested={SUGGESTED_BEHAVIOUR_CATEGORIES}
            items={config.data.categories}
            onChanged={config.reload}
          />
          <RatingLabelsForm
            key={config.data.ratingLabels.map((l) => l.label).join('|')}
            initial={config.data.ratingLabels}
            onSaved={(ratingLabels) => config.replace({ ...config.data, ratingLabels })}
          />
        </>
      )}
    </AdminLayout>
  );
}

function RatingLabelsForm({
  initial,
  onSaved,
}: {
  initial: RatingLabelView[];
  onSaved: (labels: RatingLabelView[]) => void;
}) {
  const [rows, setRows] = useState(() =>
    initial.map((l) => ({
      rating: l.rating,
      label: l.label ?? '',
      description: l.description ?? '',
    })),
  );
  const form = useFormSubmit((path) => /^labels\.\d\.(label|description)$/.test(path));
  const toast = useToast();
  const configured = initial.every((l) => l.label);

  const update = (rating: number, field: 'label' | 'description', value: string) =>
    setRows((list) => list.map((r) => (r.rating === rating ? { ...r, [field]: value } : r)));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const body = form.check(RatingLabelsUpdateSchema, { labels: rows });
    if (!body) return;
    const result = await form.run(() => behaviour.setLabels(body));
    if (result.ok) {
      onSaved(result.value);
      toast.show('Rating labels saved');
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Panel
        title="Rating labels"
        description="What each rating means. Shown to teachers when rating and to students on their results."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setRows((list) =>
                list.map((r) => ({
                  ...r,
                  label: SUGGESTED_RATING_LABELS[r.rating - 1] ?? r.label,
                })),
              )
            }
          >
            Fill in suggested labels
          </Button>
        }
      >
        <div className={styles.stack}>
          {!configured && (
            <Alert tone="info">
              Not set yet. Enter a label for every rating from 1 (lowest) to 5 (highest).
            </Alert>
          )}
          {form.formError && <Alert tone="error">{form.formError}</Alert>}
          <div className={styles.labelRows}>
            {rows.map((row, i) => (
              <div key={row.rating} className={styles.labelRow}>
                <span className={styles.ratingNumber} aria-hidden="true">
                  {row.rating}
                </span>
                <TextField
                  label={`Rating ${row.rating} label`}
                  maxLength={40}
                  value={row.label}
                  onChange={(e) => update(row.rating, 'label', e.target.value)}
                  error={form.errors[`labels.${i}.label`]}
                />
                <TextField
                  label="Description"
                  hint={i === 0 ? 'Optional.' : undefined}
                  maxLength={150}
                  value={row.description}
                  onChange={(e) => update(row.rating, 'description', e.target.value)}
                  error={form.errors[`labels.${i}.description`]}
                />
              </div>
            ))}
          </div>
          <div>
            <Button type="submit" loading={form.pending} loadingLabel="Saving…">
              Save rating labels
            </Button>
          </div>
        </div>
      </Panel>
    </form>
  );
}
