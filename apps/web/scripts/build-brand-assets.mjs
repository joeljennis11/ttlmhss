/**
 * Generates the web copies of the OFFICIAL school logo.
 *
 *   pnpm --filter @ttlmhss/web brand:assets
 *
 * Source (never edited): assets/brand/ttlmhss-logo-enhanced.jpg — the enhanced official artwork
 *                        supplied by the school (8000×8000). The first supplied file,
 *                        ttlmhss-logo-official.jpg, is kept unchanged for reference.
 * Output:                apps/web/public/brand/
 *
 * Only resizing / format conversion is applied — no cropping, recolouring, filters or redrawing.
 * Outputs are committed so normal builds need no image tooling; re-run this only if the official
 * file is replaced.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../../../assets/brand/ttlmhss-logo-enhanced.jpg');
const outDir = path.resolve(here, '../public/brand');
const EXPECTED_SHA256 = 'd4b01519e9e15fea8d9184f872270faa0bef70a0d05368287b137ef7107720fe';

const input = readFileSync(source);
const digest = createHash('sha256').update(input).digest('hex');
if (digest !== EXPECTED_SHA256) {
  console.error(
    `The official logo has changed (sha256 ${digest}).\n` +
      'If the school supplied a new official file, update EXPECTED_SHA256 here and in assets/brand/README.md.',
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const outputs = [
  // In-app logo (login, sidebar). 512 px covers 2x displays at the largest on-screen size.
  { file: 'ttlmhss-logo.webp', size: 512, format: (img) => img.webp({ quality: 90 }) },
  // Browser tab icon and home-screen icon.
  { file: 'favicon-32.png', size: 32, format: (img) => img.png() },
  { file: 'apple-touch-icon.png', size: 180, format: (img) => img.png() },
];

for (const { file, size, format } of outputs) {
  const buffer = await format(sharp(input).resize(size, size, { fit: 'inside' })).toBuffer();
  writeFileSync(path.join(outDir, file), buffer);
  console.log(`  ${file.padEnd(22)} ${size}×${size}  ${(buffer.length / 1024).toFixed(1)} KB`);
}
console.log(`[brand] generated from ${path.relative(process.cwd(), source)}`);
