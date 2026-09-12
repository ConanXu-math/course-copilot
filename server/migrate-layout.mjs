#!/usr/bin/env node
// 一次性把旧版课程目录整理成新布局：
//   outputs/<类型>/            成品（人看的文档）
//   outputs/.build/artifacts/  结果 JSON
//   outputs/.build/            LaTeX 编译树、解析缓存、临时产物
//   课程目录按书名 slug 命名，同一本书（sha256 相同）合并到一个目录。
// 用法：node server/migrate-layout.mjs [--dry-run]
// 默认在 COURSE_COPILOT_HOME（缺省 ~/.course-copilot）上运行，先整目录备份到 .backup-<时间戳>。

import { access, cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';

const dryRun = process.argv.includes('--dry-run');
const home = resolve(process.env.COURSE_COPILOT_HOME || resolve(homedir(), '.course-copilot'));
const coursesRoot = resolve(home, 'courses');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
// 备份放到数据目录的同级，避免把目录复制进自己的子目录。
const backupDir = resolve(dirname(home), `${basename(home)}.backup-${stamp}`);
const trashDir = resolve(home, '.trash');

const TYPE_SUBDIRS = new Set(['notes', 'slides', 'quizzes', 'mindmaps', 'knowledge-graphs', 'videos', 'files']);
const BUILD_DIR = '.build';
const BUILD_ARTIFACTS = join(BUILD_DIR, 'artifacts');

const actions = [];
function log(action, detail) { actions.push({ action, detail }); if (!dryRun) console.log(`  ${action} ${detail}`); }

async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function isDir(path) { try { return (await lstat(path)).isDirectory(); } catch { return false; } }

function slugify(title) {
  let name = String(title || '').replace(/\.pdf$/i, '').replace(/[\x00-\x1f<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim();
  name = name.replace(/[_\u00a0]+/g, '-').replace(/-+/g, '-');
  name = name.replace(/-(\d{4})\.(1[0-2]|0[1-9])$/i, '').replace(/-v\d+$/i, '').replace(/-\d{8}$/i, '');
  name = name.replace(/^\.+|\.+$/g, '').slice(0, 80);
  return name || '未命名教材';
}

function classify(name) {
  const ext = extname(name).toLowerCase();
  if (ext === '.pdf' || ext === '.zip') return 'slides';
  if (ext === '.mp4' || ext === '.webm' || ext === '.mp3' || ext === '.wav') return 'videos';
  if (ext === '.md' || ext === '.svg' || ext === '.png' || ext === '.jpg' || ext === '.jpeg'
      || ext === '.webp' || ext === '.tex' || ext === '.txt' || ext === '') return 'notes';
  return 'files';
}

// 旧布局里这些是过程/临时产物，不是给人看的成品。
function isBuildArtifact(name) {
  const base = basename(name);
  if (base === '.DS_Store') return true;
  if (/^result-.*\.json$/.test(base)) return true;
  if (base === 'knowledge-concepts.json' || base === 'pending-') return true;
  if (/^(slides-|quiz-|mindmap-|knowledge-|video-|reading-|selection-|demo-)/.test(base)) return true;
  if (/-(parse|source)-\d{8}$/.test(base)) return true;
  return false;
}

async function sha256OfFile(path) {
  const hash = createHash('sha256');
  hash.update(await readFile(path));
  return hash.digest('hex');
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

async function listCourses() {
  const entries = (await readdir(coursesRoot, { withFileTypes: true })).filter(e => e.isDirectory());
  const records = [];
  for (const entry of entries) {
    const courseDir = join(coursesRoot, entry.name);
    const metaPath = join(courseDir, 'textbook', 'course.json');
    const meta = await readJson(metaPath, null);
    if (!meta?.id) continue;
    records.push({ ...meta, folder: entry.name, courseDir });
  }
  return records;
}

// 把旧 URL（形如 .../outputs/<rel> 或 <rel>）规范化为相对 outputs 的新路径。
// 顶层是编译/解析目录（如 slides-<id>/、*-parse-<date>/）时整体归入 .build，
// 使目录内的 PDF/ZIP 与其源文件保持在一起；其余顶层文件按扩展名归入类型子目录。
function rewriteRel(oldRel) {
  if (!oldRel) return oldRel;
  const clean = oldRel.replace(/^outputs\//, '').replace(/^\//, '');
  if (clean.startsWith(`${BUILD_DIR}/`)) return clean;
  const parts = clean.split('/').filter(Boolean);
  if (TYPE_SUBDIRS.has(parts[0])) return clean;
  const top = parts[0];
  if (/^(slides-|quiz-|mindmap-|knowledge-|video-|reading-|selection-|demo-)/.test(top) || /-(parse|source)-\d{8}$/.test(top)) return `${BUILD_DIR}/${clean}`;
  return `${classify(parts[parts.length - 1])}/${clean}`;
}

async function relocateCourseOutputs(courseDir) {
  const outputs = join(courseDir, 'outputs');
  if (!await isDir(outputs)) return;
  for (const type of [...TYPE_SUBDIRS, BUILD_DIR, BUILD_ARTIFACTS]) {
    await (dryRun ? Promise.resolve() : mkdir(join(outputs, type), { recursive: true }));
  }
  const entries = await readdir(outputs, { withFileTypes: true });
  for (const entry of entries) {
    const src = join(outputs, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === BUILD_DIR) continue;
      if (isBuildArtifact(entry.name)) {
        const dst = join(outputs, BUILD_DIR, entry.name);
        log('move', `${entry.name}/ -> ${BUILD_DIR}/${entry.name}/`);
        if (!dryRun && await exists(dst)) { await rm(src, { recursive: true, force: true }); }
        else if (!dryRun) await rename(src, dst);
      }
      continue;
    }
    // 普通文件
    if (entry.name === '.DS_Store') continue;
    if (/^result-.*\.json$/.test(entry.name)) {
      const dst = join(outputs, BUILD_ARTIFACTS, entry.name);
      log('move', `${entry.name} -> ${BUILD_ARTIFACTS}/`);
      if (!dryRun) await rename(src, dst);
      continue;
    }
    const type = classify(entry.name);
    // 下划线成品名改连字符。
    let newName = entry.name;
    if (/_/.test(entry.name) && !isBuildArtifact(entry.name)) newName = entry.name.replace(/_/g, '-');
    const dst = join(outputs, type, newName);
    log(newName !== entry.name ? 'rename+move' : 'move', `${entry.name} -> ${type}/${newName}`);
    if (!dryRun) {
      if (await exists(dst)) {
        // 同名冲突：保留较新者，旧者进 trash。
        const srcMtime = (await stat(src)).mtimeMs;
        const dstMtime = (await stat(dst)).mtimeMs;
        if (srcMtime >= dstMtime) { await rename(src, dst); }
        else {
          const trash = join(trashDir, 'conflicts', courseDir.split(sep).pop());
          await mkdir(trash, { recursive: true });
          await rename(src, join(trash, entry.name));
          log('trash', `${entry.name}（同名较旧，移入 .trash）`);
        }
      } else await rename(src, dst);
    }
  }
}

// 改写 .build/artifacts 与 conversations 里的 URL 到新路径。
async function rewriteUrlsInJson(jsonPath) {
  const value = await readJson(jsonPath, null);
  if (!value || typeof value !== 'object') return;
  let changed = false;
  const fixUrl = (url) => {
    if (typeof url !== 'string' || !url.includes('/outputs/')) return url;
    const idx = url.indexOf('/outputs/');
    const newRel = rewriteRel(url.slice(idx + '/outputs/'.length));
    if (url.slice(idx) !== `/outputs/${newRel}`) { changed = true; return url.slice(0, idx) + `/outputs/${newRel}`; }
    return url;
  };
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object') {
      for (const key of Object.keys(node)) {
        if (['url', 'sourceUrl'].includes(key)) { node[key] = fixUrl(node[key]); }
        else walk(node[key]);
      }
    }
  };
  walk(value);
  if (changed && !dryRun) await writeFile(jsonPath, `${JSON.stringify(value, null, 2)}\n`);
}

async function rewriteCourseUrls(courseDir) {
  const artifactsDir = join(courseDir, 'outputs', BUILD_ARTIFACTS);
  if (await isDir(artifactsDir)) {
    for (const f of await readdir(artifactsDir)) {
      if (f.endsWith('.json')) await rewriteUrlsInJson(join(artifactsDir, f));
    }
  }
  const convDir = join(courseDir, 'conversations');
  if (await isDir(convDir)) {
    for (const f of await readdir(convDir)) {
      if (f.endsWith('.json')) await rewriteUrlsInJson(join(convDir, f));
    }
  }
}

// 递归把 source 的某子目录并入 target 的同名子目录（按 mtime 解决冲突，冲突进 trash）。
async function mergeDir(sourceSub, targetSub, sourceCourse, targetCourse) {
  const stats = { files: 0, trashed: 0 };
  const srcRoot = join(sourceCourse.courseDir, sourceSub);
  if (!await isDir(srcRoot)) return stats;
  const dstRoot = join(targetCourse.courseDir, targetSub);
  await walk(srcRoot);
  return stats;
  async function walk(absDir) {
    for (const entry of await readdir(absDir, { withFileTypes: true })) {
      const abs = join(absDir, entry.name);
      const rel = relative(srcRoot, abs).split(sep).join('/');
      const dst = join(dstRoot, rel);
      if (entry.isDirectory()) { if (!dryRun) await mkdir(dst, { recursive: true }); await walk(abs); }
      else {
        if (await exists(dst)) {
          const srcMtime = (await stat(abs)).mtimeMs;
          const dstMtime = (await stat(dst)).mtimeMs;
          if (srcMtime >= dstMtime) { if (!dryRun) await rename(abs, dst); stats.files++; }
          else {
            const trash = join(trashDir, 'conflicts', targetCourse.folder, rel);
            if (!dryRun) { await mkdir(dirname(trash), { recursive: true }); await rename(abs, trash); }
            stats.trashed++;
          }
        } else { if (!dryRun) { await mkdir(dirname(dst), { recursive: true }); await rename(abs, dst); } stats.files++; }
      }
    }
  }
}

// 把 source 课程的内容并入 target 课程。
async function mergeCourseInto(target, source) {
  const conv = await mergeDir('conversations', 'conversations', source, target);
  const out = await mergeDir('outputs', 'outputs', source, target);
  return { conversations: conv.files, outputs: out.files, trashed: conv.trashed + out.trashed };
}

async function main() {
  console.log(`VeryMath 课程目录迁移 ${dryRun ? '（--dry-run，只打印不改动）' : ''}`);
  console.log(`数据目录：${home}`);
  if (!await isDir(coursesRoot)) { console.log('没有找到 courses 目录，无需迁移。'); return; }

  if (!dryRun) {
    await mkdir(home, { recursive: true });
    console.log(`备份整个数据目录到 ${backupDir} …`);
    await cp(home, backupDir, { recursive: true, dereference: false });
    await mkdir(trashDir, { recursive: true });
    console.log(`备份完成。继续…\n`);
  }

  const records = await listCourses();
  if (!records.length) { console.log('没有可迁移的课程。'); return; }

  // 1) 计算每本书的 sha256，按指纹分组；无指纹的按 slug 分组。
  const groups = new Map();
  for (const record of records) {
    const pdf = join(record.courseDir, 'textbook.pdf');
    const sha = (await exists(pdf)) ? await sha256OfFile(pdf) : '';
    record.sha256 = sha;
    const key = sha || `slug:${slugify(record.title)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  // 2) 每组选保留者：优先 source==='included'，其次 createdAt 最晚；其余并入。
  const keepers = [];
  const toMerge = [];
  for (const group of groups.values()) {
    group.sort((a, b) => {
      const ai = a.source === 'included' ? 0 : 1, bi = b.source === 'included' ? 0 : 1;
      if (ai !== bi) return ai - bi;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
    keepers.push(group[0]);
    for (const extra of group.slice(1)) toMerge.push({ source: extra, target: group[0] });
  }
  console.log(`识别到 ${records.length} 个课程目录，归并为 ${keepers.length} 本书。`);
  for (const { source, target } of toMerge) {
    log('merge', `「${source.folder}」并入「${target.folder}」`);
  }

  // 3) 执行合并。
  for (const { source, target } of toMerge) {
    const result = await mergeCourseInto(target, source);
    console.log(`  合并「${source.folder}」→「${target.folder}」：对话 ${result.conversations}，outputs ${result.outputs}，冲突进 trash ${result.trashed}`);
    if (!dryRun) {
      await rm(source.courseDir, { recursive: true, force: true });
      log('trash', `旧目录「${source.folder}」已并入并删除（原件在备份中）`);
    }
  }

  // 4) 每个保留课程：重排 outputs + 改写 URL + 写 sha256。
  for (const keeper of keepers) {
    console.log(`\n整理「${keeper.folder}」：`);
    await relocateCourseOutputs(keeper.courseDir);
    await rewriteCourseUrls(keeper.courseDir);
    if (keeper.sha256) {
      const metaPath = join(keeper.courseDir, 'textbook', 'course.json');
      const meta = await readJson(metaPath, {});
      if (!meta.sha256) { meta.sha256 = keeper.sha256; if (!dryRun) await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`); log('write', 'course.json sha256'); }
    }
  }

  // 5) 修正 settings.json 里指向被合并目录的 activeCourseId。
  const settingsPath = join(home, 'settings.json');
  const settings = await readJson(settingsPath, {});
  const activeId = settings.activeCourseId;
  if (activeId) {
    const mergedAway = toMerge.some(({ source }) => source.id === activeId);
    if (mergedAway) {
      const target = toMerge.find(({ source }) => source.id === activeId).target;
      if (!dryRun) { settings.activeCourseId = target.id; await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`); }
      log('write', `settings.json activeCourseId -> 「${target.folder}」`);
    }
  }

  const moved = actions.filter(a => a.action === 'move' || a.action === 'rename+move' || a.action === 'merge');
  console.log(`\n完成。${dryRun ? '（dry-run，未改动任何文件）' : `共 ${moved.length} 项移动/合并。备份在 ${backupDir}。`}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
