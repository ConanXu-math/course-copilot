import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ExternalLink, LoaderCircle, Plug, RefreshCw, Unplug } from 'lucide-react';
import { cancelAgentLogin, connectAgent, disconnectAgent, getAgentStatus, saveAgentConfig, startAgentLogin, type AgentProvider, type AgentStatus } from '../lib/skill-client';

interface Props {
  status: AgentStatus | null;
  active: boolean;
  busy: boolean;
  onChange: (status: AgentStatus) => void;
}

const groups = [
  { name: '讲解与问答', owner: '同学 A', ids: ['explain'] },
  { name: '知识结构', owner: '同学 B', ids: ['mindmap', 'knowledge-graph'] },
  { name: '课件与视频', owner: '同学 C', ids: ['slides', 'video'] },
];

export default function AgentConnection({ status, active, busy, onChange }: Props) {
  const [executable, setExecutable] = useState('');
  const [paths, setPaths] = useState<Record<string, string>>({});
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const initialized = useRef(false);
  const locked = !!working || busy || !!status?.busy;
  const agentName = status?.name || 'Agent';
  const provider = status?.config.provider;

  useEffect(() => {
    if (!status || initialized.current) return;
    initialized.current = true;
    setPaths(Object.fromEntries(status.skills.map(skill => [skill.id, skill.path || ''])));
  }, [status]);

  useEffect(() => {
    setExecutable(status?.config.executable || '');
  }, [provider, status?.config.executable]);

  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    getAgentStatus(abort.signal).then(onChange).catch(error => {
      if (!abort.signal.aborted) setError(error.message);
    });
    return () => abort.abort();
  }, [active, onChange]);

  useEffect(() => {
    if (!active || (!status?.login && !status?.busy)) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { onChange(await getAgentStatus(abort.signal)); }
      catch (error) { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : '暂时无法读取登录状态。'); }
      if (!abort.signal.aborted) timer = setTimeout(poll, 2500);
    };
    timer = setTimeout(poll, 1500);
    return () => { abort.abort(); clearTimeout(timer); };
  }, [active, status?.login?.loginId, status?.busy, onChange]);

  async function perform(label: string, action: () => Promise<AgentStatus>, message = '') {
    if (locked) return;
    setWorking(label); setError(''); setNotice('');
    try { onChange(await action()); setNotice(message); }
    catch (error) {
      setError(error instanceof Error ? error.message : '操作未完成，请重试。');
      getAgentStatus().then(onChange).catch(() => {});
    } finally { setWorking(''); }
  }

  const connected = !!status?.connected;
  const installed = !!status?.installed;
  const configured = status?.skills.filter(skill => skill.configured).length || 0;
  const phaseLabel = working === '连接' ? '正在连接' : status?.phase === 'error' ? '连接异常' : connected ? '已连接' : installed ? '等待登录' : '待连接';
  const step = connected ? 3 : installed ? 2 : 1;

  return <div className="agent-setup">
    <ol className="connection-steps" aria-label="Agent 连接步骤">
      {['连接程序', '确认登录', '开始使用'].map((label, index) => <li key={label} className={step >= index + 1 ? 'current' : ''}>
        <span>{step > index + 1 || connected ? <Check size={12}/> : index + 1}</span>{label}
      </li>)}
    </ol>

    <label className="agent-field agent-choice">Coding Agent
      <select aria-label="Coding Agent" value={provider || ''} disabled={locked || !status} onChange={event => {
        const provider = event.target.value as AgentProvider;
        void perform('切换 Agent', () => saveAgentConfig({ provider }), '已切换 Agent，点击连接即可使用。');
      }}>
        {!status && <option value="">正在读取…</option>}
        {status?.providers.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
      </select>
      <small>使用部署这台电脑上的程序和账号；模型与程序位置分别保存。</small>
    </label>

    <section className={`agent-card ${connected ? 'is-connected' : ''}`} aria-label={`${agentName} 连接`}>
      <div className="agent-card-heading">
        <span className="agent-icon"><Plug size={22}/></span>
        <div><h3>{agentName}</h3><p>本机运行 · 使用已有账号</p></div>
        <span className={`agent-phase ${connected ? 'ready' : ''}`}><span className={`status-dot ${connected ? 'online' : ''}`}/>{phaseLabel}</span>
      </div>
      <p className="agent-description">{working === '连接' ? `正在查找可用的 ${agentName}，并读取配置…` : status?.message || '正在读取连接设置…'}</p>

      {installed && <div className="agent-account"><Check size={14}/><span>{status?.accountLabel || '程序已连接，账号尚未登录'}</span></div>}

      <label className="agent-field">使用模型
        <select aria-label="使用模型" value={status?.config.model || ''} disabled={locked || !connected} onChange={event => { const model = event.target.value; void perform('保存模型', () => saveAgentConfig({ model }), '模型已保存，下次提问时生效。'); }}>
          <option value="">跟随 {agentName} 设置</option>
          {status?.config.model && !status.models.some(model => model.id === status.config.model) && <option value={status.config.model} disabled>{status.config.model}{connected ? ' · 当前不可用，请重新选择' : ' · 已保存'}</option>}
          {status?.models.map(model => <option key={model.id} value={model.id}>{model.name}{model.isDefault ? ' · 默认' : ''}</option>)}
        </select>
        <small>{connected ? status?.modelNote || `读取 ${agentName} 的模型配置。` : '连接后可以选择模型。'}</small>
      </label>

      <div className="agent-actions">
        {!installed && <button className="primary-button" disabled={locked || !status} onClick={() => void perform('连接', () => connectAgent(executable))}>
          {working === '连接' ? <LoaderCircle size={16} className="spin"/> : <Plug size={16}/>}{working === '连接' ? '正在连接…' : `连接本机 ${agentName}`}
        </button>}
        {installed && !connected && !status?.signedIn && !status?.login && <button className="primary-button" disabled={locked} onClick={() => void perform('登录', startAgentLogin)}>
          {working === '登录' ? <LoaderCircle size={16} className="spin"/> : <ExternalLink size={16}/>}{provider === 'codex' ? '使用 ChatGPT 登录' : provider === 'claude' ? '登录 Claude Code' : '配置模型服务'}
        </button>}
        {installed && <button className="secondary-button" disabled={locked} onClick={() => void perform('断开', disconnectAgent, `${agentName} 已断开，账号配置仍保留。`)}><Unplug size={15}/>断开连接</button>}
        <button className="agent-refresh" disabled={locked} onClick={() => void perform('刷新', () => getAgentStatus(), '连接状态已更新。')}>
          <RefreshCw size={14} className={working === '刷新' ? 'spin' : ''}/>刷新状态
        </button>
      </div>
      {status?.login && <div className="agent-login" role="status">
        <strong>{status.login.authUrl ? '在浏览器完成登录' : `完成 ${agentName} 配置`}</strong>
        <p>{status.login.authUrl ? '打开登录页面，完成后这里会自动更新。' : '在部署电脑的终端运行下方命令，按 Agent 的提示完成登录，然后刷新状态。'}</p>
        {status.login.authUrl && <a className="primary-button" href={status.login.authUrl} target="_blank" rel="noreferrer">打开登录页面<ExternalLink size={14}/></a>}
        {!status.login.authUrl && status.login.command && <code className="agent-login-command">{status.login.command}</code>}
        <button className="agent-refresh" disabled={locked} onClick={() => void perform('取消登录', cancelAgentLogin)}>{status.login.manual ? '关闭提示' : '取消登录'}</button>
      </div>}
    </section>

    {error && <p className="agent-feedback error" role="alert">{error}</p>}
    {notice && <p className="agent-feedback" role="status">{notice}</p>}
    {busy && <p className="agent-feedback">当前任务结束后，可以更改连接设置。</p>}

    <details className="agent-details">
      <summary>程序位置<span>通常无需填写</span><ChevronDown size={15}/></summary>
      <label className="agent-field">{agentName} 程序路径
        <input value={executable} disabled={locked || installed} onChange={event => setExecutable(event.target.value)} placeholder={`留空，自动查找本机 ${agentName}`} autoComplete="off" spellCheck={false}/>
      </label>
      {installed && <p>正在使用：<code>{status?.executable}</code></p>}
      {status?.note && <p>{status.note}</p>}
      {!installed && <p>可填写完整路径。填写后点击上方“连接本机 {agentName}”。</p>}
    </details>

    <details className="agent-details skill-paths">
      <summary>接入 Skill<span>{configured} / {status?.skills.length || 5} 已配置</span><ChevronDown size={15}/></summary>
      {groups.map(group => <fieldset key={group.name} disabled={locked}>
        <legend>{group.name}<span>{group.owner}</span></legend>
        {group.ids.map(id => {
          const skill = status?.skills.find(item => item.id === id);
          return <label className="agent-field" key={id}><span>{skill?.title || id}<small>{skill?.configured ? '已配置' : '待配置'}</small></span>
            <input value={paths[id] || ''} onChange={event => setPaths(previous => ({ ...previous, [id]: event.target.value }))} placeholder="/你的 Skill 文件夹/SKILL.md" autoComplete="off" spellCheck={false}/>
          </label>;
        })}
      </fieldset>)}
      <button className="secondary-button" disabled={locked || !status} onClick={() => void perform('保存 Skill', () => saveAgentConfig({ skillPaths: paths }), 'Skill 路径已保存。连接 Agent 后即可调用。')}>
        {working === '保存 Skill' ? <LoaderCircle size={15} className="spin"/> : <Check size={15}/>}保存 Skill 路径
      </button>
    </details>
    <p className="agent-footnote">问答、文件处理和 Skill 调用由所选 Agent 执行，页面展示进度与结果。每个人使用自己的 Agent 账号与个人数据目录。</p>
  </div>;
}
