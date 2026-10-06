import ExcelJS from 'exceljs';
import {
  ATTENDANCE_STATUS_LABELS,
  type AttendanceDetailRow,
  type ClassAttendanceReport,
} from '@ttlmhss/shared';
import { schoolDateTime } from '../report-context.js';

const FOREST = 'FF003300';

/**
 * A real .xlsx workbook (Office Open XML via ExcelJS) of a class's attendance over a range:
 * sheet "Lessons" — one row per date + period + student (the same cells the report counts);
 * sheet "Summary" — the class totals per student (classSummary, P ÷ (P + A)).
 */
export async function classAttendanceXlsx(
  report: ClassAttendanceReport,
  rows: readonly AttendanceDetailRow[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = report.school.shortName;
  wb.created = new Date(report.generatedAt);
  const s = report.summary;
  const className = `${s.section.className} ${s.section.sectionName}`;

  const header = (ws: ExcelJS.Worksheet) => {
    const row = ws.getRow(1);
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FOREST } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };

  const lessons = wb.addWorksheet('Lessons');
  lessons.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Period', key: 'period', width: 12 },
    { header: 'Admission number', key: 'adm', width: 18 },
    { header: 'Roll', key: 'roll', width: 7 },
    { header: 'Student', key: 'name', width: 28 },
    { header: 'Class', key: 'class', width: 14 },
    { header: 'Section', key: 'section', width: 9 },
    { header: 'Subject', key: 'subject', width: 20 },
    { header: 'Teacher', key: 'teacher', width: 24 },
    { header: 'Status', key: 'status', width: 8 },
    { header: 'Meaning', key: 'meaning', width: 14 },
  ];
  for (const r of rows) {
    lessons.addRow({
      date: r.date,
      period: r.periodLabel,
      adm: r.admissionNumber,
      roll: r.rollNumber ?? '',
      name: r.fullName,
      class: s.section.className,
      section: s.section.sectionName,
      subject: r.subjectName,
      teacher: r.teacherName,
      status: r.status,
      meaning: ATTENDANCE_STATUS_LABELS[r.status],
    });
  }
  header(lessons);
  lessons.autoFilter = { from: 'A1', to: 'K1' };

  const summary = wb.addWorksheet('Summary');
  summary.columns = [
    { header: 'Roll', key: 'roll', width: 7 },
    { header: 'Admission number', key: 'adm', width: 18 },
    { header: 'Student', key: 'name', width: 28 },
    { header: 'P', key: 'P', width: 6 },
    { header: 'A', key: 'A', width: 6 },
    { header: 'L', key: 'L', width: 6 },
    { header: 'C', key: 'C', width: 6 },
    { header: 'Not marked', key: 'nm', width: 11 },
    { header: 'Attendance %', key: 'pct', width: 13 },
  ];
  for (const st of s.students) {
    summary.addRow({
      roll: st.rollNumber ?? '',
      adm: st.admissionNumber,
      name: st.fullName,
      P: st.counts.P,
      A: st.counts.A,
      L: st.counts.L,
      C: st.counts.C,
      nm: st.counts.notMarked,
      // A number when measurable; empty (not 0) when there was nothing to measure.
      pct: st.counts.percentage ?? null,
    });
  }
  header(summary);
  summary.addRow([]);
  summary.addRow([`${report.school.fullName} — ${className}, ${s.from} to ${s.to}`]);
  summary.addRow([
    `Attendance % = P ÷ (P + A) × 100; L, C and not-marked lessons are not counted. Generated ${schoolDateTime(report.generatedAt)}.`,
  ]);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
