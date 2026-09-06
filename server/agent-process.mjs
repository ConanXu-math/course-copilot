import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';

const execute = promisify(execFile);

export async function readCommand(executable, args, cwd) {
  return execute(executable, args, { cwd, timeout: 20000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' });
}

export function startProcess(executable, args, cwd) {
  return spawn(executable, args, {
    cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
  });
}

export function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const stop = signal => {
    try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal); }
    catch { child.kill(signal); }
  };
  stop('SIGTERM');
  const timer = setTimeout(() => stop('SIGKILL'), 2000);
  timer.unref();
  child.once('close', () => clearTimeout(timer));
}

export async function* commandMessages(executable, args, cwd, prompt, signal, onStart) {
  signal.throwIfAborted();
  const child = startProcess(executable, args, cwd);
  onStart?.(child);
  const lines = createInterface({ input: child.stdout });
  let processError;
  child.stderr.on('data', () => {});
  child.stdin.on('error', error => { if (error.code !== 'EPIPE') processError = error; });
  const ended = new Promise(resolve => {
    child.once('error', error => { processError = error; resolve(null); });
    child.once('close', resolve);
  });
  const stop = () => stopProcess(child);
  signal.addEventListener('abort', stop, { once: true });
  child.stdin.end(prompt);
  try {
    for await (const line of lines) {
      signal.throwIfAborted();
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      yield message;
    }
    const code = await ended;
    signal.throwIfAborted();
    if (processError) throw processError;
    if (code !== 0) throw new Error(`Agent 程序已退出（${code}），请检查该 Agent 的登录和模型配置。`);
  } finally {
    signal.removeEventListener('abort', stop);
    lines.close();
    stop();
  }
}

export function loginCommand(executable) {
  return `'${executable.replaceAll("'", "'\\''")}' auth login`;
}
