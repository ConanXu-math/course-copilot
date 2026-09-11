import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import JSON5 from 'json5';

const modelKeys = ['provider', 'model', 'small_model', 'enabled_providers', 'disabled_providers'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function merge(left, right) {
  return Object.fromEntries([...new Set([...Object.keys(left), ...Object.keys(right)])].map(key => [key,
    object(left[key]) && object(right[key]) ? merge(left[key], right[key]) : key in right ? right[key] : left[key],
  ]));
}

// 模型配置中的相对文件引用仍相对于原配置文件解析。
function fileReferences(value, directory) {
  if (typeof value === 'string') return value.replace(/\{file:([^}]+)\}/g, (_, path) =>
    `{file:${resolve(directory, path.replace(/^~(?=\/|$)/, homedir()))}}`);
  if (Array.isArray(value)) return value.map(item => fileReferences(item, directory));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fileReferences(item, directory)]));
  return value;
}

export async function readOpenCodeModels() {
  const originalConfig = resolve(process.env.XDG_CONFIG_HOME || resolve(homedir(), '.config'), 'opencode');
  const files = ['config.json', 'opencode.json', 'opencode.jsonc'].map(name => resolve(originalConfig, name));
  if (process.env.OPENCODE_CONFIG) files.push(resolve(process.env.OPENCODE_CONFIG));
  let models = {};
  for (const path of files) {
    let content;
    try { content = await readFile(path, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    let config;
    try { config = JSON5.parse(content); }
    catch { throw new Error(`无法读取 OpenCode 配置：${path}，请检查 JSON/JSONC 格式。`); }
    models = merge(models, fileReferences(Object.fromEntries(modelKeys.filter(key => config[key] !== undefined).map(key => [key, config[key]])), dirname(path)));
  }
  if (process.env.OPENCODE_CONFIG_CONTENT) {
    let config;
    try { config = JSON5.parse(process.env.OPENCODE_CONFIG_CONTENT); }
    catch { throw new Error('OPENCODE_CONFIG_CONTENT 格式不正确。'); }
    models = merge(models, Object.fromEntries(modelKeys.filter(key => config[key] !== undefined).map(key => [key, config[key]])));
  }
  return models;
}

export async function courseOpenCodeEnvironment(courseHome) {
  const models = await readOpenCodeModels();
  const configHome = resolve(courseHome, 'agent', 'opencode', 'config');
  await mkdir(resolve(configHome, 'opencode'), { recursive: true, mode: 0o700 });
  const env = { ...process.env };
  for (const key of ['OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG_CONTENT', 'OPENCODE_PERMISSION', 'OPENCODE_PLUGIN_META_FILE']) delete env[key];
  return {
    ...env,
    XDG_CONFIG_HOME: configHome,
    OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
    OPENCODE_DISABLE_CLAUDE_CODE: '1',
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_PURE: '1',
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...models,
      plugin: [],
      default_agent: 'course',
      permission: { skill: 'deny', task: 'deny' },
      agent: { course: {
        mode: 'primary',
        description: '课程学习助手',
        prompt: '你在课程学习界面中工作。遵循本次课程教学要求，直接完成已明确的讲解与资料生成。只读取本次课程明确提供路径的 Skill，不自行搜索或启用个人开发流程。',
        permission: { skill: 'deny', task: 'deny' },
      } },
    }),
  };
}
