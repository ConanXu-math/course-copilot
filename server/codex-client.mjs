import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';

// Codex App Server 的标准输入/输出连接。账号和凭据仍由 Codex 自己管理。
export class CodexClient extends EventEmitter {
  constructor(executable, cwd) {
    super();
    this.pending = new Map();
    this.nextId = 1;
    this.closed = false;
    this.stderr = '';
    this.process = spawn(executable, ['app-server', '--listen', 'stdio://'], {
      cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: false,
    });
    this.lines = createInterface({ input: this.process.stdout });
    this.lines.on('line', (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id !== undefined && !message.method) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message || 'Codex 拒绝了这个请求。'));
        else pending.resolve(message.result);
      } else if (message.id !== undefined) {
        // 当前界面不提供终端提权或外部交互工具；将不支持的请求明确退回给 Codex。
        this.send({ id: message.id, error: { code: -32601, message: '课程界面不支持此交互。请在当前课程权限内完成工作，或向用户说明需要在 Codex 中处理的步骤。' } });
        this.emit('notification', { method: 'course/interactionRequired', params: message.params });
      } else {
        this.emit('notification', message);
      }
    });
    this.process.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-2500); });
    this.process.stdin.on('error', error => this.finish(error));
    this.process.on('error', error => this.finish(error));
    this.process.on('close', code => this.finish(new Error(
      code ? `Codex 启动或连接失败（${code}）。${this.stderr.includes('Missing optional dependency') ? '命令行安装缺少组件，请选择桌面应用自带的 Codex 或修复安装。' : '请检查 Codex 安装和本机配置。'}` : 'Codex 连接已关闭。',
    )));
  }

  send(message) {
    if (this.closed || this.process.stdin.destroyed) return;
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params = {}, timeout = 30000) {
    if (this.closed) return Promise.reject(new Error('Codex 连接已关闭，请重新连接。'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex 响应超时（${method}），请检查连接后重试。`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }

  async initialize() {
    await this.request('initialize', {
      clientInfo: { name: 'course_copilot', title: '知页 · 课程 Copilot', version: '0.1.0' },
    });
    this.send({ method: 'initialized' });
  }

  async getInfo() {
    const { account, requiresOpenaiAuth } = await this.request('account/read', { refreshToken: false });
    const models = [];
    let cursor;
    do {
      const page = await this.request('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
      models.push(...page.data.map(item => ({ id: item.model, name: item.displayName, isDefault: item.isDefault })));
      cursor = page.nextCursor;
    } while (cursor);
    return {
      ready: !!account || requiresOpenaiAuth === false, signedIn: !!account, models,
      accountLabel: account ? (account.type === 'chatgpt' ? `ChatGPT · ${account.planType || '已登录'}` : '已使用 Codex 的账号配置') : requiresOpenaiAuth === false ? '使用本机模型服务配置' : '',
    };
  }

  async startLogin() {
    this.login = await this.request('account/login/start', { type: 'chatgpt' });
    return this.login;
  }

  async cancelLogin() {
    if (this.login?.loginId) await this.request('account/login/cancel', { loginId: this.login.loginId });
    this.login = undefined;
  }

  async *runCourse({ instructions, prompt, model, outputsDir, skill }, signal) {
    const input = [{ type: 'text', text: prompt }];
    if (skill) input.push({ type: 'skill', name: skill.id, path: skill.path });
    yield* this.run({
      cwd: outputsDir, ephemeral: true, approvalPolicy: 'never', sandbox: 'workspace-write',
      developerInstructions: instructions, ...(model ? { model } : {}),
    }, input, signal);
  }

  finish(error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.emit('closed', error);
  }

  close() {
    this.finish(new Error('已断开课程工作台与 Codex 的连接。'));
    this.lines.close();
    this.process.stdin.destroy();
    this.process.kill('SIGTERM');
  }

  async *run(params, input, signal) {
    signal.throwIfAborted();
    const { thread } = await this.request('thread/start', params);
    let turnId;
    let wake;
    let complete = false;
    let interrupted = false;
    let messageId;
    const queue = [];
    const push = event => { queue.push(event); wake?.(); };
    const onNotification = ({ method, params: event }) => {
      if (event?.threadId !== thread.id) return;
      if (method === 'turn/started') {
        turnId = event.turn.id;
        if (signal.aborted) stop();
      } else if (method === 'item/agentMessage/delta') {
        if (messageId && event.itemId && messageId !== event.itemId) push({ type: 'text', content: '\n\n' });
        messageId = event.itemId;
        push({ type: 'text', content: event.delta });
      } else if (method === 'item/started') {
        const descriptions = {
          commandExecution: 'Codex 正在处理课程文件…', fileChange: 'Codex 正在保存生成内容…',
          mcpToolCall: 'Codex 正在调用工具…', webSearch: 'Codex 正在查阅资料…',
          reasoning: 'Codex 正在思考…',
        };
        if (descriptions[event.item?.type]) push({ type: 'progress', message: descriptions[event.item.type] });
      } else if (method === 'turn/completed') {
        complete = true;
        push(event.turn.status === 'completed' ? { type: 'done' } : {
          type: 'error', message: event.turn.error?.message || (event.turn.status === 'interrupted' ? 'Codex 已停止。' : 'Codex 未完成这次请求。'),
        });
      } else if (method === 'course/interactionRequired') {
        push({ type: 'progress', message: 'Codex 遇到需要额外交互的步骤，正在尝试其他方法。' });
      }
    };
    const onClose = error => { complete = true; push({ type: 'error', message: error.message }); };
    const stop = () => {
      wake?.();
      if (!turnId || interrupted || complete) return;
      interrupted = true;
      void this.request('turn/interrupt', { threadId: thread.id, turnId }).catch(() => {
        // 如果已无法确认停止，就结束本界面持有的进程，避免任务留在后台继续执行。
        this.close();
      });
    };
    this.on('notification', onNotification);
    this.on('closed', onClose);
    signal.addEventListener('abort', stop, { once: true });
    try {
      signal.throwIfAborted();
      const result = await this.request('turn/start', { threadId: thread.id, input });
      turnId = result.turn.id;
      if (signal.aborted) stop();
      while (!complete || queue.length) {
        signal.throwIfAborted();
        if (!queue.length) await new Promise(resolve => { wake = resolve; });
        wake = undefined;
        signal.throwIfAborted();
        while (queue.length) yield queue.shift();
      }
    } finally {
      if (!complete) stop();
      this.off('notification', onNotification);
      this.off('closed', onClose);
      signal.removeEventListener('abort', stop);
      void this.request('thread/unsubscribe', { threadId: thread.id }).catch(() => {});
    }
  }
}
