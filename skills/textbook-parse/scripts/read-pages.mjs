import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { getDocument, ImageKind, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

function pageText(items) {
  let text = '';
  let previous;
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    if (previous && Math.abs(item.transform[5] - previous.transform[5]) > Math.max(2, previous.height * 0.45)) {
      if (!text.endsWith('\n')) text += '\n';
    } else if (previous && !text.endsWith('\n') && item.transform[4] - previous.transform[4] - previous.width > 2) {
      text += ' ';
    }
    text += item.str;
    if (item.hasEOL) text += '\n';
    previous = item;
  }
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

async function outlineFor(pdf) {
  const result = [];
  async function visit(items, level) {
    for (const item of items || []) {
      const destination = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
      let page = null;
      if (destination?.[0] !== undefined) {
        try { page = (typeof destination[0] === 'number' ? destination[0] : await pdf.getPageIndex(destination[0])) + 1; }
        catch { /* 外部或不可定位的目录项保留标题。 */ }
      }
      result.push({ title: item.title, level, page });
      await visit(item.items, level + 1);
    }
  }
  await visit(await pdf.getOutline(), 0);
  return result;
}

function imageCanvas(factory, image) {
  const { width, height, data, kind } = image;
  if (!width || !height || width * height > 24000000) throw new Error('图片尺寸超出独立导出范围');
  const target = factory.create(width, height);
  try {
    if (image.bitmap) target.context.drawImage(image.bitmap, 0, 0);
    else {
      const pixels = target.context.createImageData(width, height);
      if (kind === ImageKind.RGBA_32BPP) pixels.data.set(data);
      else if (kind === ImageKind.RGB_24BPP) {
        for (let i = 0; i < width * height; i++) {
          pixels.data[i * 4] = data[i * 3];
          pixels.data[i * 4 + 1] = data[i * 3 + 1];
          pixels.data[i * 4 + 2] = data[i * 3 + 2];
          pixels.data[i * 4 + 3] = 255;
        }
      } else if (kind === ImageKind.GRAYSCALE_1BPP) {
        const stride = Math.ceil(width / 8);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const value = data[y * stride + (x >> 3)] & (128 >> (x % 8)) ? 255 : 0;
          const offset = (y * width + x) * 4;
          pixels.data.set([value, value, value, 255], offset);
        }
      } else throw new Error('图片格式不能独立导出');
      target.context.putImageData(pixels, 0, 0);
    }
    return target.canvas.toBuffer('image/png');
  } finally { factory.destroy(target); }
}

async function main() {
  const { values } = parseArgs({ options: {
    pdf: { type: 'string' }, out: { type: 'string' },
    start: { type: 'string' }, end: { type: 'string' }, images: { type: 'string', default: 'all' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('node read-pages.mjs --pdf 教材.pdf --start 22 --end 23 --out 课程/outputs/本次解析目录 --images none|pages|all（默认 all，兼容已有调用）');
    return;
  }
  if (!values.pdf || !values.out) throw new Error('请提供 --pdf 和 --out。');
  if (!['none', 'pages', 'all'].includes(values.images)) throw new Error('--images 请选择 none、pages 或 all。');
  const first = Number(values.start || 1);
  const last = Number(values.end || first);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first) throw new Error('页码必须为正整数，结束页不得早于起始页。');
  const assets = fileURLToPath(new URL('./', import.meta.resolve('pdfjs-dist/package.json')));
  const loading = getDocument({
    data: new Uint8Array(await readFile(resolve(values.pdf))),
    cMapUrl: assets + 'cmaps/', cMapPacked: true,
    standardFontDataUrl: assets + 'standard_fonts/', wasmUrl: assets + 'wasm/',
    isEvalSupported: false, isOffscreenCanvasSupported: false, verbosity: 0,
  });
  try {
    const pdf = await loading.promise;
    if (last > pdf.numPages) throw new Error('结束页超过教材的 ' + pdf.numPages + ' 页。');
    const out = resolve(values.out);
    await mkdir(out, { recursive: true, mode: 0o700 });
    const outline = await outlineFor(pdf);
    const labels = await pdf.getPageLabels();
    const pages = [];
    for (let number = first; number <= last; number++) {
      const page = await pdf.getPage(number);
      const text = pageText((await page.getTextContent()).items);
      let preview = null;
      if (values.images !== 'none') {
        const original = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 1600 / Math.max(original.width, original.height) });
        const target = pdf.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
        preview = 'page-' + number + '.png';
        try {
          await page.render({ canvasContext: target.context, viewport, background: 'white' }).promise;
          await writeFile(resolve(out, preview), target.canvas.toBuffer('image/png'));
        } finally { pdf.canvasFactory.destroy(target); }
      }
      const images = [];
      const notes = [];
      const seen = new Set();
      const operations = values.images === 'all' ? await page.getOperatorList() : { fnArray: [], argsArray: [] };
      for (let i = 0; i < operations.fnArray.length; i++) {
        const operation = operations.fnArray[i];
        if (![OPS.paintImageXObject, OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObject].includes(operation)) continue;
        const value = operations.argsArray[i][0];
        if (seen.has(value)) continue;
        seen.add(value);
        try {
          const image = typeof value === 'string' ? (value.startsWith('g_') ? page.commonObjs : page.objs).get(value) : value;
          const filename = 'page-' + number + '-image-' + (images.length + 1) + '.png';
          await writeFile(resolve(out, filename), imageCanvas(pdf.canvasFactory, image));
          images.push(filename);
        } catch { notes.push('一幅内嵌图片未能独立导出，请查看原页预览。'); }
      }
      await writeFile(resolve(out, 'page-' + number + '.txt'), text, 'utf8');
      pages.push({ page: number, label: labels?.[number - 1] || null, text, preview, images, notes,
        needsVisualReading: !text.trim() });
      console.error('已读取 PDF 第 ' + number + ' 页，独立图片 ' + images.length + ' 张。');
      page.cleanup();
    }
    const source = { textbook: basename(values.pdf), totalPages: pdf.numPages, start: first, end: last, imageMode: values.images, outline, pages };
    const sourcePath = resolve(out, 'source.json');
    await writeFile(sourcePath, JSON.stringify(source, null, 2), 'utf8');
    console.log(JSON.stringify({ source: sourcePath, pages: pages.map(({ page, preview, images, needsVisualReading }) => ({ page, preview, images, needsVisualReading })) }));
  } finally { await loading.destroy(); }
}

main().catch(error => { console.error('教材读取失败：' + error.message); process.exitCode = 1; });
