import { Link, useSearchParams } from 'react-router';
import type { MarkSheetSummary } from '@ttlmhss/shared';
import { NotebookPen } from 'lucide-react';
import { Panel } from '../../../components/layout/Page';
import { Badge, EmptyState, ErrorState, LoadingState, SelectField } from '../../../components/ui';
import { useResource } from '../../../lib/use-resource';
import { marksApi } from '../api';
import { MarksLayout, SheetStatusBadge, StageBadge, examDates } from '../marks-shared';
import styles from '../marks.module.css';

const ROLE_LABEL: Record<MarkSheetSummary['role'], string | null> = {
  ENTRY_TEACHER: null,
  CLASS_TEACHER: 'Your class (view)',
  ADMIN: null,
};

/**
 * Marks (Phase 8B): the exams of a year and the mark sheets this user may open — for a subject
 * teacher only the sheets an administrator authorised them for; for a class teacher also every
 * sheet of their own class (to view). The list comes from the server; nothing is inferred here.
 */
export function MarksHomePage() {
  const [params, setParams] = useSearchParams();
  const yearParam = params.get('year');
  const home = useResource(`marks-home:${yearParam ?? ''}`, (signal) =>
    marksApi.home(yearParam, signal),
  );

  return (
    <MarksLayout
      title="Marks"
      description="Choose an exam, then the subject and class whose marks you enter or check."
    >
      {home.status === 'loading' && <LoadingState />}
      {home.status === 'error' && <ErrorState message={home.error} onRetry={home.reload} />}
      {home.status === 'ready' && (
        <>
          {home.data.years.length > 0 && (
            <div className={styles.toolbar}>
              <SelectField
                label="Academic year"
                value={home.data.academicYearId ?? ''}
                onChange={(e) => setParams({ year: e.target.value }, { replace: true })}
                options={home.data.years.map((y) => ({
                  value: y.id,
                  label: y.status === 'CURRENT' ? `${y.label} (current)` : y.label,
                }))}
              />
            </div>
          )}
          {home.data.exams.length === 0 ? (
            <Panel>
              <EmptyState icon={NotebookPen} title="No mark sheets for you">
                When an administrator opens an exam and authorises you to enter a subject&apos;s
                marks for a class, it appears here.
              </EmptyState>
            </Panel>
          ) : (
            home.data.exams.map((exam) => (
              <Panel
                key={exam.id}
                title={exam.name}
                description={examDates(exam)}
                actions={<StageBadge stage={exam.stage} />}
              >
                <ul className={styles.sheetList} aria-label={`Mark sheets in ${exam.name}`}>
                  {exam.sheets.map((sheet) => {
                    const role = ROLE_LABEL[sheet.role];
                    return (
                      <li
                        key={`${sheet.examSubjectId}:${sheet.sectionId}`}
                        className={styles.sheetItem}
                      >
                        <div>
                          <Link
                            className={styles.sheetLink}
                            to={`/marks/sheet?examSubjectId=${sheet.examSubjectId}&sectionId=${sheet.sectionId}`}
                          >
                            {sheet.subjectName} — {sheet.className} {sheet.sectionName}
                          </Link>
                          <span className={styles.sub}>
                            {sheet.entered} {sheet.entered === 1 ? 'student' : 'students'} entered
                          </span>
                        </div>
                        <div className={styles.statusLine}>
                          {role && <Badge tone="info">{role}</Badge>}
                          <SheetStatusBadge status={sheet.status} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            ))
          )}
        </>
      )}
    </MarksLayout>
  );
}
