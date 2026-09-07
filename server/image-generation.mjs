import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readOpenCodeModels } from './opencode-environment.mjs';
import { getCoursePaths, outputUrl } from './course-store.mjs';

function fail(status, message) { throw Object.assign(new Error(message), { status }); }

export async function imageProviders() {
  const models = await readOpenCodeModels();
  return Object.entries(models.provider || {})
    .filter(([, provider]) => ['@ai-sdk/openai', '@ai-sdk/openai-compatible'].includes(provider.npm))
    .map(([id, provider]) => ({ id, name: provider.name || id }));
}

async function resolveSetting(value) {
  if (typeof value !== 'string') return value;
  const matches = [...value.matchAll(/\{(env|file):([^}]+)\}/g)];
  for (const [match, kind, name] of matches) {
    const replacement = kind === 'env' ? process.env[name] || '' : (await readFile(name, 'utf8')).trim();
    value = value.replace(match, replacement);
  }
  return value;
}

export async function generateCourseImage(settings, courseId, prompt, signal) {
  if (!settings?.enabled || !settings.provider) fail(409, '文生图尚未启用，请在工作区设置中选择图片服务。');
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 16000) fail(400, '绘图要求不能为空，且不能超过 16000 字符。');
  const models = await readOpenCodeModels();
  const provider = models.provider?.[settings.provider];
  if (!provider || !['@ai-sdk/openai', '@ai-sdk/openai-compatible'].includes(provider.npm)) fail(400, '请选择支持 OpenAI 图片接口的模型服务。');
  const base = await resolveSetting(provider.options?.baseURL) || 'https://api.openai.com/v1';
  let url;
  try { url = new URL(`${base.replace(/\/+$/, '')}/images/generations`); }
  catch { fail(400, '图片服务地址无效，请检查 OpenCode 的模型服务配置。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail(400, '图片服务地址必须为 HTTP 或 HTTPS。');
  let apiKey = await resolveSetting(provider.options?.apiKey);
  if (!apiKey) {
    const authPath = resolve(process.env.XDG_DATA_HOME || resolve(homedir(), '.local/share'), 'opencode', 'auth.json');
    let auth;
    try { auth = JSON.parse(await readFile(authPath, 'utf8'))[settings.provider]; }
    catch (error) { if (error.code !== 'ENOENT') fail(400, '无法读取 OpenCode 已保存的图片服务凭据。'); }
    if (auth?.type === 'api') apiKey = auth.key;
  }
  if (!apiKey && provider.npm === '@ai-sdk/openai') apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) fail(400, '图片服务没有可用的 API Key，请在 OpenCode 中为该服务配置 API 登录。');
  const timeout = AbortSignal.timeout(180000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST', signal: combined, redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: settings.model, prompt, n: 1, size: '1024x1024', output_format: 'png' }),
    });
  } catch {
    if (signal?.aborted) throw signal.reason;
    fail(502, timeout.aborted ? '图片生成超时，请稍后重试。' : '无法连接图片服务，请检查服务地址和网络。');
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 403) fail(403, '图片服务拒绝了请求：请确认当前账号或分组已开通生图权限。模型列表中可见不代表有调用权限。');
    if (response.status === 401) fail(401, '图片服务凭据无效或已过期，请更新 OpenCode 中该服务的登录。');
    if (response.status === 429) fail(429, '图片服务额度不足或请求过于频繁，请检查额度后重试。');
    if (response.status === 404) fail(404, '该服务没有提供图片生成接口或所选图片模型。');
    fail(502, `图片生成失败（服务返回 ${response.status}），请检查图片模型及接口配置。`);
  }
  let data;
  try { data = await response.json(); }
  catch { fail(502, '图片服务没有返回有效的 JSON 结果。'); }
  const encoded = data.data?.[0]?.b64_json;
  if (typeof encoded !== 'string' || !encoded || encoded.length > 40 * 1024 * 1024) fail(502, '图片服务没有返回有效的 base64 图片；当前接入要求 PNG 图片数据。');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47 || bytes.toString('ascii', 12, 16) !== 'IHDR') fail(502, '图片服务返回的内容不是 PNG 图片。');
  combined.throwIfAborted();
  const { outputsDir } = await getCoursePaths(courseId);
  const filename = `image-${randomUUID()}.png`;
  await writeFile(resolve(outputsDir, filename), bytes, { flag: 'wx', mode: 0o600 });
  return { filename, url: outputUrl(courseId, filename), markdown: `![课程示意图](outputs/${filename})`, model: settings.model };
}
