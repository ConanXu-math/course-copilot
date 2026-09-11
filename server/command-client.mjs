import { EventEmitter } from 'node:events';
import { writeFile, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { startProcess, stopProcess } from './agent-process.mjs';

export class CommandClient extends EventEmitter {
  constructor(executable, cwd, config) {
    super();
    Object.assign(this, { executable, cwd, config, closed: false });
  }
  async initialize() {
    if (!(await stat(this.executable)).isFile()) throw new Error('程序路径必须指向可执行文件。');
  }
  async getInfo() {
    return { ready: !this.closed, signedIn: false, models: [], modelInput: 'manual',
      accountLabel: '程序已找到；实际登录和模型可用性在执行时确认',
      modelNote: '留空使用 Agent 原设置。填写模型时，按下方配置的模型参数传入。' };
  }
  async startLogin() {
    this.login = { loginId: 'cli-login', manual: true };
    return this.login;
  }
  async cancelLogin() { this.login = undefined; }
  close() { this.closed = true; stopProcess(this.process); }

  async *runCourse({ instructions, prompt, model, courseDir, outputsDir }, signal) {
    signal.throwIfAborted();
    const message = `${instructions}\n\n${prompt}`;
    let promptFile;
    let child;
    let ended;
    const stop = () => stopProcess(child);
    try {
      if (this.config.args.some(arg => arg.includes('{promptFile}'))) {
        promptFile = join(outputsDir, `prompt-${randomUUID()}.txt`);
        await writeFile(promptFile, message, { encoding: 'utf8', mode: 0o600 });
      }
      const args = this.config.args.map(arg => arg.replace(/\{(promptFile|prompt|courseDir|outputsDir)\}/g, (_, key) => ({ promptFile, prompt: message, courseDir, outputsDir })[key]));
      if (model) {
        if (!this.config.modelFlag) throw new Error('请配置该命令的模型参数，或将模型留空。');
        args.push(this.config.modelFlag, model);
      }
      signal.throwIfAborted();
      child = startProcess(this.executable, args, courseDir, { ...process.env, NO_COLOR: '1', TERM: 'dumb' });
      this.process = child;
      signal.addEventListener('abort', stop, { once: true });
      let failure;
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
      child.stdin.on('error', error => { if (error.code !== 'EPIPE') failure = error; });
      ended = new Promise(resolve => {
        child.once('error', error => { failure = error; });
        child.once('close', resolve);
      });
      child.stdin.end(this.config.args.some(arg => /\{prompt(?:File)?\}/.test(arg)) ? undefined : message);
      child.stdout.setEncoding('utf8');
      let wroteText = false;
      for await (const chunk of child.stdout) {
        signal.throwIfAborted();
        const content = stripVTControlCharacters(chunk);
        wroteText ||= !!content.trim();
        if (content) yield { type: 'text', content };
      }
      const code = await ended;
      signal.throwIfAborted();
      if (failure) throw failure;
      if (code !== 0) throw new Error(`Agent 命令执行失败（${code}）。${stripVTControlCharacters(stderr).trim() || '请检查参数、登录和模型配置。'}`);
      if (!wroteText) throw new Error('Agent 命令未返回正文，请使用能够输出纯文本的非交互模式。');
      yield { type: 'done' };
    } finally {
      signal.removeEventListener('abort', stop);
      stop();
      // Abort and early iterator return must finish the process before the
      // caller can restore course files or remove the command's prompt file.
      if (ended) await ended;
      this.process = undefined;
      if (promptFile) await rm(promptFile, { force: true });
    }
  }
}
