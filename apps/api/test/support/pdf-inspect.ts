import { inflateSync } from 'node:zlib';

/**
 * Test helper: a minimal look inside a generated PDF without another dependency — page count,
 * page sizes and the text drawn (PDFKit writes standard-font text as hex strings in TJ arrays
 * inside Flate-compressed content streams).
 */
export function inspectPdf(buffer: Buffer) {
  const raw = buffer.toString('latin1');
  const pages = (raw.match(/\/Type \/Page\b/g) ?? []).length;
  const mediaBoxes = [...raw.matchAll(/\/MediaBox \[([^\]]+)\]/g)].map((m) =>
    m[1]!.trim().split(/\s+/).map(Number),
  );
  const lines: string[] = [];
  let at = 0;
  for (;;) {
    const start = raw.indexOf('stream\n', at);
    if (start < 0) break;
    const end = raw.indexOf('\nendstream', start);
    if (end < 0) break;
    const bytes = buffer.subarray(start + 7, end);
    let content: string;
    try {
      content = inflateSync(bytes).toString('latin1');
    } catch {
      content = '';
    }
    for (const tj of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      const parts = [...tj[1]!.matchAll(/<([0-9a-fA-F]*)>/g)].map((h) =>
        Buffer.from(h[1]!, 'hex').toString('latin1'),
      );
      lines.push(parts.join(''));
    }
    at = end + 10;
  }
  return {
    header: raw.slice(0, 5),
    trailer: raw.trimEnd().endsWith('%%EOF'),
    pages,
    mediaBoxes,
    text: lines.join('\n'),
  };
}
