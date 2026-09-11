import { readFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfjsDirectory = dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')));

function assertRange(start, end, totalPages) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
    throw new Error('页码必须是从 1 开始的整数，且起始页不能大于结束页。');
  }
  if (totalPages !== undefined && end > totalPages) {
    throw new Error(`请求第 ${start}–${end} 页，但 PDF 只有 ${totalPages} 页。`);
  }
}

/** Read an inclusive range of physical PDF pages without modifying the source. */
export async function readPages(pdfPath, start, end) {
  assertRange(start, end);
  const data = new Uint8Array(await readFile(pdfPath));
  const task = getDocument({
    data,
    cMapUrl: join(pdfjsDirectory, 'cmaps') + sep,
    cMapPacked: true,
    standardFontDataUrl: join(pdfjsDirectory, 'standard_fonts') + sep,
    wasmUrl: join(pdfjsDirectory, 'wasm') + sep,
    useWorkerFetch: false,
    verbosity: 0,
  });

  try {
    const document = await task.promise;
    assertRange(start, end, document.numPages);
    const pages = [];
    for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const text = content.items
          .filter(item => typeof item.str === 'string')
          .map(item => item.str + (item.hasEOL ? '\n' : ''))
          .join('');
        pages.push({ page: pageNumber, text });
      } finally {
        page.cleanup();
      }
    }
    return { totalPages: document.numPages, pages };
  } finally {
    await task.destroy();
  }
}

async function main() {
  const [pdfPath, start, end, ...extra] = process.argv.slice(2);
  if (!pdfPath || !start || !end || extra.length) {
    throw new Error('用法：node read-pages.mjs <PDF 路径> <起始页> <结束页>');
  }
  if (!/^[1-9]\d*$/.test(start) || !/^[1-9]\d*$/.test(end)) {
    throw new Error('起始页和结束页必须是从 1 开始的整数。');
  }
  const result = await readPages(pdfPath, Number(start), Number(end));
  process.stdout.write(JSON.stringify(result) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(`PDF 读取失败：${error.message}`);
    process.exitCode = 1;
  });
}
