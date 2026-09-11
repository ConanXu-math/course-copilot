import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CodexClient } from '../server/codex-client.mjs';
import { commandMessages } from '../server/agent-process.mjs';

async function fixture(mode) {
  const directory = await mkdtemp(join(tmpdir(), 'course-agent-stop-'));
  const executable = join(directory, 'fake-agent');
  const output = join(directory, 'output.json');
  const interrupted = join(directory, 'interrupted');
  const started = join(directory, 'started');
  await writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
const readline = require('node:readline');
const config = ${JSON.stringify({ mode, output, interrupted, started })};
const write = () => fs.writeFileSync(config.output, 'agent-final-write');
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
const event = (method, params) => send({ method, params: { threadId: 'thread-1', ...params } });
setInterval(() => {}, 1000);
process.on('SIGTERM', () => setTimeout(() => { write(); process.exit(0); }, 80));
if (config.mode === 'command') {
  send({ type: 'ready' });
  process.stdin.resume();
} else {
  readline.createInterface({ input: process.stdin }).on('line', line => {
    const message = JSON.parse(line);
    if (message.method === 'thread/start') send({ id: message.id, result: { thread: { id: 'thread-1' } } });
    else if (message.method === 'turn/start') {
      fs.writeFileSync(config.started, 'started');
      if (config.mode === 'starting') return;
      send({ id: message.id, result: { turn: { id: 'turn-1' } } });
      event('turn/started', { turn: { id: 'turn-1' } });
      event('item/agentMessage/delta', { itemId: 'message-1', delta: 'ready' });
      if (config.mode === 'normal') setTimeout(() => {
        write(); event('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
      }, 30);
    } else if (message.method === 'turn/interrupt') {
      fs.writeFileSync(config.interrupted, 'interrupted');
      if (config.mode === 'rejected') send({ id: message.id, error: { message: 'cannot interrupt' } });
      else {
        send({ id: message.id, result: {} });
        if (config.mode !== 'timeout') setTimeout(() => {
          write(); event('turn/completed', { turn: { id: 'turn-1', status: 'interrupted' } });
        }, 90);
      }
    } else send({ id: message.id, result: {} });
  });
}
`, { mode: 0o755 });
  return { directory, executable, output, interrupted, started, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

function run(client, signal) {
  return client.runCourse({ instructions: 'test', prompt: 'test', outputsDir: process.cwd() }, signal);
}

async function assertNoLateWrite(output) {
  assert.equal(await readFile(output, 'utf8'), 'agent-final-write');
  await writeFile(output, 'restored-snapshot');
  await delay(130);
  assert.equal(await readFile(output, 'utf8'), 'restored-snapshot', 'no command writes after finalization was allowed to begin');
}

test('Codex interruption waits for turn/completed, not the interrupt acknowledgment', { timeout: 4000 }, async () => {
  const files = await fixture('ack');
  const client = new CodexClient(files.executable, files.directory);
  try {
    const controller = new AbortController();
    const stream = run(client, controller.signal);
    assert.equal((await stream.next()).value.type, 'text');
    controller.abort();
    let returned = false;
    const ending = assert.rejects(stream.next(), error => error.name === 'AbortError').then(() => { returned = true; });
    await delay(25);
    assert.equal(returned, false, 'an accepted interruption is not a terminal event');
    await ending;
    assert.equal(client.closed, false, 'a confirmed interruption keeps the healthy connection');
    await assertNoLateWrite(files.output);
  } finally { client.close(); await client.processEnded; await files.cleanup(); }
});

test('Codex failed interruption waits for the owned process to physically close', { timeout: 4000 }, async () => {
  const files = await fixture('rejected');
  const client = new CodexClient(files.executable, files.directory);
  try {
    const controller = new AbortController();
    const stream = run(client, controller.signal);
    await stream.next();
    controller.abort();
    await assert.rejects(stream.next(), error => error.name === 'AbortError');
    assert.ok(client.process.exitCode !== null || client.process.signalCode !== null);
    await assertNoLateWrite(files.output);
  } finally { client.close(); await client.processEnded; await files.cleanup(); }
});

test('Codex missing terminal event has a bounded fallback even after a successful acknowledgment', { timeout: 9000 }, async () => {
  const files = await fixture('timeout');
  const client = new CodexClient(files.executable, files.directory);
  try {
    const controller = new AbortController();
    const stream = run(client, controller.signal);
    await stream.next();
    controller.abort();
    await assert.rejects(stream.next(), error => error.name === 'AbortError');
    assert.equal(client.closed, true);
    assert.ok(client.process.exitCode !== null || client.process.signalCode !== null);
    await assertNoLateWrite(files.output);
  } finally { client.close(); await client.processEnded; await files.cleanup(); }
});

test('Codex can stop while turn/start is pending and no turn ID is known', { timeout: 4000 }, async () => {
  const files = await fixture('starting');
  const client = new CodexClient(files.executable, files.directory);
  try {
    const controller = new AbortController();
    const stream = run(client, controller.signal);
    const ending = assert.rejects(stream.next(), /断开|关闭/);
    for (let attempt = 0; ; attempt++) {
      try { await readFile(files.started); break; }
      catch (error) { if (error.code !== 'ENOENT' || attempt > 100) throw error; await delay(10); }
    }
    controller.abort();
    await ending;
    assert.ok(client.process.exitCode !== null || client.process.signalCode !== null);
    await assertNoLateWrite(files.output);
  } finally { client.close(); await client.processEnded; await files.cleanup(); }
});

test('normal Codex completion does not request interruption or close its connection', { timeout: 4000 }, async () => {
  const files = await fixture('normal');
  const client = new CodexClient(files.executable, files.directory);
  try {
    const events = [];
    for await (const event of run(client, new AbortController().signal)) events.push(event);
    assert.equal(events.at(-1).type, 'done');
    assert.equal(client.closed, false);
    await assert.rejects(readFile(files.interrupted), { code: 'ENOENT' });
  } finally { client.close(); await client.processEnded; await files.cleanup(); }
});

for (const mode of ['abort', 'return']) {
  test(`commandMessages ${mode} waits for delayed process cleanup before returning`, { timeout: 4000 }, async () => {
    const files = await fixture('command');
    const controller = new AbortController();
    let child;
    try {
      const stream = commandMessages(files.executable, [], files.directory, 'test', controller.signal, process => { child = process; });
      assert.equal((await stream.next()).value.type, 'ready');
      if (mode === 'abort') { controller.abort(); await assert.rejects(stream.next(), error => error.name === 'AbortError'); }
      else await stream.return();
      assert.ok(child.exitCode !== null || child.signalCode !== null);
      await assertNoLateWrite(files.output);
    } finally { await files.cleanup(); }
  });
}
