import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { readPages } from './read-pages.mjs';

function samplePdf() {
  const stream = 'BT /F1 12 Tf 20 250 Td (Concept graph fixture) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

test('shared PDF reader and the knowledge-graph CLI work outside the repository without changing the PDF', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'course-knowledge-pages-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const pdfPath = join(directory, '教材 sample.pdf');
  const original = samplePdf();
  await writeFile(pdfPath, original);
  const expected = { totalPages: 1, pages: [{ page: 1, text: 'Concept graph fixture' }] };
  assert.deepEqual(await readPages(pdfPath, 1, 1), expected);
  const script = fileURLToPath(new URL('./read-pages.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [script, pdfPath, '1', '1'], { cwd: directory, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, '');
  assert.deepEqual(JSON.parse(run.stdout), expected);
  assert.equal(await readFile(pdfPath, 'utf8'), original);
});

test('CLI reports invalid arguments and out-of-range pages on stderr without partial JSON', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'course-knowledge-pages-errors-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const pdfPath = join(directory, 'sample.pdf');
  await writeFile(pdfPath, samplePdf());
  const script = fileURLToPath(new URL('./read-pages.mjs', import.meta.url));
  for (const args of [[], [pdfPath, '1'], [pdfPath, '1.5', '2'], [pdfPath, '1', '1', 'extra'], [pdfPath, '1', '2']]) {
    const result = spawnSync(process.execPath, [script, ...args], { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /PDF 读取失败/);
  }
});
