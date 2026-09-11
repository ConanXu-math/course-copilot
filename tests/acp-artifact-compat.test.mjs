import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, test } from 'node:test';
import { AcpClient } from '../server/acp-client.mjs';
import { CommandClient } from '../server/command-client.mjs';
import { knowledgeGraph } from './fixtures/knowledge-graph-v2.mjs';

let storageHome, store, agent;
const previousHome = process.env.COURSE_COPILOT_HOME;
before(async () => {
  storageHome = await mkdtemp(join(tmpdir(), 'course-acp-compat-'));
  process.env.COURSE_COPILOT_HOME = storageHome;
  store = await import('../server/course-store.mjs');
  agent = await import('../server/agent.mjs');
});
after(async () => {
  agent?.disposeAgent();
  if (previousHome === undefined) delete process.env.COURSE_COPILOT_HOME;
  else process.env.COURSE_COPILOT_HOME = previousHome;
  if (storageHome) await rm(storageHome, { recursive: true, force: true });
});

async function fakeAgent(mode) {
  const directory = await mkdtemp(join(tmpdir(), 'fake-course-acp-'));
  const executable = join(directory, 'fake-agent');
  const config = {
    mode, output: join(directory, 'last-write'), started: join(directory, 'session-started'),
    stopped: join(directory, 'stopped'), prompt: join(directory, 'prompt.txt'),
    graph: knowledgeGraph('will-use-request-id'),
  };
  await writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
const readline = require('node:readline');
const config = ${JSON.stringify(config)};
let terminating = false;
let sessionCount = 0;
setInterval(() => {}, 1000);
process.stdout.on('error', () => {});
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\\n');
process.on('SIGTERM', () => {
  if (terminating) return;
  terminating = true;
  setTimeout(() => {
    fs.writeFileSync(config.output, 'agent-final-write');
    fs.writeFileSync(config.stopped, 'stopped');
    process.exit(0);
  }, 100);
});
if (config.mode === 'command') {
  process.stdout.write('ready\\n');
  process.stdin.resume();
} else {
  readline.createInterface({ input: process.stdin }).on('line', line => {
    const request = JSON.parse(line);
    const reply = result => send({ id: request.id, result });
    if (request.method === 'initialize') reply({
      protocolVersion: request.params.protocolVersion, agentCapabilities: {},
      authMethods: [], agentInfo: { name: 'fixture', version: '1.0.0' },
    });
    else if (request.method === 'session/new') {
      fs.writeFileSync(config.started, 'started');
      if (config.mode !== 'starting') reply({ sessionId: 'session-' + (++sessionCount) });
    } else if (request.method === 'session/prompt') {
      const text = request.params.prompt.filter(item => item.type === 'text').map(item => item.text).join('\\n');
      fs.writeFileSync(config.prompt, text);
      send({ method: 'session/update', params: { sessionId: request.params.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ready' } } } });
      if (config.mode === 'valid' || config.mode === 'invalid') setTimeout(() => {
        const match = text.match(/界面展示内容写入 (.+?)（UTF-8 JSON 对象，id 为 ([^，]+)，/);
        const graph = { ...config.graph, id: match[2] };
        if (config.mode === 'invalid') graph.edges[0].evidence = [];
        fs.writeFileSync(match[1], JSON.stringify(graph));
        reply({ stopReason: 'end_turn' });
      }, 20);
    } else if (request.id !== undefined) reply({});
  });
}
`, { mode: 0o755 });
  return { directory, executable, ...config, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

async function waitFor(path) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try { return await readFile(path, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await delay(10);
  }
  assert.fail(`fixture did not write ${path}`);
}

function run(client, files, signal) {
  return client.runCourse({ instructions: 'fixture', prompt: 'fixture', courseDir: files.directory, outputsDir: files.directory }, signal);
}

async function assertNoLateWrite(files) {
  assert.equal(await readFile(files.output, 'utf8'), 'agent-final-write');
  await writeFile(files.output, 'restored-snapshot');
  await delay(160);
  assert.equal(await readFile(files.output, 'utf8'), 'restored-snapshot');
}

test('ACP cancellation waits for physical process close before allowing snapshot restoration', { timeout: 5000 }, async () => {
  const files = await fakeAgent('running');
  const client = new AcpClient(files.executable, files.directory, { name: 'fixture', args: [] });
  try {
    await client.initialize();
    const controller = new AbortController();
    const stream = run(client, files, controller.signal);
    assert.equal((await stream.next()).value.type, 'text');
    controller.abort();
    await assert.rejects(stream.next(), error => error.name === 'AbortError');
    assert.ok(client.process.exitCode !== null || client.process.signalCode !== null);
    await assertNoLateWrite(files);
  } finally { client.close(); await client.processEnded; await files.cleanup(); }
});

test('ACP cancellation during session creation also stops the owned process before returning', { timeout: 5000 }, async () => {
  const files = await fakeAgent('starting');
  const client = new AcpClient(files.executable, files.directory, { name: 'fixture', args: [] });
  try {
    await client.initialize();
    const controller = new AbortController();
    const stream = run(client, files, controller.signal);
    const stopped = assert.rejects(stream.next(), error => error.name === 'AbortError');
    await waitFor(files.started);
    controller.abort();
    await stopped;
    assert.equal(client.closed, true);
    await assertNoLateWrite(files);
  } finally { client.close(); await client.processEnded; await files.cleanup(); }
});

test('early ACP iterator return cannot release the saver while a prompt is still writing', { timeout: 5000 }, async () => {
  const files = await fakeAgent('running');
  const client = new AcpClient(files.executable, files.directory, { name: 'fixture', args: [] });
  try {
    await client.initialize();
    const stream = run(client, files, new AbortController().signal);
    await stream.next();
    await stream.return();
    await assertNoLateWrite(files);
  } finally { client.close(); await client.processEnded; await files.cleanup(); }
});

test('custom command cancellation and early return wait for the final file write', { timeout: 5000 }, async () => {
  for (const mode of ['cancel', 'return']) {
    const files = await fakeAgent('command');
    const client = new CommandClient(files.executable, files.directory, { args: [] });
    try {
      await client.initialize();
      const controller = new AbortController();
      const stream = run(client, files, controller.signal);
      await stream.next();
      if (mode === 'cancel') {
        controller.abort();
        await assert.rejects(stream.next(), error => error.name === 'AbortError');
      } else await stream.return();
      await assertNoLateWrite(files);
    } finally { client.close(); await files.cleanup(); }
  }
});

test('ACP-generated graphs use pending files, authoritative source and v2 validation end to end', { timeout: 10000 }, async () => {
  for (const mode of ['valid', 'invalid']) {
    const files = await fakeAgent(mode);
    const course = await store.importCourse(Readable.from([Buffer.from('%PDF-1.4\nACP fixture\n%%EOF')]), `acp-${randomUUID()}.pdf`);
    const chapter = { id: 'chapter-1', title: '第一章', page: 1, level: 0 };
    const section = { id: 'section-1-2', title: '1.2', page: 12, level: 1 };
    await store.updateTextbook(course.id, { totalPages: 60, chapters: [chapter, section] });
    const request = { skillId: 'knowledge-graph', book: course, page: 15, chapter: section,
      scope: 'section', knowledgeGraphDetail: 'detailed', prompt: '生成图谱', pageText: '', selectedText: '', history: [] };
    const save = await store.createGeneratedArtifactSaver(course.id, request);
    try {
      const status = await agent.connectAgent({ provider: 'custom', mode: 'acp', executable: files.executable, args: [] });
      assert.equal(status.connected, true);
      const artifacts = [];
      let completed = false;
      const generate = async () => {
        for await (const event of agent.codingAgent(request, {
          ...(await store.getCoursePaths(course.id)), ...save.knowledgeGraphContext,
          signal: new AbortController().signal, skills: status.skills.filter(skill => skill.configured),
        })) {
          if (event.type === 'artifact') artifacts.push(await save(event.artifact));
          if (event.type === 'done') completed = true;
        }
      };
      if (mode === 'invalid') await assert.rejects(generate(), /evidence|证据|依据/i);
      else await generate();
      await save.finalize();
      const prompt = await readFile(files.prompt, 'utf8');
      assert.match(prompt, /pending-[a-f0-9-]+\.json/);
      assert.match(prompt, /schemaVersion:2/);
      assert.match(prompt, /知识图谱深度：detailed/);
      assert.equal(completed, mode === 'valid');
      if (mode === 'valid') {
        assert.equal(artifacts.length, 1);
        assert.deepEqual(artifacts[0].source, { scope: 'section', page: 15, chapterId: chapter.id, sectionId: section.id });
        assert.deepEqual(artifacts[0].edges, files.graph.edges);
      }
      assert.deepEqual((await store.getState(course.id)).artifacts, artifacts);
    } finally {
      save.dispose();
      agent.disposeAgent();
      await waitFor(files.stopped);
      await files.cleanup();
    }
  }
});
