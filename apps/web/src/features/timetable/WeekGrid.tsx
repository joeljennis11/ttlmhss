import { useState, type DragEvent } from 'react';
import type {
  TimetableEntryView,
  TimetableIssue,
  TimetablePeriodView,
  Weekday,
} from '@ttlmhss/shared';
import { Plus } from 'lucide-react';
import { WEEKDAY_LABELS } from '../../lib/format';
import { useMediaQuery } from '../../lib/use-media-query';
import styles from './timetable.module.css';

export interface GridEditing {
  onAdd(day: Weekday, period: TimetablePeriodView): void;
  onOpen(entry: TimetableEntryView): void;
  onMove(entry: TimetableEntryView, day: Weekday, period: TimetablePeriodView): void;
  /** Lessons changed since the last save. */
  unsaved: ReadonlySet<string>;
}

interface GridProps {
  periods: readonly TimetablePeriodView[];
  workingDays: readonly Weekday[];
  entries: readonly TimetableEntryView[];
  /** Second line of a lesson: the teacher (class timetable) or the class (teacher timetable). */
  show: 'teacher' | 'class';
  caption: string;
  today?: Weekday | null;
  issues?: readonly TimetableIssue[];
  editing?: GridEditing | null;
}

export const periodTime = (p: TimetablePeriodView) => `${p.startTime}–${p.endTime}`;
export const slotLabel = (day: Weekday, p: TimetablePeriodView) =>
  `${WEEKDAY_LABELS[day].long}, ${p.label}`;
const canHoldLesson = (p: TimetablePeriodView) => p.kind === 'LESSON' && p.status === 'ACTIVE';

function useLessonAt(entries: readonly TimetableEntryView[]) {
  const map = new Map(entries.map((e) => [`${e.day}|${e.periodId}`, e]));
  return (day: Weekday, periodId: string) => map.get(`${day}|${periodId}`) ?? null;
}

/**
 * The week timetable. Wide screens: a days × periods grid (breaks shaded, empty periods "Free").
 * Phones: one day at a time as a list, so nothing has to be shrunk to be readable.
 * With `editing`, lessons open for editing, free periods offer "Add" and — with a mouse — a lesson
 * can be dragged to another period; every change is validated by the server before it is shown.
 */
export function WeekGrid(props: GridProps) {
  const phone = useMediaQuery('(max-width: 767px)');
  return phone ? <DayList {...props} /> : <Grid {...props} />;
}

function LessonCard({
  entry,
  show,
  flagged,
  unsaved,
}: {
  entry: TimetableEntryView;
  show: GridProps['show'];
  flagged: boolean;
  unsaved: boolean;
}) {
  return (
    <>
      <span className={styles.subject}>{entry.subjectName}</span>
      <span className={styles.secondary}>
        {show === 'teacher' ? entry.teacherName : `${entry.className} ${entry.sectionName}`}
      </span>
      {(flagged || unsaved) && (
        <span className={styles.flags}>
          {unsaved && <span className={styles.unsavedFlag}>Unsaved</span>}
          {flagged && <span className={styles.issueFlag}>Needs attention</span>}
        </span>
      )}
    </>
  );
}

function Grid({ periods, workingDays, entries, show, caption, today, issues, editing }: GridProps) {
  const lessonAt = useLessonAt(entries);
  const flagged = new Set((issues ?? []).map((i) => i.entryId));
  const [dragging, setDragging] = useState<TimetableEntryView | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const dropProps = (day: Weekday, p: TimetablePeriodView) => {
    if (!editing || !dragging || !canHoldLesson(p)) return {};
    const key = `${day}|${p.id}`;
    return {
      onDragOver: (e: DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (over !== key) setOver(key);
      },
      onDragLeave: () => setOver((current) => (current === key ? null : current)),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        const entry = dragging;
        setDragging(null);
        setOver(null);
        if (entry && (entry.day !== day || entry.periodId !== p.id)) editing.onMove(entry, day, p);
      },
    };
  };

  return (
    <div className={styles.gridScroll} role="region" aria-label={caption} tabIndex={0}>
      <table className={styles.grid}>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.corner}>
              Day
            </th>
            {periods.map((p) => (
              <th
                key={p.id}
                scope="col"
                className={p.kind === 'BREAK' ? styles.breakHead : styles.periodHead}
              >
                <span className={styles.periodLabel}>{p.label}</span>
                <span className={styles.periodTime}>{periodTime(p)}</span>
                {p.status !== 'ACTIVE' && <span className={styles.issueFlag}>Inactive</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {workingDays.map((day) => (
            <tr key={day} data-today={day === today ? '' : undefined}>
              <th scope="row" className={styles.dayHead}>
                {WEEKDAY_LABELS[day].long}
                {day === today && <span className={styles.todayFlag}>Today</span>}
              </th>
              {periods.map((p) => {
                if (p.kind === 'BREAK') {
                  return (
                    <td key={p.id} className={styles.breakCell}>
                      <span className="visually-hidden">{p.label}</span>
                    </td>
                  );
                }
                const entry = lessonAt(day, p.id);
                const key = `${day}|${p.id}`;
                const cellClass = [styles.cell, over === key ? styles.dropTarget : '']
                  .join(' ')
                  .trim();
                if (!entry) {
                  return (
                    <td key={p.id} className={cellClass} {...dropProps(day, p)}>
                      {editing && canHoldLesson(p) ? (
                        <button
                          type="button"
                          className={styles.freeButton}
                          onClick={() => editing.onAdd(day, p)}
                        >
                          <Plus size={14} aria-hidden="true" />
                          <span aria-hidden="true">Free</span>
                          <span className="visually-hidden">
                            Free — add a lesson on {slotLabel(day, p)}
                          </span>
                        </button>
                      ) : (
                        <span className={styles.free}>Free</span>
                      )}
                    </td>
                  );
                }
                const card = (
                  <LessonCard
                    entry={entry}
                    show={show}
                    flagged={flagged.has(entry.id)}
                    unsaved={editing?.unsaved.has(entry.id) ?? false}
                  />
                );
                return (
                  <td key={p.id} className={cellClass} {...dropProps(day, p)}>
                    {editing ? (
                      <button
                        type="button"
                        className={`${styles.lesson} ${styles.lessonButton}`}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', entry.id);
                          setDragging(entry);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                        onClick={() => editing.onOpen(entry)}
                        aria-label={`${entry.subjectName}, ${entry.teacherName}, ${slotLabel(day, p)}. Edit, move or remove`}
                      >
                        {card}
                      </button>
                    ) : (
                      <div className={styles.lesson}>{card}</div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DayList({
  periods,
  workingDays,
  entries,
  show,
  caption,
  today,
  issues,
  editing,
}: GridProps) {
  const lessonAt = useLessonAt(entries);
  const flagged = new Set((issues ?? []).map((i) => i.entryId));
  const [chosen, setChosen] = useState<Weekday | null>(null);
  const day =
    (chosen && workingDays.includes(chosen) ? chosen : null) ??
    (today && workingDays.includes(today) ? today : null) ??
    workingDays[0] ??
    null;
  if (!day) return null;

  return (
    <div className={styles.dayList}>
      <div role="tablist" aria-label={`${caption}: day`} className={styles.dayTabs}>
        {workingDays.map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={d === day}
            className={styles.dayTab}
            onClick={() => setChosen(d)}
          >
            {WEEKDAY_LABELS[d].short}
            <span className="visually-hidden"> {WEEKDAY_LABELS[d].long}</span>
          </button>
        ))}
      </div>
      <ol className={styles.slots} aria-label={`${caption}, ${WEEKDAY_LABELS[day].long}`}>
        {periods.map((p) => {
          if (p.kind === 'BREAK') {
            return (
              <li key={p.id} className={styles.breakRow}>
                <span className={styles.slotTime}>{periodTime(p)}</span>
                <span>{p.label}</span>
              </li>
            );
          }
          const entry = lessonAt(day, p.id);
          const head = (
            <span className={styles.slotHead}>
              <span className={styles.periodLabel}>{p.label}</span>
              <span className={styles.slotTime}>{periodTime(p)}</span>
            </span>
          );
          const body = entry ? (
            <span className={styles.slotBody}>
              <LessonCard
                entry={entry}
                show={show}
                flagged={flagged.has(entry.id)}
                unsaved={editing?.unsaved.has(entry.id) ?? false}
              />
            </span>
          ) : (
            <span className={`${styles.slotBody} ${styles.free}`}>Free</span>
          );
          const interactive = editing && (entry || canHoldLesson(p));
          return (
            <li key={p.id} className={styles.slotRow}>
              {interactive ? (
                <button
                  type="button"
                  className={styles.slotButton}
                  onClick={() => (entry ? editing.onOpen(entry) : editing.onAdd(day, p))}
                  aria-label={
                    entry
                      ? `${entry.subjectName}, ${entry.teacherName}, ${slotLabel(day, p)}. Edit, move or remove`
                      : `Free — add a lesson on ${slotLabel(day, p)}`
                  }
                >
                  {head}
                  {body}
                </button>
              ) : (
                <div className={styles.slotStatic}>
                  {head}
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
