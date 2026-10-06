import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import type { ReportSchool } from '@ttlmhss/shared';

/*
 * A4 report layout on top of PDFKit (server-side; no browser involved). One small helper used by
 * every report: official header (logo + configured school identity), facts grid, section headings,
 * tables that wrap text and repeat their header row on every page, signature lines, and a footer
 * with "Page x of y" on every page. Content never enters the footer band: every block measures
 * itself first and starts a new page when it would not fit.
 */

const FOREST = '#003300';
const INK = '#18211b';
const MUTED = '#556259';
const LINE = '#c6d0c5';
const LEAF = '#eef3ec';

const MARGIN = 40;
const FOOTER = 34; // reserved band at the bottom of every page

/** The official logo, resized from the master (assets/brand) by the brand script — never redrawn. */
const LOGO_FILE = fileURLToPath(
  new URL('../../../../assets/ttlmhss-logo-print.jpg', import.meta.url),
);
let logoCache: Buffer | null | undefined;
function officialLogo(): Buffer | null {
  if (logoCache === undefined) logoCache = existsSync(LOGO_FILE) ? readFileSync(LOGO_FILE) : null;
  return logoCache;
}

/** Standard PDF fonts cover Latin text; characters they cannot draw are replaced, never dropped silently. */
const ALLOWED_EXTRA = new Set([0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026]);
const printable = (value: string) =>
  Array.from(value, (ch) => {
    const code = ch.codePointAt(0)!;
    if (code === 10) return ch;
    if (code === 9 || code === 0xa0) return ' ';
    if ((code >= 0x20 && code <= 0x7e) || (code > 0xa0 && code <= 0xff) || ALLOWED_EXTRA.has(code))
      return ch;
    return '?';
  }).join('');

export interface Column {
  header: string;
  /** Relative width (columns share the page width in proportion). */
  width: number;
  align?: 'left' | 'right' | 'center';
}

export interface ReportPdfOptions {
  school: ReportSchool;
  /** Show the logo (the school has an official logo configured). */
  withLogo: boolean;
  title: string;
  subtitle?: string;
  generatedAt: string;
  landscape?: boolean;
  /** Text in the footer's left side (e.g. "Generated 5 Oct 2026, 10:42"). */
  footerNote: string;
}

export class ReportPdf {
  readonly doc: PDFKit.PDFDocument;
  private readonly chunks: Buffer[] = [];
  private readonly done: Promise<Buffer>;

  constructor(private readonly o: ReportPdfOptions) {
    this.doc = new PDFDocument({
      size: 'A4',
      layout: o.landscape ? 'landscape' : 'portrait',
      margins: { top: MARGIN, bottom: MARGIN + FOOTER, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: {
        Title: printable(`${o.title}${o.subtitle ? ` — ${o.subtitle}` : ''}`),
        Author: printable(o.school.fullName),
        Creator: printable(`${o.school.shortName} School Management System`),
      },
    });
    this.doc.on('data', (c: Buffer) => this.chunks.push(c));
    this.done = new Promise((resolve, reject) => {
      this.doc.on('end', () => resolve(Buffer.concat(this.chunks)));
      this.doc.on('error', reject);
    });
    this.doc.on('pageAdded', () => this.runningHeader());
    this.officialHeader();
  }

  // ---- geometry ---------------------------------------------------------------------------------

  get width() {
    return this.doc.page.width - MARGIN * 2;
  }
  private get bottom() {
    return this.doc.page.height - MARGIN - FOOTER;
  }
  private ensure(height: number) {
    if (this.doc.y + height > this.bottom) this.doc.addPage();
  }

  // ---- headers ----------------------------------------------------------------------------------

  private officialHeader() {
    const { doc, o } = this;
    const top = doc.y;
    const logo = o.withLogo ? officialLogo() : null;
    const logoSize = 58;
    const textX = MARGIN + (logo ? logoSize + 14 : 0);
    if (logo) doc.image(logo, MARGIN, top, { width: logoSize, height: logoSize });
    const textWidth = this.width - (textX - MARGIN);
    doc.font('Helvetica-Bold').fontSize(15).fillColor(FOREST);
    doc.text(printable(o.school.fullName), textX, top + 2, { width: textWidth });
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
    const contact = [o.school.phone, o.school.email, o.school.website]
      .filter(Boolean)
      .join('  ·  ');
    for (const line of [o.school.address, contact, o.school.motto]) {
      if (line) doc.text(printable(line), textX, doc.y + 1, { width: textWidth });
    }
    const y = Math.max(doc.y, top + (logo ? logoSize : 0)) + 8;
    doc
      .moveTo(MARGIN, y)
      .lineTo(MARGIN + this.width, y)
      .lineWidth(1.5)
      .strokeColor(FOREST)
      .stroke();
    doc.y = y + 10;
    doc.x = MARGIN;
    doc.font('Helvetica-Bold').fontSize(14).fillColor(INK);
    doc.text(printable(o.title), MARGIN, doc.y, { width: this.width });
    if (o.subtitle) {
      doc.font('Helvetica').fontSize(10).fillColor(MUTED);
      doc.text(printable(o.subtitle), MARGIN, doc.y + 2, { width: this.width });
    }
    doc.y += 10;
  }

  /** Pages after the first: a compact line so every page says which report it belongs to. */
  private runningHeader() {
    const { doc, o } = this;
    const y = MARGIN;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(FOREST);
    doc.text(printable(o.school.shortName), MARGIN, y, { width: this.width / 3, lineBreak: false });
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    doc.text(
      printable(`${o.title}${o.subtitle ? ` — ${o.subtitle}` : ''}`),
      MARGIN + this.width / 3,
      y,
      {
        width: (this.width * 2) / 3,
        align: 'right',
        lineBreak: false,
      },
    );
    doc
      .moveTo(MARGIN, y + 14)
      .lineTo(MARGIN + this.width, y + 14)
      .lineWidth(0.75)
      .strokeColor(LINE)
      .stroke();
    doc.x = MARGIN;
    doc.y = y + 24;
  }

  // ---- blocks -----------------------------------------------------------------------------------

  /** A heading for a section of the report (kept with at least a few lines of what follows). */
  heading(text: string) {
    const { doc } = this;
    this.ensure(60);
    doc.y += 6;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(FOREST);
    doc.text(printable(text), MARGIN, doc.y, { width: this.width });
    doc.y += 4;
  }

  /** Label/value pairs in a grid (student details, totals). */
  facts(pairs: readonly [string, string][], columns = 3) {
    const { doc } = this;
    const colWidth = this.width / columns;
    for (let i = 0; i < pairs.length; i += columns) {
      const row = pairs.slice(i, i + columns);
      doc.font('Helvetica-Bold').fontSize(10);
      const height =
        Math.max(
          ...row.map(([, v]) => doc.heightOfString(printable(v || '—'), { width: colWidth - 8 })),
        ) + 13;
      this.ensure(height + 4);
      const y = doc.y;
      row.forEach(([label, value], j) => {
        const x = MARGIN + j * colWidth;
        doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
        doc.text(printable(label.toUpperCase()), x, y, { width: colWidth - 8, lineBreak: false });
        doc.font('Helvetica-Bold').fontSize(10).fillColor(INK);
        doc.text(printable(value || '—'), x, y + 10, { width: colWidth - 8 });
      });
      doc.y = y + height + 4;
    }
    doc.x = MARGIN;
  }

  paragraph(text: string, opts: { muted?: boolean; size?: number; italic?: boolean } = {}) {
    const { doc } = this;
    const font = opts.italic ? 'Helvetica-Oblique' : 'Helvetica';
    doc.font(font).fontSize(opts.size ?? 9.5);
    const height = doc.heightOfString(printable(text), { width: this.width });
    this.ensure(Math.min(height, 120) + 4);
    doc.fillColor(opts.muted ? MUTED : INK);
    doc.text(printable(text), MARGIN, doc.y, { width: this.width });
    doc.y += 4;
  }

  /** A boxed note (e.g. a remark or "Incomplete — not an official result"). */
  box(text: string, label?: string) {
    const { doc } = this;
    doc.font('Helvetica').fontSize(9.5);
    const inner = this.width - 16;
    const height = doc.heightOfString(printable(text), { width: inner }) + (label ? 14 : 0) + 14;
    this.ensure(height + 6);
    const y = doc.y;
    doc.rect(MARGIN, y, this.width, height).fillColor(LEAF).fill();
    doc.rect(MARGIN, y, 3, height).fillColor(FOREST).fill();
    let ty = y + 7;
    if (label) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
      doc.text(printable(label.toUpperCase()), MARGIN + 10, ty, { width: inner, lineBreak: false });
      ty += 13;
    }
    doc.font('Helvetica').fontSize(9.5).fillColor(INK);
    doc.text(printable(text), MARGIN + 10, ty, { width: inner });
    doc.y = y + height + 6;
    doc.x = MARGIN;
  }

  /**
   * A table: the header row repeats on every page, rows wrap their text and never split across a
   * page break, numbers can be right-aligned.
   */
  table(
    columns: readonly Column[],
    rows: readonly (readonly string[])[],
    opts: { size?: number } = {},
  ) {
    const { doc } = this;
    const size = opts.size ?? 8.5;
    const total = columns.reduce((s, c) => s + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * this.width);
    const pad = 4;
    const measure = (cells: readonly string[], bold: boolean) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
      return (
        Math.max(
          ...cells.map((c, i) =>
            doc.heightOfString(printable(c || ''), { width: widths[i]! - pad * 2 }),
          ),
        ) +
        pad * 2
      );
    };
    const drawRow = (cells: readonly string[], header: boolean, shade: boolean) => {
      const height = measure(cells, header);
      const y = doc.y;
      if (header) doc.rect(MARGIN, y, this.width, height).fillColor(FOREST).fill();
      else if (shade) doc.rect(MARGIN, y, this.width, height).fillColor('#f6f8f5').fill();
      let x = MARGIN;
      cells.forEach((cell, i) => {
        doc
          .font(header ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(size)
          .fillColor(header ? '#ffffff' : INK);
        doc.text(printable(cell || ''), x + pad, y + pad, {
          width: widths[i]! - pad * 2,
          align: columns[i]!.align ?? 'left',
        });
        x += widths[i]!;
      });
      doc
        .moveTo(MARGIN, y + height)
        .lineTo(MARGIN + this.width, y + height)
        .lineWidth(0.5)
        .strokeColor(LINE)
        .stroke();
      doc.y = y + height;
    };
    const headerCells = columns.map((c) => c.header);
    const headerHeight = measure(headerCells, true);
    this.ensure(headerHeight + (rows[0] ? measure(rows[0], false) : 0));
    drawRow(headerCells, true, false);
    rows.forEach((row, index) => {
      const height = measure(row, false);
      if (doc.y + height > this.bottom) {
        doc.addPage();
        drawRow(headerCells, true, false);
      }
      drawRow(row, false, index % 2 === 1);
    });
    doc.x = MARGIN;
    doc.y += 8;
  }

  /** Signature lines with role labels only — no names or images are invented (D-107). */
  signatures(labels: readonly string[]) {
    const { doc } = this;
    this.ensure(70);
    doc.y += 36;
    const width = this.width / labels.length;
    const y = doc.y;
    labels.forEach((label, i) => {
      const x = MARGIN + i * width + 10;
      doc
        .moveTo(x, y)
        .lineTo(x + width - 30, y)
        .lineWidth(0.75)
        .strokeColor(INK)
        .stroke();
      doc.font('Helvetica').fontSize(9).fillColor(MUTED);
      doc.text(printable(label), x, y + 4, { width: width - 30, align: 'center' });
    });
    doc.x = MARGIN;
    doc.y = y + 24;
  }

  /** Writes "Page x of y" and the footer note on every page and returns the finished PDF. */
  async finish(): Promise<Buffer> {
    const { doc } = this;
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // writing inside the footer band must not add pages
      const y = doc.page.height - MARGIN - 12;
      doc
        .moveTo(MARGIN, y - 6)
        .lineTo(doc.page.width - MARGIN, y - 6)
        .lineWidth(0.5)
        .strokeColor(LINE)
        .stroke();
      doc.font('Helvetica').fontSize(8).fillColor(MUTED);
      doc.text(printable(this.o.footerNote), MARGIN, y, {
        width: this.width * 0.7,
        lineBreak: false,
      });
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, MARGIN + this.width * 0.7, y, {
        width: this.width * 0.3,
        align: 'right',
        lineBreak: false,
      });
      doc.page.margins.bottom = bottomMargin;
    }
    doc.end();
    return this.done;
  }
}
