import { chmod, copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slideTemplates } from './slide-templates.mjs';

const configuredHome = process.env.COURSE_COPILOT_HOME || resolve(homedir(), '.course-copilot');
let directory = resolve(configuredHome.replace(/^~(?=\/|$)/, homedir()));
let initialization;
const writes = new Map();
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
  const { courseDir } = await courseRecord(id);
  return {
    courseDir, textbookPath: await safePath(courseDir, 'textbook.pdf'),
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

function normalizeArtifact(record, artifact) {
  if (!object(artifact) || typeof artifact.title !== 'string'
      || !['markdown', 'mindmap', 'knowledge-graph', 'slides', 'video', 'file'].includes(artifact.kind)) {
    fail(400, '生成结果格式不正确。');
  }
  recordName(artifact.id);
  if (artifact.kind === 'markdown' && typeof artifact.content !== 'string') fail(400, '文字资料缺少正文。');
  if (artifact.kind === 'slides') {
    if (artifact.templateId !== undefined && !slideTemplates.some(template => template.id === artifact.templateId)) fail(400, '课件模板名称不正确。');
    if (artifact.slides !== undefined && (!Array.isArray(artifact.slides) || !artifact.slides.every((slide) => object(slide)
        && typeof slide.title === 'string' && typeof slide.content === 'string'))) fail(400, '课件页面需要包含标题和正文。');
    if (artifact.chapters !== undefined && (!Array.isArray(artifact.chapters) || !artifact.chapters.length
        || !artifact.chapters.every((chapter) => object(chapter) && typeof chapter.title === 'string' && chapter.title.trim()
          && typeof chapter.url === 'string' && /\.pdf$/i.test(chapter.url)
          && (chapter.filename === undefined || typeof chapter.filename === 'string')))) fail(400, '章节课件需要包含标题和 PDF 文件地址。');
    if (!Array.isArray(artifact.slides) && !artifact.chapters?.length) fail(400, '课件需要包含页面内容或章节 PDF。');
    if (artifact.sourceUrl !== undefined && (typeof artifact.sourceUrl !== 'string' || !/\.zip$/i.test(artifact.sourceUrl))) {
      fail(400, '课件源文件需要使用 ZIP 文件地址。');
    }
  }
  if (['mindmap', 'knowledge-graph'].includes(artifact.kind)) {
    if (!Array.isArray(artifact.nodes) || !artifact.nodes.every((node) => object(node) && typeof node.id === 'string'
        && node.id.trim() && typeof node.label === 'string' && (node.page === undefined || positive(node.page)))
        || !Array.isArray(artifact.edges) || !artifact.edges.every((edge) => object(edge)
        && typeof edge.source === 'string' && typeof edge.target === 'string'
        && (edge.label === undefined || typeof edge.label === 'string'))) fail(400, '知识结构需要有效的知识点和连线列表。');
    if (new Set(artifact.nodes.map((node) => node.id)).size !== artifact.nodes.length) fail(400, '知识点名称重复，请为每个知识点使用不同的 id。');
  }
  if (artifact.filename !== undefined && typeof artifact.filename !== 'string') fail(400, '生成文件名格式不正确。');
  if ((['video', 'file'].includes(artifact.kind) || artifact.url !== undefined)
      && (typeof artifact.url !== 'string' || !artifact.url.trim())) fail(400, '生成文件缺少本地文件地址。');
  const result = { ...artifact };
  if (result.url !== undefined) result.url = normalizeOutputUrl(record, result.url);
  if (result.kind === 'slides') {
    if (result.sourceUrl !== undefined) result.sourceUrl = normalizeOutputUrl(record, result.sourceUrl);
    if (result.chapters) result.chapters = result.chapters.map(chapter => ({ ...chapter, url: normalizeOutputUrl(record, chapter.url) }));
  }
  return result;
}

function normalizeOutputUrl(record, url) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) {
    fail(400, '生成文件应保存在当前课程的 outputs 文件夹，并使用本地文件地址。');
  }
  const prefix = `/api/courses/${encodeURIComponent(record.id)}/outputs/`;
  if (url.startsWith(prefix)) {
    let local;
    try { local = decodeURIComponent(url.slice(prefix.length)); }
    catch { fail(400, '生成文件地址的编码不正确。'); }
    return outputUrl(record.id, local);
  }
  const outputs = resolve(record.courseDir, 'outputs');
  const local = isAbsolute(url) ? relative(outputs, url) : url.replace(/^outputs\//, '');
  return outputUrl(record.id, local.split(sep).join('/'));
}

async function writeArtifact(record, artifact, preserveExisting = false) {
  const incoming = normalizeArtifact(record, artifact);
  const path = await safePath(record.courseDir, 'outputs', `result-${recordName(incoming.id)}.json`);
  const existing = preserveExisting ? await readJson(path) : undefined;
  const result = existing ? normalizeArtifact(record, existing) : incoming;
  const urls = [result.url, ...(result.kind === 'slides' ? [result.sourceUrl, ...(result.chapters || []).map(chapter => chapter.url)] : [])].filter(Boolean);
  for (const url of new Set(urls)) {
    const prefix = `/api/courses/${encodeURIComponent(record.id)}/outputs/`;
    let local;
    try { local = decodeURIComponent(url.slice(prefix.length)); }
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
  return result;
}

export async function saveArtifact(id, artifact) {
  const record = await courseRecord(id);
  return serial(id, () => writeArtifact(record, artifact));
}

async function artifactsFor(record) {
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
      && typeof message.id === 'string' && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string')) {
    fail(400, '对话记录格式不正确。');
  }
  return messages;
}

async function conversationFor(record, conversationId) {
  return readJson(resolve(record.courseDir, 'conversations', `${recordName(conversationId)}.json`));
}

async function stateFor(record) {
  const saved = await readJson(resolve(record.courseDir, 'reading.json'), {});
  const reading = readingValues(saved, record.initialPage);
  const conversation = await conversationFor(record, reading.conversationId);
  return { ...reading, messages: conversation?.messages || [], artifacts: await artifactsFor(record) };
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
  const saved = await conversationFor(await courseRecord(id), conversationId);
  if (!saved) fail(404, '没有找到这段对话。');
  return { messages: saved.messages || [] };
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
