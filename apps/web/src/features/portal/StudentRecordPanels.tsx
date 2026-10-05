import { Link } from 'react-router';
import { Award, Smile } from 'lucide-react';
import { Panel } from '../../components/layout/Page';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui';
import { useResource } from '../../lib/use-resource';
import { achievementsApi, behaviourApi } from './api';
import { AchievementCard, BehaviourCard } from './portal-shared';
import styles from './portal.module.css';

/**
 * Phase 9 sections of the staff student profile: the student's behaviour assessments (drafts
 * marked as such) and achievements (active and archived). Scope is enforced by the API.
 */
export function StudentRecordPanels({ studentId }: { studentId: string }) {
  const behaviour = useResource(`profile-behaviour:${studentId}`, (signal) =>
    behaviourApi.forStudent(studentId, signal),
  );
  const achievements = useResource(`profile-achievements:${studentId}`, (signal) =>
    achievementsApi.list({ studentId, status: 'ALL', pageSize: 50 }, signal),
  );
  return (
    <>
      <Panel title="Behaviour" description="Exam-based behaviour assessments.">
        {behaviour.status === 'loading' && <LoadingState />}
        {behaviour.status === 'error' && (
          <ErrorState message={behaviour.error} onRetry={behaviour.reload} />
        )}
        {behaviour.status === 'ready' &&
          (behaviour.data.assessments.length === 0 ? (
            <EmptyState icon={Smile} title="No behaviour recorded yet" />
          ) : (
            <ul className={styles.cards} aria-label="Behaviour assessments">
              {behaviour.data.assessments.map((a) => (
                <li key={`${a.exam.id}:${a.section.sectionId}`}>
                  <BehaviourCard a={a} showStatus />
                </li>
              ))}
            </ul>
          ))}
      </Panel>
      <Panel
        title="Achievements"
        description="Achievements of the current academic year."
        actions={<Link to="/achievements">Manage achievements</Link>}
      >
        {achievements.status === 'loading' && <LoadingState />}
        {achievements.status === 'error' && (
          <ErrorState message={achievements.error} onRetry={achievements.reload} />
        )}
        {achievements.status === 'ready' &&
          (achievements.data.items.length === 0 ? (
            <EmptyState icon={Award} title="No achievements recorded" />
          ) : (
            <ul className={styles.cards} aria-label="Achievements">
              {achievements.data.items.map((a) => (
                <li key={a.id}>
                  <AchievementCard a={a} />
                </li>
              ))}
            </ul>
          ))}
      </Panel>
    </>
  );
}
