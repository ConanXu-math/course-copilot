import { EventEmitter } from 'node:events';
import { commandMessages, loginCommand, startProcess, stopProcess } from './agent-process.mjs';
import { courseOpenCodeEnvironment } from './opencode-environment.mjs';

export class OpenCodeClient extends EventEmitter {
  constructor(executable, cwd) {
    super();
    this.executable = executable;
    this.cwd = cwd;
    this.closed = false;
  }

  async initialize() {
    this.env = await courseOpenCodeEnvironment(this.cwd);
    this.process = startProcess(this.executable, ['serve', '--hostname', '127.0.0.1', '--port', '0'], this.cwd, this.env);
    this.process.stdin.end();
    this.process.on('close', () => {
      if (this.closed) return;
      this.closed = true;
      this.emit('closed', new Error('OpenCode 本机服务已关闭，请重新连接。'));
    });
    this.url = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('OpenCode 启动超时，请检查本机安装和配置。')), 20000);
      const read = chunk => {
        output = (output + chunk.toString()).slice(-5000);
        const match = output.match(/https?:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      };
      this.process.stdout.on('data', read);
      this.process.stderr.on('data', read);
      this.process.once('error', error => { clearTimeout(timer); reject(error); });
      this.process.once('close', () => { clearTimeout(timer); reject(new Error('OpenCode 无法启动，请检查程序路径和本机配置。')); });
    });
    const health = await this.request('/global/health');
    if (!health.healthy) throw new Error('OpenCode 服务尚未就绪。');
  }

  async request(path, { method = 'GET', body, cwd = this.cwd, signal } = {}) {
    const url = new URL(path, this.url);
    url.searchParams.set('directory', cwd);
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.OPENCODE_SERVER_PASSWORD) {
      headers.Authorization = `Basic ${Buffer.from(`${process.env.OPENCODE_SERVER_USERNAME || 'opencode'}:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`;
    }
    const timeout = AbortSignal.timeout(20000);
    const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) throw new Error(`OpenCode 请求失败（${response.status}），请检查本机配置。`);
    return response.status === 204 ? undefined : response.json();
  }

  async getInfo() {
    const result = await this.request('/provider');
    const connected = new Set(result.connected);
    const providers = result.all.filter(provider => connected.has(provider.id));
    const models = providers.flatMap(provider => Object.entries(provider.models).filter(([, model]) => model.status !== 'deprecated').map(([id, model]) => ({
      id: `${provider.id}/${id}`, name: `${provider.name} · ${model.name || id}`, isDefault: false,
    })));
    return {
      ready: models.length > 0, signedIn: models.length > 0, models,
      accountLabel: models.length ? `已读取模型配置：${providers.map(provider => provider.name).join('、')}` : '',
    };
  }

  async startLogin() {
    this.login = { loginId: 'opencode-login', manual: true, command: loginCommand(this.executable) };
    return this.login;
  }

  async cancelLogin() { this.login = undefined; }

  close() {
    this.closed = true;
    stopProcess(this.runningProcess);
    stopProcess(this.process);
  }

  async *runCourse({ instructions, prompt, model, courseDir }, signal) {
    signal.throwIfAborted();
    const session = await this.request('/session', { method: 'POST', cwd: courseDir, body: { title: 'VeryMath智慧教材 · 课程学习' } });
    const abort = () => { void this.request(`/session/${session.id}/abort`, { method: 'POST', cwd: courseDir }).catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    let finished = false;
    try {
      signal.throwIfAborted();
      const args = ['run', '--agent', 'course', '--format', 'json', '--attach', this.url, '--dir', courseDir, '--session', session.id];
      if (model) args.push('--model', model);
      const shownParts = new Set();
      const textEvent = part => {
        if (part?.type !== 'text' || !part.text?.trim() || shownParts.has(part.id)) return;
        shownParts.add(part.id);
        return { type: 'text', content: `${part.text}\n\n` };
      };
      for await (const message of commandMessages(this.executable, args, courseDir, `${instructions}\n\n${prompt}`, signal, child => { this.runningProcess = child; }, this.env)) {
        if (message.type === 'text') {
          const event = textEvent(message.part);
          if (event) yield event;
        }
        if (message.type === 'tool_use') yield { type: 'progress', message: 'OpenCode 正在读取或处理课程文件…' };
        if (message.type === 'step_start') yield { type: 'progress', message: 'OpenCode 正在处理课程要求…' };
        if (message.type === 'error') throw new Error(message.error?.data?.message || message.error?.message || 'OpenCode 未完成本次请求。');
      }
      // Attach mode can exit before its event stream delivers the final text.
      // Read the saved messages before deleting this temporary session.
      const messages = await this.request(`/session/${session.id}/message`, { cwd: courseDir, signal });
      const replies = messages.filter(message => message.info.role === 'assistant');
      for (const reply of replies) {
        for (const part of reply.parts) {
          const event = textEvent(part);
          if (event) yield event;
        }
      }
      const finalReply = replies.at(-1);
      const error = finalReply?.info.error;
      if (error) throw new Error(error.data?.message || error.message || 'OpenCode 未完成本次请求。');
      if (finalReply?.info.finish === 'length') throw new Error('OpenCode 的回答达到模型输出上限，尚未讲完，可以继续追问。');
      if (!finalReply?.info.time.completed || finalReply.info.finish !== 'stop') throw new Error('OpenCode 尚未返回完整回答，请重新发送本次问题。');
      if (!finalReply.parts.some(part => part.type === 'text' && part.text?.trim())) throw new Error('OpenCode 结束了处理，但没有给出回答，请重新发送本次问题。');
      signal.throwIfAborted();
      finished = true;
      yield { type: 'done' };
    } finally {
      signal.removeEventListener('abort', abort);
      this.runningProcess = undefined;
      if (!finished) await this.request(`/session/${session.id}/abort`, { method: 'POST', cwd: courseDir }).catch(() => {});
      await this.request(`/session/${session.id}`, { method: 'DELETE', cwd: courseDir }).catch(() => {});
    }
  }
}
