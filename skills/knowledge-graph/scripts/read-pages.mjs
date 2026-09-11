import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPages } from '../../mindmap/scripts/read-pages.mjs';

// Uses this repository's installed pdfjs-dist dependency and bundled PDF assets.
// ESM resolves the shared reader relative to this file, including from outputs cwd.
export { readPages };

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
