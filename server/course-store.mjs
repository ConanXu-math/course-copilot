import { chmod, copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeMindmapNode } from '../shared/mindmap-text.mjs';
import { validateKnowledgeGraph } from '../skills/knowledge-graph/scripts/validate-knowledge-graph.mjs';

const configuredHome = process.env.COURSE_COPILOT_HOME || resolve(homedir(), '.course-copilot');
let directory = resolve(configuredHome.replace(/^~(?=\/|$)/, homedir()));
let initialization;
const writes = new Map();
const generationSnapshots = new Map();
const pdfLimit = 100 * 1024 * 1024;

function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function positive(value) { return Number.isSafeInteger(value) && value > 0; }
function recordName(id) {
  if (typeof id !== 'string' || !id.trim() || id.length > 180) fail(400, '记录名称无效。');
  const name = encodeURIComponent(id);
  if (name.length > 220) fail(400, '记录名称过长。');
  return name;
}

function serial(key, work) {
  const previous = writes.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  writes.set(key, current);
  void current.finally(() => { if (writes.get(key) === current) writes.delete(key); }).catch(() => {});
  return current;
}

function updateGenerationSnapshots(id, artifact) {
  for (const snapshot of generationSnapshots.get(id) || []) {
    snapshot.set(artifact.id, structuredClone(artifact));
    snapshot.files?.set(`result-${recordName(artifact.id)}.json`, `${JSON.stringify(artifact, null, 2)}\n`);
  }
}

// 所有课程文件都从个人目录逐层访问，不穿过符号链接。
async function safePath(...parts) {
  const target = resolve(directory, ...parts);
  const local = relative(directory, target);
  if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) fail(400, '文件路径超出了个人课程目录。');
  let current = directory;
  for (const part of local.split(sep).filter(Boolean)) {
    current = resolve(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) fail(400, '课程文件不能使用符号链接。');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return target;
}

async function makeDirectory(...parts) {
  const path = await safePath(...parts);
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}

async function readJson(path, fallback) {
  await safePath(path);
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function writeFile(path, content) {
  await safePath(path);
  const temporary = resolve(dirname(path), `.writing-${randomUUID()}`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(content);
    await handle.close();
    await safePath(path);
    await rename(temporary, path);
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(temporary, { force: true });
    throw error;
  }
}
function writeJson(path, value) { return writeFile(path, `${JSON.stringify(value, null, 2)}\n`); }

async function courseRecords() {
  const coursesPath = await safePath('courses');
  const entries = await readdir(coursesPath, { withFileTypes: true });
  const records = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const courseDir = await safePath(coursesPath, entry.name);
    const meta = await readJson(resolve(courseDir, 'textbook/course.json'));
    if (meta?.id) records.push({ ...meta, courseDir });
  }
  return records.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}

async function courseRecord(id) {
  recordName(id);
  await initializeStore();
  const record = (await courseRecords()).find((item) => item.id === id);
  if (!record) fail(404, '没有找到这门课程。');
  return record;
}

async function bookFrom(record) {
  const chapters = await readJson(resolve(record.courseDir, 'textbook/outline.json'), []);
  const { id, title, filename, totalPages, initialPage, source, courseDir } = record;
  return { id, title, filename, totalPages, initialPage, source, chapters,
    directory: courseDir, url: `/api/courses/${encodeURIComponent(id)}/textbook` };
}

function courseTitle(filename) {
  let title = filename.replace(/\.pdf$/i, '').replace(/[\x00-\x1f<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '').slice(0, 80);
  while (Buffer.byteLength(title) > 220) title = [...title].slice(0, -1).join('');
  return title || '未命名教材';
}

async function reserveCourse(title) {
  for (let suffix = 1; ; suffix++) {
    const folder = suffix === 1 ? title : `${title} (${suffix})`;
    const path = await safePath('courses', folder);
    try {
      await mkdir(path, { mode: 0o700 });
      for (const child of ['textbook', 'textbook/pages', 'textbook/images', 'conversations', 'outputs']) {
        await makeDirectory(path, child);
      }
      return path;
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
}

async function writeNewCourse(courseDir, data, chapters) {
  const metadata = { ...data, createdAt: new Date().toISOString() };
  await writeJson(resolve(courseDir, 'textbook/outline.json'), chapters);
  await writeJson(resolve(courseDir, 'reading.json'), {
    page: data.initialPage || 1, bookmarks: [], notes: [], conversationId: randomUUID(),
  });
  await writeJson(resolve(courseDir, 'textbook/course.json'), metadata);
  return bookFrom({ ...metadata, courseDir });
}

export function initializeStore() {
  if (!initialization) initialization = (async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    directory = await realpath(directory);
    await chmod(directory, 0o700);
    await makeDirectory('courses');
    const settingsPath = await safePath('settings.json');
    if (await readJson(settingsPath) === undefined) await writeJson(settingsPath, {});
    else await chmod(settingsPath, 0o600);
    if ((await courseRecords()).length) return;
    const bundled = JSON.parse(await readFile(new URL('../src/data/textbook.json', import.meta.url), 'utf8'));
    const original = fileURLToPath(new URL(`../${bundled.filename}`, import.meta.url));
    try { await stat(original); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    const courseDir = await reserveCourse(courseTitle(bundled.title));
    try {
      await copyFile(original, resolve(courseDir, 'textbook.pdf'));
      await chmod(resolve(courseDir, 'textbook.pdf'), 0o600);
      await writeNewCourse(courseDir, {
        id: 'optimization', title: bundled.title, filename: bundled.filename,
        totalPages: bundled.totalPages, initialPage: bundled.initialPage || 1, source: 'included',
      }, bundled.chapters || []);
    } catch (error) { await rm(courseDir, { recursive: true, force: true }); throw error; }
  })().catch((error) => { initialization = undefined; throw error; });
  return initialization;
}

export async function getStorageInfo() {
  await initializeStore();
  return { directory, settings: await readJson(resolve(directory, 'settings.json'), {}) };
}

// Agent 设置只包含程序位置、模型和 Skill 路径；账号凭据由 Agent 自己保存。
export async function saveAgentSettings(value) {
  await initializeStore();
  return serial('settings', async () => {
    const path = resolve(directory, 'settings.json');
    const settings = await readJson(path, {});
    settings.agent = value;
    await writeJson(path, settings);
    return settings.agent;
  });
}

export async function updateSettings(value) {
  await initializeStore();
  if (!object(value)) fail(400, '个人设置格式不正确。');
  return serial('settings', async () => {
    const path = resolve(directory, 'settings.json');
    const settings = await readJson(path, {});
    if (value.activeCourseId !== undefined) {
      await courseRecord(value.activeCourseId);
      settings.activeCourseId = value.activeCourseId;
    }
    if (value.columnWidths !== undefined) {
      if (!object(value.columnWidths)) fail(400, '栏宽设置格式不正确。');
      settings.columnWidths = {};
      for (const key of ['sidebar', 'copilot']) {
        if (value.columnWidths[key] === undefined) continue;
        const width = value.columnWidths[key];
        if (!Number.isFinite(width) || width < 0 || width > 5000) fail(400, '栏宽设置超出了可用范围。');
        settings.columnWidths[key] = width;
      }
    }
    await writeJson(path, settings);
    return settings;
  });
}

export async function listCourses() {
  await initializeStore();
  return Promise.all((await courseRecords()).map(bookFrom));
}

export async function importCourse(stream, filename, legacyId) {
  await initializeStore();
  if (legacyId !== undefined) recordName(legacyId);
  return serial('create-course', async () => {
    if (legacyId) {
      const existing = (await courseRecords()).find((item) => item.legacyId === legacyId);
      if (existing) { stream.resume(); return bookFrom(existing); }
    }
    const name = basename(filename.replace(/\\/g, '/')).replace(/[\x00-\x1f]/g, '').slice(0, 180) || '教材.pdf';
    const title = courseTitle(name);
    const courseDir = await reserveCourse(title);
    let handle;
    try {
      handle = await open(resolve(courseDir, 'textbook.pdf'), 'wx', 0o600);
      let size = 0;
      let prefix = Buffer.alloc(0);
      for await (const chunk of stream.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > pdfLimit) fail(413, '教材超过了 100 MB，请压缩 PDF 后重试。');
        if (prefix.length < 5) {
          prefix = Buffer.concat([prefix, chunk.subarray(0, 5 - prefix.length)]);
          if (prefix.length === 5 && prefix.toString('ascii') !== '%PDF-') fail(400, '请上传有效的 PDF 教材。');
        }
        await handle.writeFile(chunk);
      }
      if (prefix.length < 5) fail(400, 'PDF 文件为空或不完整。');
      await handle.close();
      handle = undefined;
      return await writeNewCourse(courseDir, {
        id: randomUUID(), title, filename: name, initialPage: 1, source: 'imported',
        ...(legacyId ? { legacyId } : {}),
      }, []);
    } catch (error) {
      stream.resume();
      await handle?.close().catch(() => {});
      await rm(courseDir, { recursive: true, force: true });
      throw error;
    }
  });
}

export async function getCoursePaths(id) {
  const { courseDir, totalPages } = await courseRecord(id);
  return {
    courseDir, totalPages, textbookPath: await safePath(courseDir, 'textbook.pdf'),
    textbookDir: await safePath(courseDir, 'textbook'), outputsDir: await safePath(courseDir, 'outputs'),
  };
}

function outputRelative(filename) {
  if (typeof filename !== 'string' || !filename || filename.includes('\\') || filename.includes('\0')
      || filename.split('/').some((part) => !part || part === '.' || part === '..') || isAbsolute(filename)) {
    fail(400, '生成文件路径不正确。');
  }
  return filename;
}

export function outputUrl(courseId, relativeFilename) {
  return `/api/courses/${encodeURIComponent(courseId)}/outputs/${outputRelative(relativeFilename).split('/').map(encodeURIComponent).join('/')}`;
}

export async function resolveCourseFile(id, filename) {
  if (filename !== 'textbook.pdf' && !filename.startsWith('outputs/')) fail(404, '没有找到这个课程文件。');
  outputRelative(filename);
  const { courseDir } = await courseRecord(id);
  const path = await safePath(courseDir, filename);
  const info = await stat(path);
  if (!info.isFile()) fail(404, '没有找到这个课程文件。');
  await chmod(path, 0o600);
  return path;
}

function normalizeArtifactSource(source) {
  if (!object(source) || !['page', 'section', 'chapter', 'selection', 'book'].includes(source.scope)
      || !positive(source.page)
      || !['chapterId', 'sectionId'].every(key => source[key] === undefined
        || (typeof source[key] === 'string' && source[key].trim()))) return undefined;
  return {
    scope: source.scope, page: source.page,
    ...(source.chapterId === undefined ? {} : { chapterId: source.chapterId }),
    ...(source.sectionId === undefined ? {} : { sectionId: source.sectionId }),
  };
}

function normalizeArtifact(record, artifact) {
  if (!object(artifact) || typeof artifact.title !== 'string'
      || !['markdown', 'mindmap', 'knowledge-graph', 'slides', 'video', 'file'].includes(artifact.kind)) {
    fail(400, '生成结果格式不正确。');
  }
  recordName(artifact.id);
  if (artifact.kind === 'markdown' && typeof artifact.content !== 'string') fail(400, '文字资料缺少正文。');
  if (artifact.kind === 'slides' && (!Array.isArray(artifact.slides) || !artifact.slides.every((slide) => object(slide)
      && typeof slide.title === 'string' && typeof slide.content === 'string'))) fail(400, '课件需要包含标题和正文的页面列表。');
  if (['mindmap', 'knowledge-graph'].includes(artifact.kind)) {
    if (!Array.isArray(artifact.nodes) || !artifact.nodes.every((node) => object(node) && typeof node.id === 'string'
        && node.id.trim() && typeof node.label === 'string' && (node.page === undefined || positive(node.page))
        && (node.originalLabel === undefined || typeof node.originalLabel === 'string')
        && (node.userText === undefined || typeof node.userText === 'string'))
        || !Array.isArray(artifact.edges) || !artifact.edges.every((edge) => object(edge)
        && typeof edge.source === 'string' && typeof edge.target === 'string'
        && (edge.label === undefined || typeof edge.label === 'string'))) fail(400, '知识结构需要有效的知识点和连线列表。');
    if (new Set(artifact.nodes.map((node) => node.id)).size !== artifact.nodes.length) fail(400, '知识点名称重复，请为每个知识点使用不同的 id。');
  }
  if (artifact.kind === 'knowledge-graph' && artifact.schemaVersion !== undefined) {
    try { validateKnowledgeGraph(artifact, artifact.id, record.totalPages); }
    catch (error) { fail(400, `知识图谱格式不正确：${error.message}`); }
  }
  if (artifact.filename !== undefined && typeof artifact.filename !== 'string') fail(400, '生成文件名格式不正确。');
  if ((['video', 'file'].includes(artifact.kind) || artifact.url !== undefined)
      && (typeof artifact.url !== 'string' || !artifact.url.trim())) fail(400, '生成文件缺少本地文件地址。');
  const result = { ...artifact };
  if (result.kind === 'mindmap') result.nodes = result.nodes.map(normalizeMindmapNode);
  // 范围只是可选排序信息，旧结果里不合规范的范围不能使整份资料消失。
  const source = normalizeArtifactSource(result.source);
  if (source) result.source = source;
  else delete result.source;
  if (result.url !== undefined) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(result.url) || result.url.startsWith('//')) {
      fail(400, '请先让 Coding Agent 把生成文件保存到当前课程的 outputs 文件夹，再返回本地文件地址。');
    }
    if (!result.url.startsWith(`/api/courses/${encodeURIComponent(record.id)}/outputs/`)) {
      const outputs = resolve(record.courseDir, 'outputs');
      const local = isAbsolute(result.url) ? relative(outputs, result.url) : result.url.replace(/^outputs\//, '');
      result.url = outputUrl(record.id, local.split(sep).join('/'));
    }
  }
  return result;
}

async function writeArtifact(record, artifact, preserveExisting = false) {
  const incoming = normalizeArtifact(record, artifact);
  const path = await safePath(record.courseDir, 'outputs', `result-${recordName(incoming.id)}.json`);
  const snapshot = [...(generationSnapshots.get(record.id) || [])].find(items => items.has(incoming.id));
  const existing = preserveExisting ? snapshot?.get(incoming.id) ?? await readJson(path) : undefined;
  const result = existing ? normalizeArtifact(record, existing) : incoming;
  if (result.url?.startsWith(`/api/courses/${encodeURIComponent(record.id)}/outputs/`)) {
    const prefix = `/api/courses/${encodeURIComponent(record.id)}/outputs/`;
    let local;
    try { local = decodeURIComponent(result.url.slice(prefix.length)); }
    catch { fail(400, '生成文件地址的编码不正确。'); }
    const filePath = await safePath(record.courseDir, 'outputs', outputRelative(local));
    try {
      if (!(await stat(filePath)).isFile()) fail(400, '生成结果需要指向文件。');
      await chmod(filePath, 0o600);
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) fail(400, '生成文件不存在，请先让 Coding Agent 将文件写入当前课程的 outputs 文件夹。');
      throw error;
    }
  }
  if (existing) return result;
  await writeJson(path, result);
  updateGenerationSnapshots(record.id, result);
  return result;
}

export async function saveArtifact(id, artifact) {
  const record = await courseRecord(id);
  return serial(id, () => writeArtifact(record, artifact));
}

function sourceForRequest(request, outline) {
  const source = normalizeArtifactSource({ scope: request.scope, page: request.page });
  if (!source || source.scope === 'book') return source;
  const chapters = (Array.isArray(outline) ? outline : []).filter(item => object(item)
    && typeof item.id === 'string' && item.id.trim() && positive(item.page)
    && Number.isInteger(item.level) && item.level >= 0);
  let chapterIndex = -1;
  chapters.forEach((item, index) => {
    if (item.level === 0 && item.page <= source.page
        && (chapterIndex < 0 || item.page >= chapters[chapterIndex].page)) chapterIndex = index;
  });
  const requestedIndex = chapters.findIndex(item => item.id === request.chapter?.id && item.page <= source.page);
  // 请求里的目录 ID 表示用户选定的范围；级别和父子关系仍取自本课程的真实目录。
  if (source.scope === 'chapter' && chapters[requestedIndex]?.level === 0) chapterIndex = requestedIndex;
  if (source.scope === 'section' && chapters[requestedIndex]?.level === 1) {
    chapterIndex = -1;
    for (let index = requestedIndex - 1; index >= 0; index--) {
      if (chapters[index].level === 0) { chapterIndex = index; break; }
    }
  }
  let sectionIndex = -1;
  if (chapterIndex >= 0) {
    source.chapterId = chapters[chapterIndex].id;
    for (let index = chapterIndex + 1; index < chapters.length; index++) {
      const item = chapters[index];
      if (item.level === 0) break;
      if (item.level === 1 && item.page >= chapters[chapterIndex].page && item.page <= source.page
          && (sectionIndex < 0 || item.page >= chapters[sectionIndex].page)) sectionIndex = index;
    }
  }
  if (source.scope === 'section' && chapters[requestedIndex]?.level === 1) sectionIndex = requestedIndex;
  if (source.scope !== 'chapter' && sectionIndex >= 0) source.sectionId = chapters[sectionIndex].id;
  return source;
}

// 在启动 Agent 前调用：Agent 会直接写 outputs，不能把本次模型写入的 source 当成历史范围。
export async function createGeneratedArtifactSaver(id, request) {
  const record = await courseRecord(id);
  const { existing, source, inherited, graphInherited, conceptCatalogPath } = await serial(id, async () => {
    const saved = await artifactsFor(record);
    const existing = new Map(saved.map(artifact => [artifact.id, artifact]));
    const activeSnapshot = [...(generationSnapshots.get(id) || [])][0];
    existing.files = new Map(activeSnapshot?.files);
    if (!activeSnapshot) {
      const outputs = await safePath(record.courseDir, 'outputs');
      for (const file of await readdir(outputs, { withFileTypes: true })) {
        if (file.isFile() && /^result-.+\.json$/.test(file.name)) {
          existing.files.set(file.name, await readFile(await safePath(outputs, file.name), 'utf8'));
        }
      }
    }
    const outline = await readJson(resolve(record.courseDir, 'textbook/outline.json'), []);
    const context = request.skillId === 'chat' && request.artifact?.kind === 'mindmap' ? request.artifact : undefined;
    const original = context && existing.get(context.id);
    const inherited = context && (!original || original.kind === 'mindmap')
      ? normalizeArtifactSource(original ? original.source : context.source) : undefined;
    const graphContext = request.skillId === 'chat' && request.artifact?.kind === 'knowledge-graph'
      ? existing.get(request.artifact.id) : undefined;
    const graphInherited = graphContext?.kind === 'knowledge-graph'
      ? normalizeArtifactSource(graphContext.source) : undefined;
    const source = context ? undefined : sourceForRequest(request, outline);
    let conceptCatalogPath;
    if (request.skillId === 'knowledge-graph' || request.skillId === 'chat') {
      // Naming hints only. A repeated label does not establish equal meaning or textbook evidence.
      const concepts = new Map();
      for (const artifact of saved) {
        if (artifact.kind !== 'knowledge-graph') continue;
        for (const node of artifact.nodes) {
          if (typeof node.conceptKey !== 'string' || !node.conceptKey.trim()
              || typeof node.type !== 'string' || !node.type.trim()) continue;
          const key = JSON.stringify([node.conceptKey, node.type, node.label]);
          const known = concepts.get(key);
          const aliases = new Set([...(known?.aliases || []), ...(Array.isArray(node.aliases) ? node.aliases.filter(alias => typeof alias === 'string' && alias.trim()) : [])]);
          concepts.set(key, { conceptKey: node.conceptKey, type: node.type, label: node.label,
            aliases: [...aliases], ...(node.description ? { description: node.description } : {}) });
        }
      }
      if (concepts.size) {
        conceptCatalogPath = await safePath(record.courseDir, 'outputs', 'knowledge-concepts.json');
        await writeJson(conceptCatalogPath, { concepts: [...concepts.values()] });
      }
    }
    const snapshots = generationSnapshots.get(id) || new Set();
    snapshots.add(existing);
    generationSnapshots.set(id, snapshots);
    return { existing, source, inherited, graphInherited, conceptCatalogPath };
  });
  const save = artifact => serial(id, async () => {
    const previous = existing.get(artifact?.id);
    try {
      // PDF loading may finish after generation started. Never validate against a stale
      // client-supplied count or a pre-load record captured before metadata was saved.
      if (artifact?.kind === 'knowledge-graph') record.totalPages = (await courseRecord(id)).totalPages;
      // 新生成的文字属于原文；用户补充只能来自已保存节点或专用 PATCH 接口。
      const incoming = artifact?.kind === 'mindmap' && Array.isArray(artifact.nodes)
        ? { ...artifact, nodes: artifact.nodes.map(node => {
          if (!object(node)) return node;
          const { userText, originalLabel, ...generated } = node;
          return generated;
        }) } : artifact;
      const result = normalizeArtifact(record, incoming);
      delete result.source;
      if (result.kind === 'knowledge-graph') {
        // Only new generations require v2; legacy files stay readable as they are.
        try { validateKnowledgeGraph(result, result.id, record.totalPages, { requireV2: true }); }
        catch (error) { fail(400, `知识图谱未通过保存检查：${error.message}`); }
        const latestOutline = await readJson(resolve(record.courseDir, 'textbook/outline.json'), []);
        const scopedSource = source && { ...sourceForRequest(request, latestOutline), ...source };
        const trustedSource = previous?.kind === 'knowledge-graph' ? previous.source
          : request.skillId === 'chat' && request.artifact?.kind === 'knowledge-graph' ? graphInherited : scopedSource;
        if (trustedSource) result.source = { ...trustedSource };
      }
      if (previous?.kind === 'mindmap') {
        const retainedIds = new Set(result.kind === 'mindmap' ? result.nodes.map(node => node.id) : []);
        if (previous.nodes.some(node => node.userText && !retainedIds.has(node.id))) {
          fail(409, '这份导图仍有用户补充，已保留原资料。请生成新导图后再调整节点结构。');
        }
      }
      if (result.kind === 'mindmap') {
        const trustedSource = previous?.kind === 'mindmap' ? previous.source : inherited || source;
        if (trustedSource) result.source = { ...trustedSource };
        if (previous?.kind === 'mindmap') {
          const originalNodes = new Map(previous.nodes.map(node => [node.id, node]));
          result.nodes = result.nodes.map(node => {
            const original = originalNodes.get(node.id);
            return original ? {
              ...node, label: original.label, userText: original.userText,
              ...(original.originalLabel === undefined ? {} : { originalLabel: original.originalLabel }),
            } : node;
          });
        }
      }
      const saved = await writeArtifact(record, result);
      existing.set(saved.id, structuredClone(saved));
      updateGenerationSnapshots(id, saved);
      return saved;
    } catch (error) {
      // Agent 可能已覆盖同名文件；失败时恢复完整旧图，不能只拒绝流式事件。
      if (previous && (previous.kind === 'mindmap' || previous.kind === 'knowledge-graph' || artifact?.kind === 'knowledge-graph')) {
        await writeArtifact(record, previous);
      } else if (artifact?.kind === 'knowledge-graph' && typeof artifact.id === 'string') {
        // Also handle an Agent that ignored the pending-file contract. Keep its output for
        // diagnosis, but do not let a rejected result reappear after a page reload.
        try {
          const name = recordName(artifact.id);
          const path = await safePath(record.courseDir, 'outputs', `result-${name}.json`);
          const rejected = await safePath(record.courseDir, 'outputs', `rejected-${name}-${randomUUID()}.json`);
          await rename(path, rejected);
        } catch (cleanupError) {
          if (cleanupError.code !== 'ENOENT' && cleanupError.status !== 400) throw cleanupError;
        }
      }
      throw error;
    }
  });
  save.knowledgeGraphContext = { conceptCatalogPath };
  save.finalize = () => serial(id, async () => {
    // Runs even if the Agent returned no artifact, malformed JSON, or was interrupted.
    // Only writes that passed our saver (including concurrent user note saves) enter
    // the authoritative snapshot. Keep unapproved output for diagnosis outside result-*.
    const outputs = await safePath(record.courseDir, 'outputs');
    const approved = existing.files;
    for (const file of await readdir(outputs, { withFileTypes: true })) {
      if (!file.isFile() || !/^result-.+\.json$/.test(file.name) || approved.has(file.name)) continue;
      const rejected = await safePath(outputs, `rejected-${randomUUID()}-${file.name}`);
      await rename(await safePath(outputs, file.name), rejected);
    }
    for (const [filename, contents] of approved) {
      const path = await safePath(outputs, filename);
      let onDisk;
      try { onDisk = await readFile(path, 'utf8'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      // Preserve original bytes, including old-format files that normalize on read.
      if (onDisk !== contents) await writeFile(path, contents);
    }
  });
  save.dispose = () => {
    const snapshots = generationSnapshots.get(id);
    snapshots?.delete(existing);
    if (!snapshots?.size) generationSnapshots.delete(id);
  };
  return save;
}

export async function updateMindmapNode(id, artifactId, nodeId, value) {
  if (!object(value) || typeof value.userText !== 'string'
      || Object.keys(value).some(key => key !== 'userText')) fail(400, '只能编辑用户补充文字，不能修改生成原文。');
  const userText = value.userText;
  if (userText.length > 2000) fail(400, '补充文字不能超过 2000 个字符。');
  if (typeof nodeId !== 'string' || !nodeId.trim()) fail(400, '节点名称无效。');
  const filename = `result-${recordName(artifactId)}.json`;
  const record = await courseRecord(id);
  return serial(id, async () => {
    const path = await safePath(record.courseDir, 'outputs', filename);
    // 同 ID 生成进行中时，以生成前快照（含期间保存的补充）为准，避免读到 Agent 的临时覆盖。
    const snapshot = [...(generationSnapshots.get(id) || [])].find(items => items.has(artifactId));
    const saved = snapshot?.get(artifactId) ?? await readJson(path);
    if (saved === undefined) fail(404, '没有找到这份生成资料。');
    const artifact = normalizeArtifact(record, saved);
    if (artifact.id !== artifactId) fail(400, '生成资料的 ID 与文件名不一致。');
    if (artifact.kind !== 'mindmap') fail(400, '当前只支持编辑思维导图节点。');
    const node = artifact.nodes.find(item => item.id === nodeId);
    if (!node) fail(404, '没有找到这个思维导图节点。');
    if (node.userText === userText) return artifact;
    const updated = {
      ...artifact,
      nodes: artifact.nodes.map(item => item.id === nodeId
        ? { ...item, userText }
        : item),
    };
    const result = await writeArtifact(record, updated);
    updateGenerationSnapshots(id, result);
    return result;
  });
}

async function artifactsFor(record) {
  // Do not display an Agent's drafts or temporary overwrites during generation.
  const active = [...(generationSnapshots.get(record.id) || [])][0];
  if (active) return [...active.values()].map(artifact => structuredClone(artifact));
  const outputs = await safePath(record.courseDir, 'outputs');
  const files = await readdir(outputs, { withFileTypes: true });
  const artifacts = [];
  for (const file of files) {
    if (!file.isFile() || !/^result-.+\.json$/.test(file.name)) continue;
    try {
      const artifact = await readJson(resolve(outputs, file.name));
      if (artifact?.id) artifacts.push(normalizeArtifact(record, artifact));
    } catch (error) {
      // Agent 可能还在写这个文件；一个尚不能展示的结果不应挡住整门课程。
      if (!(error instanceof SyntaxError) && error.status !== 400) throw error;
    }
  }
  return artifacts;
}

function readingValues(value, initialPage) {
  if (!object(value)) fail(400, '阅读记录格式不正确。');
  const page = value.page ?? initialPage ?? 1;
  if (!positive(page)) fail(400, '阅读页码不正确。');
  const bookmarks = value.bookmarks ?? [];
  const notes = value.notes ?? [];
  if (!Array.isArray(bookmarks) || !bookmarks.every(positive)
      || !Array.isArray(notes) || !notes.every((note) => object(note) && typeof note.id === 'string' && positive(note.page) && typeof note.content === 'string')) {
    fail(400, '书签或笔记格式不正确。');
  }
  const conversationId = value.conversationId || randomUUID();
  recordName(conversationId);
  return { page, bookmarks: [...new Set(bookmarks)], notes, conversationId };
}

function validMessages(messages) {
  if (!Array.isArray(messages) || !messages.every((message) => object(message)
      && typeof message.id === 'string' && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string'
      && (message.artifacts === undefined || Array.isArray(message.artifacts)))) {
    fail(400, '对话记录格式不正确。');
  }
  return messages;
}

function latestMessageArtifacts(record, messages, artifacts) {
  const latest = new Map(artifacts.map(artifact => [artifact.id, artifact]));
  return validMessages(messages).map(message => {
    if (message.artifacts === undefined) return message;
    return { ...message, artifacts: message.artifacts.map(artifact => {
      const original = normalizeArtifact(record, artifact);
      return latest.get(original.id) || original;
    }) };
  });
}

async function conversationFor(record, conversationId) {
  return readJson(resolve(record.courseDir, 'conversations', `${recordName(conversationId)}.json`));
}

async function stateFor(record) {
  const saved = await readJson(resolve(record.courseDir, 'reading.json'), {});
  const reading = readingValues(saved, record.initialPage);
  const conversation = await conversationFor(record, reading.conversationId);
  const artifacts = await artifactsFor(record);
  return { ...reading, messages: latestMessageArtifacts(record, conversation?.messages || [], artifacts), artifacts };
}

export async function getState(id) { return stateFor(await courseRecord(id)); }

async function saveMessages(record, conversationId, messages, extra = {}) {
  const normalized = [];
  for (const message of validMessages(messages)) {
    const artifacts = [];
    for (const artifact of message.artifacts || []) artifacts.push(await writeArtifact(record, artifact, true));
    normalized.push({ ...message, ...(message.artifacts ? { artifacts } : {}) });
  }
  await writeJson(resolve(record.courseDir, 'conversations', `${recordName(conversationId)}.json`), {
    id: conversationId, messages: normalized, updatedAt: new Date().toISOString(), ...extra,
  });
}

export async function saveState(id, value) {
  const record = await courseRecord(id);
  return serial(id, async () => {
    const reading = readingValues(value, record.initialPage);
    validMessages(value.messages || []);
    if (!Array.isArray(value.artifacts || [])) fail(400, '生成结果列表格式不正确。');
    for (const artifact of value.artifacts || []) await writeArtifact(record, artifact, true);
    await saveMessages(record, reading.conversationId, value.messages || []);
    await writeJson(resolve(record.courseDir, 'reading.json'), { ...reading, updatedAt: new Date().toISOString() });
    return stateFor(record);
  });
}

export async function listConversations(id) {
  const record = await courseRecord(id);
  const path = await safePath(record.courseDir, 'conversations');
  const results = [];
  for (const file of await readdir(path, { withFileTypes: true })) {
    if (!file.isFile() || !file.name.endsWith('.json')) continue;
    const saved = await readJson(resolve(path, file.name));
    if (!saved?.id) continue;
    results.push({ id: saved.id, title: saved.messages?.find((message) => message.role === 'user')?.content.slice(0, 60) || '新对话',
      updatedAt: saved.updatedAt || '', messageCount: saved.messages?.length || 0 });
  }
  return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getConversation(id, conversationId) {
  const record = await courseRecord(id);
  const saved = await conversationFor(record, conversationId);
  if (!saved) fail(404, '没有找到这段对话。');
  return { messages: latestMessageArtifacts(record, saved.messages || [], await artifactsFor(record)) };
}

export async function updateTextbook(id, value) {
  const record = await courseRecord(id);
  if (!object(value)) fail(400, '教材信息格式不正确。');
  if (value.totalPages !== undefined && !positive(value.totalPages)) fail(400, '教材页数不正确。');
  if (value.chapters !== undefined && (!Array.isArray(value.chapters) || !value.chapters.every((chapter) => object(chapter)
      && typeof chapter.id === 'string' && typeof chapter.title === 'string' && positive(chapter.page)
      && Number.isInteger(chapter.level) && chapter.level >= 0))) fail(400, '教材目录格式不正确。');
  return serial(id, async () => {
    const latest = await readJson(resolve(record.courseDir, 'textbook/course.json'));
    if (value.totalPages !== undefined) latest.totalPages = value.totalPages;
    if (value.chapters !== undefined) await writeJson(resolve(record.courseDir, 'textbook/outline.json'), value.chapters);
    await writeJson(resolve(record.courseDir, 'textbook/course.json'), latest);
    return bookFrom({ ...latest, courseDir: record.courseDir });
  });
}

export async function savePage(id, page, text) {
  if (!positive(page) || typeof text !== 'string') fail(400, '教材页码或正文格式不正确。');
  const record = await courseRecord(id);
  return serial(id, async () => {
    await writeFile(resolve(record.courseDir, 'textbook/pages', `${page}.txt`), text);
    return { saved: true };
  });
}

export async function migrateState(id, value) {
  if (!object(value) || typeof value.legacyId !== 'string' || !object(value.state)) fail(400, '旧记录格式不正确。');
  recordName(value.legacyId);
  const record = await courseRecord(id);
  return serial(id, async () => {
    const conversationId = `legacy-${value.legacyId}`;
    if (await conversationFor(record, conversationId)) return stateFor(record);
    const incoming = readingValues({ ...value.state, conversationId }, record.initialPage);
    const messages = validMessages(value.state.messages || []).map((message) => message.status === 'running'
      ? { ...message, status: 'stopped', progress: '从旧浏览器恢复的对话，原任务已停止。' } : message);
    const current = await stateFor(record);
    const savedReading = await readJson(resolve(record.courseDir, 'reading.json'), {});
    for (const artifact of value.state.artifacts || []) await writeArtifact(record, artifact, true);
    const reading = {
      page: savedReading.updatedAt || current.messages.length || current.bookmarks.length || current.notes.length ? current.page : incoming.page,
      bookmarks: [...new Set([...current.bookmarks, ...incoming.bookmarks])],
      notes: [...current.notes, ...incoming.notes.filter((note) => !current.notes.some((item) => item.id === note.id))],
      conversationId: savedReading.updatedAt || current.messages.length ? current.conversationId : conversationId,
    };
    await writeJson(resolve(record.courseDir, 'reading.json'), reading);
    await saveMessages(record, conversationId, messages, { legacyId: value.legacyId });
    return stateFor(record);
  });
}
