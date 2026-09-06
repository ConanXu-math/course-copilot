import { EventEmitter } from 'node:events';
import { dirname } from 'node:path';
import { commandMessages, loginCommand, readCommand, startProcess, stopProcess } from './agent-process.mjs';

export class ClaudeClient extends EventEmitter {
  constructor(executable, cwd) {
    super();
    this.executable = executable;
    this.cwd = cwd;
    this.closed = false;
  }

  async initialize() {
    const { stdout } = await readCommand(this.executable, ['--version'], this.cwd);
    if (!stdout.includes('Claude Code')) throw new Error('这个程序不是 Claude Code，请检查路径。');
  }

  async getInfo() {
    let result;
    try { result = await readCommand(this.executable, ['auth', 'status', '--json'], this.cwd); }
    catch (error) {
      if (!error.stdout) throw new Error('无法读取 Claude Code 登录状态，请检查安装或重新连接。');
      result = error;
    }
    const status = JSON.parse(result.stdout);
    return {
      ready: !!status.loggedIn, signedIn: !!status.loggedIn,
      accountLabel: status.loggedIn ? '已使用 Claude Code 的本机账号' : '',
      models: ['fable', 'opus', 'sonnet', 'haiku'].map(id => ({ id, name: id[0].toUpperCase() + id.slice(1), isDefault: false })),
      modelNote: '这些名称由 Claude Code 解析为对应模型，也可跟随它已有的设置。',
    };
  }

  async startLogin() {
    if (this.login) return this.login;
    this.login = { loginId: 'claude-login', command: loginCommand(this.executable) };
    const child = startProcess(this.executable, ['auth', 'login'], this.cwd);
    this.loginProcess = child;
    let output = '';
    const read = chunk => {
      output = (output + chunk.toString()).slice(-16000);
      const url = output.match(/https:\/\/(?:claude\.ai|console\.anthropic\.com|platform\.claude\.com)\/[^\s\u001b]+/);
      if (url && this.login) this.login.authUrl = url[0];
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('error', () => { if (this.login) this.login.manual = true; });
    child.on('close', () => { this.loginProcess = undefined; });
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 1200);
      child.once('close', () => { clearTimeout(timer); resolve(); });
    });
    return this.login;
  }

  async cancelLogin() {
    stopProcess(this.loginProcess);
    this.loginProcess = undefined;
    this.login = undefined;
  }

  close() {
    this.closed = true;
    stopProcess(this.runningProcess);
    void this.cancelLogin();
  }

  async *runCourse({ instructions, prompt, model, courseDir, skill }, signal) {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--no-session-persistence', '--permission-mode', 'acceptEdits', '--append-system-prompt', instructions];
    if (model) args.push('--model', model);
    if (skill) args.push('--add-dir', dirname(skill.path));
    let completed = false;
    let wroteText = false;
    let messageHasText = false;
    try {
      for await (const message of commandMessages(this.executable, args, courseDir, prompt, signal, child => { this.runningProcess = child; })) {
        if (message.parent_tool_use_id) continue;
        if (message.type === 'stream_event') {
          const event = message.event;
          if (event.type === 'message_start') messageHasText = false;
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            if (wroteText && !messageHasText) yield { type: 'text', content: '\n\n' };
            yield { type: 'text', content: event.delta.text };
            wroteText = true; messageHasText = true;
          }
          if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            yield { type: 'progress', message: 'Claude Code 正在读取或处理课程文件…' };
          }
        }
        if (message.type === 'system' && message.subtype === 'api_retry') yield { type: 'progress', message: 'Claude Code 正在重新连接模型服务…' };
        if (message.type === 'result') {
          if (message.is_error) throw new Error(message.result || message.errors?.join('\n') || 'Claude Code 未完成本次请求。');
          if (!wroteText && message.result) yield { type: 'text', content: message.result };
          completed = true;
        }
      }
      if (!completed) throw new Error('Claude Code 已结束，但没有返回完成结果。');
      yield { type: 'done' };
    } finally { this.runningProcess = undefined; }
  }
}
