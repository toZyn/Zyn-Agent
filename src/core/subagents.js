'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { USER_DATA_ROOT, TRANSCRIPTS_DIR } = require('../config');
const { readAgent } = require('./agent-definitions');

const READ_TOOLS = Object.freeze([
  'list_dir', 'read_file', 'search_text', 'glob_files', 'file_info',
  'fetch_url', 'fetch', 'fetch_http', 'webfetch', 'scrape_site',
  'web_search', 'web_read', 'load_skill', 'memory', 'git', 'read_agent_messages', 'send_agent_message',
]);
const ROLES = Object.freeze({
  explore: Object.freeze({ description: 'Inspect a codebase and report evidence without changing files.', readOnly: true }),
  review: Object.freeze({ description: 'Review code, tests and risks without changing files.', readOnly: true }),
  plan: Object.freeze({ description: 'Research and propose a concrete plan without changing files.', readOnly: true }),
  general: Object.freeze({ description: 'Complete a scoped task; writes require parent-session approval.', readOnly: false }),
});
const DEFAULT_MAX_ACTIVE = 3;
const MAX_TASK_LENGTH = 16000;
const coordinatorBySession = new Map();
const MUTABLE_TOOLS = new Set(['run_command', 'make_dir', 'write_file', 'append_file', 'replace_in_file']);

function quietUI() {
  const noop = () => {};
  return {
    paint: value => String(value),
    startThinkingIndicator: () => noop,
    beginThinkingStream: noop, writeThinkingDelta: noop, endThinkingStream: noop,
    beginAssistantStream: noop, writeAssistantDelta: noop, endAssistantStream: noop,
    logEvent: noop, pushAction: noop, updateLastEventTitle: noop,
    setTokenUsage: noop, printHistory: noop, printMemory: noop,
  };
}
function snapshot(agent) {
  return {
    agent_id: agent.id,
    role: agent.role,
    definition: agent.definitionName || null,
    task: agent.task,
    status: agent.status,
    started_at: agent.startedAt,
    finished_at: agent.finishedAt || null,
    result: agent.status === 'completed' ? agent.result : null,
    error: agent.status === 'failed' ? agent.error : null,
  };
}
function writeJsonAtomic(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + process.pid + '-' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, file);
  } finally {
    try { fs.unlinkSync(tmp); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
}
function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}
function copyJson(value) { return JSON.parse(JSON.stringify(value)); }

class SubagentCoordinator {
  constructor({ runTurn, maxActive = DEFAULT_MAX_ACTIVE, parent = null, persist = false, dataRoot = USER_DATA_ROOT, autoResume = true } = {}) {
    this.runTurn = runTurn || ((...args) => require('./agent').runAgentTurn(...args));
    this.maxActive = Math.max(1, Math.min(8, Number(maxActive) || DEFAULT_MAX_ACTIVE));
    this.agents = new Map();
    this.mailboxes = new Map();
    this.ownerSession = parent?.sessionId || null;
    this.parent = parent || null;
    this.persist = persist;
    this.autoResume = Boolean(autoResume);
    this.dataRoot = dataRoot;
    this.metadataPath = parent?.sessionId
      ? path.join(dataRoot, 'chat', 'agent-runs', parent.sessionId + '.json')
      : null;
    if (this.persist && parent?.sessionId) this.restore(parent);
  }

  list() { return [...this.agents.values()].map(snapshot); }

  lookup(id) {
    const requested = String(id || '');
    const direct = this.agents.get(requested);
    if (direct) return direct;
    if (/^[a-f0-9-]{8,36}$/.test(requested)) {
      const matches = [...this.agents.values()].filter(agent => agent.id.startsWith(requested));
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) throw new Error('Ambiguous subagent ID prefix.');
    }
    throw new Error('Unknown subagent ID.');
  }

  persistMetadata() {
    if (!this.persist || !this.metadataPath) return;
    writeJsonAtomic(this.metadataPath, {
      version: 1,
      sessionId: this.ownerSession,
      agents: [...this.agents.values()].map(agent => ({
        id: agent.id, role: agent.role, definitionName: agent.definitionName || null,
        task: agent.task, status: agent.status, result: agent.result,
        error: agent.error, startedAt: agent.startedAt, finishedAt: agent.finishedAt,
        instructions: agent.state.__subagent?.instructions || '',
        allowedTools: agent.state.__subagent?.allowedTools || null,
      })),
      mailboxes: Object.fromEntries(this.mailboxes),
    });
  }

  persistChild(agent) {
    if (!this.persist) return;
    const state = agent.state;
    writeJsonAtomic(state.sessionPath, {
      sessionId: state.sessionId, sessionPath: state.sessionPath,
      createdAt: state.createdAt, updatedAt: new Date().toISOString(),
      title: state.title, cwd: state.cwd,
      history: state.history || [], memorySummary: state.memorySummary || '',
      importedMemory: state.importedMemory || '', sessionMemory: state.sessionMemory || {},
      actionLog: state.actionLog || [], turnCount: state.turnCount || 0,
      transcriptPath: state.transcriptPath, activeModel: state.activeModel,
      language: state.language, settings: state.settings, theme: state.theme,
    });
  }

  makeChild(parent, id, role, fork, definition = null) {
    const now = new Date().toISOString();
    const sessionId = 'subagent-' + id;
    const roleTools = ROLES[role].readOnly ? [...READ_TOOLS] : null;
    const definitionTools = definition?.allowedTools || null;
    const allowedTools = definitionTools
      ? definitionTools.filter(tool => !roleTools || roleTools.includes(tool))
      : roleTools;
    const child = {
      sessionId,
      sessionPath: path.join(this.dataRoot, 'chat', 'subagents', sessionId + '.json'),
      transcriptPath: path.join(TRANSCRIPTS_DIR, sessionId + '.jsonl'),
      createdAt: now, updatedAt: now, title: 'Subagent: ' + (definition?.name || role),
      cwd: parent.cwd || process.cwd(),
      activeModel: parent.activeModel, language: parent.language || 'en',
      history: fork === 'all' ? copyJson(parent.history || []).slice(-40) : [],
      importedMemory: fork === 'all' ? String(parent.importedMemory || '') : '',
      memorySummary: fork === 'all' ? String(parent.memorySummary || '') : '',
      sessionMemory: {}, actionLog: [], turnCount: 0,
      personaPrompt: '', theme: parent.theme || 'dark',
      autoApprove: false, rl: null,
      settings: { ...(parent.settings || {}), planMode: ROLES[role].readOnly || Boolean(parent.settings?.planMode) },
      __subagent: {
        parentSessionId: parent.sessionId, agentId: id, role, depth: 1,
        definitionName: definition?.name || null,
        instructions: definition?.instructions || '',
        allowedTools,
      },
      tuiConfirm: (...args) => typeof this.parent?.tuiConfirm === 'function'
        ? this.parent.tuiConfirm(...args)
        : Promise.resolve(false),
    };
    child.getQueuedMessages = () => this.readMessages(id).map(item =>
      'Message from ' + item.from + ': ' + item.content);
    return child;
  }

  restore(parent) {
    const doc = readJsonSafe(this.metadataPath);
    if (!doc || doc.version !== 1 || doc.sessionId !== parent.sessionId) return 0;
    this.ownerSession = parent.sessionId;
    this.parent = parent;
    for (const [recipient, messages] of Object.entries(doc.mailboxes || {})) {
      if (Array.isArray(messages)) this.mailboxes.set(recipient, messages);
    }
    const recovered = [];
    for (const record of doc.agents || []) {
      if (!record || typeof record.id !== 'string' || !/^[a-f0-9-]{36}$/.test(record.id) || !Object.hasOwn(ROLES, record.role)) continue;
      const child = this.makeChild(parent, record.id, record.role, 'none');
      const saved = readJsonSafe(child.sessionPath);
      if (saved) {
        for (const key of ['history','memorySummary','importedMemory','sessionMemory','actionLog','turnCount','activeModel','language','cwd','createdAt','updatedAt']) {
          if (Object.hasOwn(saved, key)) child[key] = saved[key];
        }
      }
      child.__subagent.instructions = typeof record.instructions === 'string' ? record.instructions : '';
      child.__subagent.allowedTools = Array.isArray(record.allowedTools) ? [...record.allowedTools] : (ROLES[record.role].readOnly ? [...READ_TOOLS] : null);
      child.__subagent.definitionName = record.definitionName || null;
      child.autoApprove = false;
      child.settings.planMode = ROLES[record.role].readOnly || Boolean(child.settings.planMode);
      const status = record.status === 'running' ? 'interrupted' : record.status;
      const agent = {
        id: record.id, role: record.role, definitionName: record.definitionName || null,
        state: child, task: String(record.task || ''), status,
        result: record.result || null, error: record.error || null,
        startedAt: record.startedAt || null, finishedAt: record.finishedAt || null,
        controller: null, promise: null,
      };
      this.agents.set(agent.id, agent);
      if (status === 'interrupted' && ROLES[agent.role].readOnly) recovered.push(agent);
    }
    this.persistMetadata();
    if (this.autoResume) {
      for (const agent of recovered.slice(0, this.maxActive)) {
        if (agent.task) this.startTurn(agent, agent.task, true);
      }
    }
    return recovered.length;
  }

  startTurn(agent, task, recovering = false) {
    if (agent.status === 'running' || agent.promisePending) throw new Error('Subagent is still running or cancelling.');
    if ([...this.agents.values()].filter(item => item.status === 'running' || item.promisePending).length >= this.maxActive) {
      throw new Error('Active subagent limit reached.');
    }
    agent.task = task;
    agent.status = 'running';
    agent.error = null;
    agent.result = null;
    agent.finishedAt = null;
    agent.startedAt = new Date().toISOString();
    agent.controller = new AbortController();
    agent.stoppingForRestart = false;
    agent.promisePending = true;
    const { signal } = agent.controller;
    this.persistChild(agent);
    this.persistMetadata();
    const prompt = recovering
      ? 'Resume the previously interrupted read-only task. Review the existing child conversation and avoid repeating completed work. Task: ' + task
      : task;
    agent.promise = Promise.resolve()
      .then(() => this.runTurn(prompt, agent.state, quietUI(), { signal }))
      .then(output => {
        agent.status = signal.aborted ? (agent.stoppingForRestart ? 'interrupted' : 'cancelled') : 'completed';
        agent.result = signal.aborted ? null : String(output?.content ?? '');
      })
      .catch(error => {
        agent.status = signal.aborted ? (agent.stoppingForRestart ? 'interrupted' : 'cancelled') : 'failed';
        agent.error = signal.aborted ? null : (error?.message || String(error));
      })
      .finally(() => {
        agent.promisePending = false;
        agent.finishedAt = new Date().toISOString();
        this.persistChild(agent);
        this.persistMetadata();
      });
    return snapshot(agent);
  }

  spawn(parent, { task, role = 'explore', fork = 'none', definition = null } = {}) {
    if (parent?.__subagent) throw new Error('Subagents cannot spawn further subagents.');
    if (!parent?.sessionId) throw new Error('A parent session is required.');
    if (this.ownerSession && this.ownerSession !== parent.sessionId) throw new Error('Subagent session ownership mismatch.');
    if (typeof task !== 'string' || !task.trim() || task.length > MAX_TASK_LENGTH) throw new Error('Task must contain 1 to 16000 characters.');
    const custom = definition ? readAgent(definition) : null;
    if (definition && !custom) throw new Error('Unknown saved agent definition.');
    if (custom) role = custom.role;
    if (!Object.hasOwn(ROLES, role)) throw new Error('Unknown subagent role.');
    if (!['none', 'all'].includes(fork)) throw new Error('fork must be none or all.');
    this.ownerSession = parent.sessionId;
    this.parent = parent;
    const id = randomUUID();
    const child = this.makeChild(parent, id, role, fork, custom);
    const agent = {
      id, role, definitionName: custom?.name || null,
      task: '', state: child, status: 'pending', result: null, error: null,
      startedAt: null, finishedAt: null, controller: null, promise: null,
    };
    this.agents.set(id, agent);
    try { return this.startTurn(agent, task); }
    catch (error) { this.agents.delete(id); throw error; }
  }

  async wait(id, timeoutMs = 15000) {
    const agent = this.lookup(id);
    const timeout = Math.max(0, Math.min(60000, Number(timeoutMs) || 0));
    if (agent.status === 'running' && timeout > 0) {
      let timer;
      try {
        await Promise.race([
          agent.promise,
          new Promise(resolve => { timer = setTimeout(resolve, timeout); }),
        ]);
      } finally { if (timer) clearTimeout(timer); }
    }
    return snapshot(agent);
  }

  async followup(id, task) {
    const agent = this.lookup(id);
    if (agent.status === 'interrupted' && agent.role === 'general') {
      throw new Error('Interrupted writable agents must use resume_agent with explicit user approval.');
    }
    if (agent.status === 'running' || agent.promisePending) throw new Error('Wait for the current subagent turn to finish.');
    if (typeof task !== 'string' || !task.trim() || task.length > MAX_TASK_LENGTH) throw new Error('Invalid follow-up task.');
    return this.startTurn(agent, task);
  }

  resume(id) {
    const agent = this.lookup(id);
    if (!['interrupted','cancelled','failed'].includes(agent.status)) throw new Error('Only interrupted or stopped agents can be resumed.');
    return this.startTurn(agent, agent.task, true);
  }

  interrupt(id) {
    const agent = this.lookup(id);
    if (agent.status === 'running') {
      agent.status = 'cancelled';
      agent.controller.abort();
      this.persistMetadata();
    }
    return snapshot(agent);
  }

  close(id) {
    const agent = this.lookup(id);
    if (agent.status === 'running') agent.controller.abort();
    this.agents.delete(agent.id);
    this.persistMetadata();
    return { agent_id: agent.id, closed: true };
  }

  sendMessage(from, to, content) {
    let sender = 'parent';
    let recipient = 'parent';
    if (from !== 'parent') {
      try { sender = this.lookup(from).id; }
      catch { throw new Error('Unknown sender.'); }
    }
    if (to !== 'parent') {
      try { recipient = this.lookup(to).id; }
      catch { throw new Error('Unknown recipient agent.'); }
    }
    const text = String(content || '').trim();
    if (!text || text.length > 16000) throw new Error('Message must contain 1 to 16000 characters.');
    const message = { message_id: randomUUID(), from: sender, to: recipient, content: text, at: new Date().toISOString() };
    const list = this.mailboxes.get(recipient) || [];
    list.push(message);
    this.mailboxes.set(recipient, list);
    this.persistMetadata();
    return { message_id: message.message_id, delivered: true, recipient };
  }

  readMessages(recipient = 'parent') {
    const id = String(recipient);
    const messages = this.mailboxes.get(id) || [];
    this.mailboxes.delete(id);
    if (messages.length) this.persistMetadata();
    return [...messages];
  }

  closeAll() {
    for (const agent of this.agents.values()) {
      if (agent.status === 'running') {
        agent.stoppingForRestart = true;
        agent.status = 'interrupted';
        agent.controller.abort();
      }
    }
    this.persistMetadata();
    if (!this.persist) this.agents.clear();
  }
}

function getCoordinator(state) {
  const parentSessionId = String(state?.__subagent?.parentSessionId || state?.sessionId || '');
  if (!parentSessionId) throw new Error('No active session.');
  if (!coordinatorBySession.has(parentSessionId)) {
    coordinatorBySession.set(parentSessionId, new SubagentCoordinator({
      parent: state?.__subagent ? { sessionId: parentSessionId } : state, persist: true,
      autoResume: !state?.__subagent,
    }));
  }
  const coordinator = coordinatorBySession.get(parentSessionId);
  if (!state?.__subagent) coordinator.parent = state;
  return coordinator;
}

function closeCoordinators() {
  for (const manager of coordinatorBySession.values()) manager.closeAll();
  coordinatorBySession.clear();
}

module.exports = { ROLES, READ_TOOLS, MUTABLE_TOOLS, SubagentCoordinator, getCoordinator, closeCoordinators, quietUI };
