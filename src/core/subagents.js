'use strict';

const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { SESSIONS_DIR, TRANSCRIPTS_DIR } = require('../config');

const READ_TOOLS = Object.freeze([
  'list_dir', 'read_file', 'search_text', 'glob_files', 'file_info',
  'fetch_url', 'fetch', 'fetch_http', 'webfetch', 'scrape_site',
  'web_search', 'web_read', 'load_skill', 'memory', 'git',
]);
const ROLES = Object.freeze({
  explore: Object.freeze({ description: 'Inspect a codebase and report evidence without changing files.', readOnly: true }),
  review: Object.freeze({ description: 'Review code, tests, and risks without changing files.', readOnly: true }),
  plan: Object.freeze({ description: 'Research and propose a concrete plan without making changes.', readOnly: true }),
  general: Object.freeze({ description: 'Complete a scoped task; changes require approval from the parent session.', readOnly: false }),
});
const DEFAULT_MAX_ACTIVE = 3;
const coordinatorBySession = new Map();
const MAX_TASK_LENGTH = 16000;

function quietUI() {
  const noop = () => {};
  return {
    paint: value => String(value),
    startThinkingIndicator: () => noop,
    beginThinkingStream: noop, writeThinkingDelta: noop, endThinkingStream: noop,
    beginAssistantStream: noop, writeAssistantDelta: noop, endAssistantStream: noop,
    logEvent: noop, pushAction: noop, updateLastEventTitle: noop, setTokenUsage: noop, printHistory: noop, printMemory: noop,
  };
}

function snapshot(agent) {
  return {
    agent_id: agent.id,
    role: agent.role,
    task: agent.task,
    status: agent.status,
    started_at: agent.startedAt,
    finished_at: agent.finishedAt || null,
    result: agent.status === 'completed' ? agent.result : null,
    error: agent.status === 'failed' ? agent.error : null,
  };
}

class SubagentCoordinator {
  constructor({ runTurn, maxActive = DEFAULT_MAX_ACTIVE } = {}) {
    this.runTurn = runTurn || ((...args) => require('./agent').runAgentTurn(...args));
    this.maxActive = Math.max(1, Math.min(8, Number(maxActive) || DEFAULT_MAX_ACTIVE));
    this.agents = new Map();
    this.ownerSession = null;
  }

  list() { return [...this.agents.values()].map(snapshot); }

  lookup(id) {
    const entry = this.agents.get(String(id || ''));
    if (!entry) throw new Error('Unknown subagent ID.');
    return entry;
  }

  makeChild(parent, id, role, fork) {
    const now = new Date().toISOString();
    const sessionId = 'subagent-' + id;
    const copy = value => JSON.parse(JSON.stringify(value));
    const child = {
      sessionId,
      sessionPath: path.join(SESSIONS_DIR, sessionId + '.json'),
      transcriptPath: path.join(TRANSCRIPTS_DIR, sessionId + '.jsonl'),
      createdAt: now, updatedAt: now,
      title: 'Subagent: ' + role,
      cwd: parent.cwd || process.cwd(),
      activeModel: parent.activeModel,
      language: parent.language || 'en',
      history: fork === 'all' ? copy(parent.history || []).slice(-40) : [],
      importedMemory: fork === 'all' ? String(parent.importedMemory || '') : '',
      memorySummary: fork === 'all' ? String(parent.memorySummary || '') : '',
      sessionMemory: {}, actionLog: [], turnCount: 0,
      personaPrompt: '', theme: parent.theme || 'dark',
      autoApprove: false, rl: null,
      settings: { ...(parent.settings || {}), planMode: ROLES[role].readOnly ? true : Boolean(parent.settings?.planMode) },
      __subagent: {
        parentSessionId: parent.sessionId,
        role, depth: 1,
        allowedTools: ROLES[role].readOnly ? [...READ_TOOLS] : null,
      },
      tuiConfirm: typeof parent.tuiConfirm === 'function' ? (...args) => parent.tuiConfirm(...args) : async () => false,
    };
    return child;
  }

  startTurn(agent, task) {
    if (agent.status === 'running') throw new Error('Subagent is already running.');
    if (this.list().filter(x => x.status === 'running').length >= this.maxActive) {
      throw new Error('Active subagent limit reached.');
    }
    agent.task = task;
    agent.status = 'running';
    agent.error = null;
    agent.result = null;
    agent.finishedAt = null;
    agent.startedAt = new Date().toISOString();
    agent.controller = new AbortController();
    const { signal } = agent.controller;
    agent.promise = Promise.resolve()
      .then(() => this.runTurn(task, agent.state, quietUI(), { signal }))
      .then(output => {
        if (signal.aborted) {
          agent.status = 'cancelled';
          agent.result = null;
        } else {
          agent.status = 'completed';
          agent.result = String(output?.content ?? '');
        }
      })
      .catch(error => {
        agent.status = signal.aborted ? 'cancelled' : 'failed';
        agent.error = signal.aborted ? null : (error?.message || String(error));
      })
      .finally(() => { agent.finishedAt = new Date().toISOString(); });
    return snapshot(agent);
  }

  spawn(parent, { task, role = 'explore', fork = 'none' } = {}) {
    if (parent?.__subagent) throw new Error('Subagents cannot spawn further subagents.');
    if (!parent?.sessionId) throw new Error('A parent session is required.');
    if (this.ownerSession && this.ownerSession !== parent.sessionId) throw new Error('Subagent session ownership mismatch.');
    if (typeof task !== 'string' || !task.trim() || task.length > MAX_TASK_LENGTH) {
      throw new Error('Task must contain 1 to 16000 characters.');
    }
    if (!Object.hasOwn(ROLES, role)) throw new Error('Unknown subagent role.');
    if (!['none', 'all'].includes(fork)) throw new Error('fork must be none or all.');
    if (this.list().filter(x => x.status === 'running').length >= this.maxActive) {
      throw new Error('Active subagent limit reached.');
    }
    this.ownerSession = parent.sessionId;
    const id = randomUUID();
    const child = this.makeChild(parent, id, role, fork);
    const agent = { id, role, task: '', state: child, status: 'pending', result: null, error: null, startedAt: null, finishedAt: null, controller: null, promise: null };
    this.agents.set(id, agent);
    return this.startTurn(agent, task);
  }

  async wait(id, timeoutMs = 15000) {
    const agent = this.lookup(id);
    const timeout = Math.max(0, Math.min(60000, Number(timeoutMs) || 0));
    if (agent.status === 'running' && timeout > 0) {
      let timer;
      try {
        await Promise.race([
          agent.promise,
          new Promise(resolve => { timer = setTimeout(resolve, timeout);  }),
        ]);
      } finally { if (timer) clearTimeout(timer); }
    }
    return snapshot(agent);
  }

  async followup(id, task) {
    const agent = this.lookup(id);
    if (agent.status === 'running') throw new Error('Wait for the current subagent turn to finish.');
    if (typeof task !== 'string' || !task.trim() || task.length > MAX_TASK_LENGTH) throw new Error('Invalid follow-up task.');
    return this.startTurn(agent, task);
  }

  interrupt(id) {
    const agent = this.lookup(id);
    if (agent.status === 'running') agent.controller.abort();
    return snapshot(agent);
  }

  close(id) {
    const agent = this.lookup(id);
    if (agent.status === 'running') agent.controller.abort();
    this.agents.delete(agent.id);
    return { agent_id: agent.id, closed: true };
  }

  closeAll() {
    for (const agent of this.agents.values()) if (agent.status === 'running') agent.controller.abort();
    this.agents.clear();
  }
}

function getCoordinator(state) {
  const sessionId = String(state?.sessionId || '');
  if (!sessionId) throw new Error('No active session.');
  if (!coordinatorBySession.has(sessionId)) coordinatorBySession.set(sessionId, new SubagentCoordinator());
  return coordinatorBySession.get(sessionId);
}

function closeCoordinators() {
  for (const manager of coordinatorBySession.values()) manager.closeAll();
  coordinatorBySession.clear();
}

module.exports = {
  ROLES, READ_TOOLS, SubagentCoordinator, getCoordinator, closeCoordinators, quietUI,
};
