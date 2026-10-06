import {
  ATTENDANCE_STATUS_LABELS,
  MARK_COMPONENT_LABELS,
  type AnnualReportContent,
  type ClassAttendanceReport,
  type ExamReportCard,
  type MarkSheetReport,
  type PerformanceReport,
  type StudentAttendanceReport,
  type StudentExamResultView,
  type AttendanceCounts,
  type StudentBehaviour,
  type AchievementView,
  type ReportSchool,
} from '@ttlmhss/shared';
import { longDate, num, pct, schoolDateTime } from '../report-context.js';
import { ReportPdf, type Column } from './report-pdf.js';

/*
 * PDF renderers: each takes the SAME document object the preview shows and lays it out on A4.
 * They only format values — every number comes from the document (i.e. from the source services).
 */

const NOT_AVAILABLE = 'Not available';
/** The configured principal's name above the role — never an invented name (D-107). */
const principal = (school: ReportSchool) =>
  school.principalName
    ? `${school.principalName}\nPrincipal / Head of Institution`
    : 'Principal / Head of Institution';
const resultText = (r: 'PASS' | 'FAIL' | null) =>
  r === 'PASS' ? 'Pass' : r === 'FAIL' ? 'Fail' : '';
const sectionName = (s: { className: string; sectionName: string } | null) =>
  s ? `${s.className} ${s.sectionName}` : NOT_AVAILABLE;

function base(
  school: ReportSchool,
  withLogo: boolean,
  generatedAt: string,
  title: string,
  subtitle: string,
  landscape = false,
) {
  return new ReportPdf({
    school,
    withLogo,
    title,
    subtitle,
    generatedAt,
    landscape,
    footerNote: `${school.shortName} · Generated ${schoolDateTime(generatedAt)}`,
  });
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function subjectTable(pdf: ReportPdf, result: StudentExamResultView) {
  const anyConverted = result.subjects.some((s) => s.normalizedMax !== null);
  const columns: Column[] = [
    { header: 'Subject', width: 3 },
    { header: 'Marks', width: 3 },
    { header: 'Max', width: 1.1, align: 'right' },
    { header: 'Obtained', width: 1.4, align: 'right' },
    ...(anyConverted ? [{ header: 'Converted', width: 1.6, align: 'right' as const }] : []),
    { header: '%', width: 1.1, align: 'right' },
    { header: 'Grade', width: 1.1, align: 'center' },
    { header: 'Result', width: 1.2, align: 'center' },
  ];
  const rows = result.subjects.map((s) => {
    const name = s.countsInResult ? s.subjectName : `${s.subjectName} (not counted)`;
    if (!s.available) {
      return [
        name,
        'Not yet available',
        num(s.totalMax),
        '',
        ...(anyConverted ? [''] : []),
        '',
        '',
        '',
      ];
    }
    const components =
      s.components && s.components.length > 1
        ? s.components.map((c) => `${c.label} ${num(c.obtained)}/${num(c.max)}`).join(', ')
        : '';
    return [
      name,
      components,
      num(s.totalMax),
      num(s.obtained),
      ...(anyConverted
        ? [s.normalizedMax !== null ? `${num(s.normalized)} / ${num(s.normalizedMax)}` : '']
        : []),
      num(s.percent),
      s.grade ?? '',
      resultText(s.result),
    ];
  });
  pdf.table(columns, rows);
}

function summaryFacts(result: StudentExamResultView): [string, string][] {
  const s = result.summary;
  if (!s) {
    return [
      ['Result', 'Incomplete'],
      ['Subjects published', `${result.availableCount} of ${result.requiredCount}`],
    ];
  }
  return [
    ['Total', `${num(s.total)} / ${num(s.max)}`],
    ['Percentage', pct(s.percentage)],
    ['Result', resultText(s.result)],
    [
      `Rank (${s.rankScope === 'CLASS' ? 'class' : 'section'})`,
      s.rank !== null ? `${s.rank} of ${s.rankedOf}` : NOT_AVAILABLE,
    ],
  ];
}

function countsFacts(counts: AttendanceCounts): [string, string][] {
  return [
    ['Present (P)', String(counts.P)],
    ['Absent (A)', String(counts.A)],
    ['Leave (L)', String(counts.L)],
    ['Excused (C)', String(counts.C)],
    ['Not marked', String(counts.notMarked)],
    ['Attendance', counts.percentage === null ? NOT_AVAILABLE : pct(counts.percentage)],
  ];
}
const ATTENDANCE_RULE =
  'Attendance % = P ÷ (P + A) × 100. Leave (L), excused (C) and not-marked lessons are not counted; non-working days of the academic calendar have no lessons.';

function behaviourTable(pdf: ReportPdf, assessments: readonly StudentBehaviour[]) {
  if (assessments.length === 0) {
    pdf.paragraph('Not yet assessed.', { muted: true });
    return;
  }
  for (const a of assessments) {
    pdf.table(
      [
        { header: `${a.exam.name} — category`, width: 3 },
        { header: 'Rating', width: 1, align: 'center' },
        { header: 'Meaning', width: 2 },
      ],
      a.ratings.map((r) => [r.categoryName, `${r.rating}/5`, r.label ?? '']),
    );
    if (a.remark) pdf.paragraph(`Remark: ${a.remark}`, { muted: true });
  }
}

function achievementsTable(pdf: ReportPdf, items: readonly AchievementView[]) {
  if (items.length === 0) {
    pdf.paragraph('No records.', { muted: true });
    return;
  }
  pdf.table(
    [
      { header: 'Date', width: 1.3 },
      { header: 'Category', width: 1.6 },
      { header: 'Title', width: 2.4 },
      { header: 'Description', width: 3.5 },
    ],
    items.map((a) => [longDate(a.achievedOn), a.category.name, a.title, a.description ?? '']),
  );
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export function examReportCardPdf(d: ExamReportCard, withLogo: boolean) {
  const r = d.result;
  const pdf = base(
    d.school,
    withLogo,
    d.generatedAt,
    'Exam Report Card',
    `${r.exam.name} · Academic year ${r.academicYear.label}`,
  );
  pdf.facts([
    ['Student', r.student.fullName],
    ['Admission number', r.student.admissionNumber],
    ['Class and section', sectionName(r.section)],
    ['Roll number', r.student.rollNumber ?? NOT_AVAILABLE],
    ['Exam', r.exam.name],
    [
      'Exam dates',
      r.exam.startDate
        ? `${longDate(r.exam.startDate)}${r.exam.endDate ? ` – ${longDate(r.exam.endDate)}` : ''}`
        : NOT_AVAILABLE,
    ],
  ]);
  pdf.heading('Subjects');
  subjectTable(pdf, r);
  pdf.heading('Result');
  pdf.facts(summaryFacts(r), 4);
  pdf.signatures(['Class Teacher', principal(d.school)]);
  return pdf.finish();
}

export function markSheetPdf(d: MarkSheetReport, withLogo: boolean) {
  const s = d.sheet;
  const pdf = base(
    d.school,
    withLogo,
    d.generatedAt,
    'Mark Sheet',
    `${s.exam.name} · ${s.section.className} ${s.section.sectionName} · ${s.subject.name}`,
    true,
  );
  const status =
    s.status === 'SUBMITTED'
      ? `Submitted${s.submitted ? ` ${schoolDateTime(s.submitted.at)}${s.submitted.by ? ` by ${s.submitted.by}` : ''}` : ''}`
      : s.status === 'UNLOCKED'
        ? 'Unlocked for correction'
        : 'Draft';
  pdf.facts(
    [
      ['Academic year', s.academicYear.label],
      ['Exam', s.exam.name],
      ['Class and section', `${s.section.className} ${s.section.sectionName}`],
      ['Subject', s.subject.name],
      ['Mark-entry teacher', s.teacher?.fullName ?? 'Not assigned'],
      ['Status', status],
      [
        'Maximum',
        s.structure.components.length > 1
          ? `${s.structure.components.map((c) => `${c.label} ${num(c.max)}`).join(' + ')} = ${num(s.structure.totalMax)}`
          : num(s.structure.totalMax),
      ],
      ['Pass marks', num(s.structure.passMarks)],
      [
        'Converted to',
        s.structure.normalizedMax !== null ? num(s.structure.normalizedMax) : 'Not converted',
      ],
    ],
    3,
  );
  if (s.status !== 'SUBMITTED') {
    pdf.box(
      'These marks are not final: the sheet has not been submitted (or was unlocked for correction). They are not visible to students.',
      'Not final',
    );
  }
  const comps = s.structure.components;
  const converted = s.structure.normalizedMax !== null;
  pdf.table(
    [
      { header: 'Roll', width: 0.8 },
      { header: 'Adm. no.', width: 1.3 },
      { header: 'Student', width: 3 },
      ...comps.map((c) => ({
        header: `${MARK_COMPONENT_LABELS[c.key]} (${num(c.max)})`,
        width: 1.3,
        align: 'right' as const,
      })),
      { header: `Total (${num(s.structure.totalMax)})`, width: 1.3, align: 'right' },
      ...(converted
        ? [
            {
              header: `Converted (${num(s.structure.normalizedMax)})`,
              width: 1.4,
              align: 'right' as const,
            },
          ]
        : []),
      { header: '%', width: 0.9, align: 'right' },
      { header: 'Grade', width: 0.9, align: 'center' },
      { header: 'Result', width: 0.9, align: 'center' },
    ],
    s.rows.map((r) => [
      r.rollNumber ?? '',
      r.admissionNumber,
      r.onRoll ? r.fullName : `${r.fullName} (left the class)`,
      ...comps.map((c) => {
        const v = r.marks[c.key];
        return v === null ? '-' : num(v);
      }),
      r.total === null ? '-' : num(r.total),
      ...(converted ? [r.normalized === null ? '-' : num(r.normalized)] : []),
      r.percent === null ? '' : num(r.percent),
      r.grade ?? '',
      resultText(r.result),
    ]),
  );
  pdf.paragraph(
    `"-" = not entered; 0 = a real zero. ${s.counts.entered} of ${s.counts.total} students entered.`,
    { muted: true, size: 8.5 },
  );
  pdf.signatures(['Subject Teacher', 'Class Teacher', principal(d.school)]);
  return pdf.finish();
}

export function studentAttendancePdf(d: StudentAttendanceReport, withLogo: boolean) {
  const a = d.attendance;
  const pdf = base(
    d.school,
    withLogo,
    d.generatedAt,
    'Attendance Report',
    `${d.student.fullName} · ${longDate(a.from)} – ${longDate(a.to)}`,
  );
  pdf.facts([
    ['Student', d.student.fullName],
    ['Admission number', d.student.admissionNumber],
    ['Class and section', sectionName(d.section)],
    ['Roll number', d.student.rollNumber ?? NOT_AVAILABLE],
    ['Academic year', d.academicYear.label],
    ['Period', `${longDate(a.from)} – ${longDate(a.to)}`],
  ]);
  pdf.heading('Summary');
  pdf.facts(countsFacts(a.counts), 6);
  pdf.paragraph(ATTENDANCE_RULE, { muted: true, size: 8.5 });
  pdf.heading('Lesson by lesson');
  const periods = new Map(a.periods.map((p) => [p.id, p.label]));
  const rows: string[][] = [];
  for (const day of [...a.days].reverse()) {
    for (const [periodId, cell] of Object.entries(day.cells)) {
      rows.push([
        longDate(day.date),
        periods.get(periodId) ?? '',
        cell.subjectName,
        cell.teacherName,
        `${cell.status === '-' ? '-' : cell.status} · ${ATTENDANCE_STATUS_LABELS[cell.status]}`,
      ]);
    }
  }
  if (rows.length === 0) pdf.paragraph('No records: no lessons in this period.', { muted: true });
  else
    pdf.table(
      [
        { header: 'Date', width: 1.4 },
        { header: 'Period', width: 1.1 },
        { header: 'Subject', width: 2 },
        { header: 'Teacher', width: 2 },
        { header: 'Status', width: 1.5 },
      ],
      rows,
    );
  return pdf.finish();
}

export function classAttendancePdf(d: ClassAttendanceReport, withLogo: boolean) {
  const s = d.summary;
  const pdf = base(
    d.school,
    withLogo,
    d.generatedAt,
    'Class Attendance Report',
    `${s.section.className} ${s.section.sectionName} · ${longDate(s.from)} – ${longDate(s.to)}`,
  );
  pdf.facts([
    ['Academic year', d.academicYear.label],
    ['Class and section', `${s.section.className} ${s.section.sectionName}`],
    ['Period', `${longDate(s.from)} – ${longDate(s.to)}`],
    ['Lessons held', String(d.lessonCount)],
    ['Students', String(s.students.length)],
    ['Class attendance', s.counts.percentage === null ? NOT_AVAILABLE : pct(s.counts.percentage)],
  ]);
  pdf.paragraph(ATTENDANCE_RULE, { muted: true, size: 8.5 });
  if (s.students.length === 0) pdf.paragraph('No records.', { muted: true });
  else
    pdf.table(
      [
        { header: 'Roll', width: 0.8 },
        { header: 'Adm. no.', width: 1.4 },
        { header: 'Student', width: 3.2 },
        { header: 'P', width: 0.7, align: 'right' },
        { header: 'A', width: 0.7, align: 'right' },
        { header: 'L', width: 0.7, align: 'right' },
        { header: 'C', width: 0.7, align: 'right' },
        { header: 'Not marked', width: 1.1, align: 'right' },
        { header: 'Attendance', width: 1.3, align: 'right' },
      ],
      s.students.map((st) => [
        st.rollNumber ?? '',
        st.admissionNumber,
        st.fullName,
        String(st.counts.P),
        String(st.counts.A),
        String(st.counts.L),
        String(st.counts.C),
        String(st.counts.notMarked),
        st.counts.percentage === null ? NOT_AVAILABLE : pct(st.counts.percentage),
      ]),
    );
  pdf.signatures(['Class Teacher', principal(d.school)]);
  return pdf.finish();
}

export function performancePdf(d: PerformanceReport, withLogo: boolean) {
  const pdf = base(
    d.school,
    withLogo,
    d.generatedAt,
    'Student Performance Report',
    `${d.student.fullName} · Academic year ${d.academicYear.label}`,
  );
  pdf.facts([
    ['Student', d.student.fullName],
    ['Admission number', d.student.admissionNumber],
    ['Class and section', sectionName(d.section)],
    ['Roll number', d.student.rollNumber ?? NOT_AVAILABLE],
    ['Academic year', d.academicYear.label],
    ['Exams with results', String(d.exams.length)],
  ]);
  pdf.heading('Examinations');
  if (d.exams.length === 0) pdf.paragraph('No exam results are available yet.', { muted: true });
  for (const r of d.exams) {
    pdf.heading(r.exam.name);
    subjectTable(pdf, r);
    pdf.facts(summaryFacts(r), 4);
  }
  pdf.heading('Attendance');
  if (!d.attendance) pdf.paragraph(NOT_AVAILABLE, { muted: true });
  else {
    pdf.paragraph(`${longDate(d.attendance.from)} – ${longDate(d.attendance.to)}`, { muted: true });
    pdf.facts(countsFacts(d.attendance.counts), 6);
  }
  pdf.heading('Behaviour');
  behaviourTable(pdf, d.behaviour);
  pdf.heading('Achievements');
  achievementsTable(pdf, d.achievements);
  return pdf.finish();
}

export function annualReportPdf(
  c: AnnualReportContent,
  meta: { status: 'NONE' | 'DRAFT' | 'FINALIZED' | 'PUBLISHED'; generatedAt: string },
  withLogo: boolean,
) {
  const draft = meta.status === 'NONE' || meta.status === 'DRAFT';
  const pdf = base(
    c.school,
    withLogo,
    meta.generatedAt,
    'Annual Report',
    `Academic year ${c.academicYear.label}${draft ? ' · DRAFT — not an official report' : ''}`,
  );
  pdf.heading('A. Student information');
  pdf.facts([
    ['Student', c.student.fullName],
    ['Admission number', c.student.admissionNumber],
    ['Class and section', sectionName(c.section)],
    ['Roll number', c.student.rollNumber ?? NOT_AVAILABLE],
    [
      'Academic year',
      `${c.academicYear.label} (${longDate(c.academicYear.startDate)} – ${longDate(c.academicYear.endDate)})`,
    ],
  ]);

  pdf.heading('B. Examination performance');
  if (c.exams.length === 0) pdf.paragraph('No exams with results in this year.', { muted: true });
  else
    pdf.table(
      [
        { header: 'Exam', width: 2.6 },
        { header: 'Weightage', width: 1.2, align: 'right' },
        { header: 'Total', width: 1.6, align: 'right' },
        { header: 'Percentage', width: 1.3, align: 'right' },
        { header: 'Result', width: 1.1, align: 'center' },
        { header: 'Rank', width: 1.3, align: 'center' },
      ],
      c.exams.map((e) => {
        const s = e.result?.summary ?? null;
        return [
          e.exam.name,
          `${num(e.weightagePercent)}%`,
          s ? `${num(s.total)} / ${num(s.max)}` : e.result ? 'Incomplete' : NOT_AVAILABLE,
          s ? pct(s.percentage) : '',
          s ? resultText(s.result) : '',
          s && s.rank !== null ? `${s.rank} of ${s.rankedOf}` : '',
        ];
      }),
    );

  // Subject-wise: each subject's percentage and grade in every exam (as published, Phase 8B).
  const withResults = c.exams.filter((e) => e.result);
  if (withResults.length > 0) {
    pdf.heading('Subject-wise performance (percentage · grade)');
    const subjects = new Map<string, string>();
    for (const e of withResults)
      for (const s of e.result!.subjects) subjects.set(s.subjectId, s.subjectName);
    pdf.table(
      [
        { header: 'Subject', width: 2.6 },
        ...withResults.map((e) => ({ header: e.exam.name, width: 1.6, align: 'center' as const })),
      ],
      [...subjects.entries()].map(([id, name]) => [
        name,
        ...withResults.map((e) => {
          const s = e.result!.subjects.find((x) => x.subjectId === id);
          if (!s) return '';
          if (!s.available) return 'Not available';
          return `${num(s.percent)}%${s.grade ? ` · ${s.grade}` : ''}`;
        }),
      ]),
    );
  }

  pdf.heading('C. Attendance');
  pdf.paragraph(`${longDate(c.attendance.from)} – ${longDate(c.attendance.to)}`, { muted: true });
  pdf.facts(countsFacts(c.attendance.counts), 6);
  pdf.paragraph(ATTENDANCE_RULE, { muted: true, size: 8.5 });

  pdf.heading('D. Behaviour');
  behaviourTable(pdf, c.behaviour);

  pdf.heading('E. Achievements');
  achievementsTable(pdf, c.achievements);

  pdf.heading('F. Overall academic performance');
  pdf.table(
    [
      { header: 'Exam', width: 3 },
      { header: 'Percentage', width: 1.4, align: 'right' },
      { header: 'Weightage', width: 1.4, align: 'right' },
      { header: 'Weighted', width: 1.4, align: 'right' },
    ],
    c.annual.contributions.map((x) => [
      x.examName,
      x.percentage === null ? NOT_AVAILABLE : pct(x.percentage),
      `${num(x.weightagePercent)}%`,
      x.weighted === null ? '' : num(x.weighted),
    ]),
  );
  pdf.facts(
    [
      ['Total weightage', `${num(c.annual.weightageTotalPercent)}%`],
      [
        'Annual percentage',
        c.annual.percentage === null ? NOT_AVAILABLE : pct(c.annual.percentage),
      ],
    ],
    2,
  );
  pdf.paragraph(
    'Annual percentage = sum of (exam percentage × exam weightage) ÷ 100, using the weightages configured for this academic year (half-up to two decimals).',
    { muted: true, size: 8.5 },
  );

  pdf.heading('G. Remarks');
  if (c.finalRemark) pdf.box(c.finalRemark, "Class teacher's remark");
  else
    pdf.paragraph(draft ? 'The final remark has not been written yet.' : NOT_AVAILABLE, {
      muted: true,
    });
  if (draft) {
    pdf.box(c.suggestedRemark, 'System suggestion (not a teacher remark — draft only)');
    if (c.problems.length) pdf.box(c.problems.join('\n'), 'Cannot be finalized yet');
  }
  pdf.signatures(['Class Teacher', principal(c.school)]);
  return pdf.finish();
}
