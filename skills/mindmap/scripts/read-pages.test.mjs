import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { readPages } from './read-pages.mjs';

// A small original fixture: two text lines, an empty page, and one short page.
function samplePdf() {
  const streams = ['BT /F1 12 Tf 20 250 Td (First line) Tj 0 -20 Td (Second line) Tj ET', '', 'BT /F1 12 Tf 20 250 Td (End) Tj ET'];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R] /Count 3 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (const [index, stream] of streams.entries()) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
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

test('extracts an inclusive PDF range in order, preserving empty pages and line breaks', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'course-mindmap-pages-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'sample.pdf');
  await writeFile(path, samplePdf());
  const result = await readPages(path, 1, 3);
  assert.equal(result.totalPages, 3);
  assert.deepEqual(result.pages.map(page => page.page), [1, 2, 3]);
  assert.match(result.pages[0].text, /First line\nSecond line/);
  assert.equal(result.pages[1].text, '');
  assert.equal(result.pages[2].text.trim(), 'End');
  const subset = await readPages(path, 2, 2);
  assert.deepEqual(subset, { totalPages: 3, pages: [{ page: 2, text: '' }] });
  await assert.rejects(readPages(path, 1, 4), /只有 3 页/);
});

test('rejects invalid page ranges before opening a PDF', async () => {
  for (const [start, end] of [[0, 1], [2, 1], [1, 1.5], [NaN, 2], [1, Infinity], [1, Number.MAX_SAFE_INTEGER + 1]]) {
    await assert.rejects(readPages('not-opened.pdf', start, end), /页码必须/);
  }
});

test('reports malformed PDFs as errors', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'course-mindmap-invalid-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'invalid.pdf');
  await writeFile(path, 'This is not a PDF.');
  await assert.rejects(readPages(path, 1, 1), /PDF/i);
});

test('CLI emits only JSON from another working directory and keeps errors on stderr', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'course-mindmap-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const pdfPath = join(directory, 'sample.pdf');
  await writeFile(pdfPath, samplePdf());
  const script = fileURLToPath(new URL('./read-pages.mjs', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [script, pdfPath, ...args], { cwd: directory, encoding: 'utf8' });
  const success = run('2', '3');
  assert.equal(success.status, 0, success.stderr);
  assert.equal(success.stderr, '');
  const result = JSON.parse(success.stdout);
  assert.equal(result.totalPages, 3);
  assert.deepEqual(result.pages.map(page => page.page), [2, 3]);
  for (const args of [['1', '4'], ['1.5', '2'], ['1', '2', 'extra']]) {
    const failure = run(...args);
    assert.equal(failure.status, 1);
    assert.equal(failure.stdout, '');
    assert.ok(failure.stderr.trim());
  }
});
