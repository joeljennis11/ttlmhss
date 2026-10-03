import { SUGGESTED_ACHIEVEMENT_CATEGORIES } from '@ttlmhss/shared';
import { Award } from 'lucide-react';
import { ErrorState, LoadingState } from '../../../components/ui';
import { useResource } from '../../../lib/use-resource';
import { AdminLayout } from '../AdminLayout';
import { CategoryManager } from '../CategoryManager';
import { categories } from '../api';

export function AchievementCategoriesPage() {
  const list = useResource('achievement-categories', (signal) =>
    categories.list('achievement', signal),
  );
  return (
    <AdminLayout
      page="achievements"
      description="Categories used when recording a student's achievements. Only administrators and class teachers record achievements."
    >
      {list.status === 'loading' && <LoadingState />}
      {list.status === 'error' && <ErrorState message={list.error} onRetry={list.reload} />}
      {list.status === 'ready' && (
        <CategoryManager
          kind="achievement"
          title="Achievement categories"
          description="For example Academic, Sports or Cultural."
          icon={Award}
          emptyText="Add the kinds of achievement the school records."
          suggested={SUGGESTED_ACHIEVEMENT_CATEGORIES}
          items={list.data}
          onChanged={list.reload}
        />
      )}
    </AdminLayout>
  );
}
