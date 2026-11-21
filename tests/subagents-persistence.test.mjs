import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'zyn-child-session-'));
process.env.ZYN_DATA_DIR = temp;
const storage = require('../src/utils/sessionStorage');
const { SubagentCoordinator } = require('../src/core/subagents');
const { CURRENT_SESSION_FILE, PERSISTENT_CONFIG_FILE } = require('../src/config');

test('saving child state does not replace parent session or persistent configuration', async () => {
  try {
    const root = await storage.createNewSessionState(null);
    root.cwd = temp;
    root.language = 'es';
    root.autoApprove = true;
    await storage.saveState(root);
    const originalCurrent = await fs.readFile(CURRENT_SESSION_FILE, 'utf8');
    const originalSettings = await fs.readFile(PERSISTENT_CONFIG_FILE, 'utf8');
    let childSessionPath;
    const manager = new SubagentCoordinator({
      runTurn: async (task, state) => {
        childSessionPath = state.sessionPath;
        state.history.push({ role: 'user', content: task });
        await storage.saveState(state);
        return { content: 'done' };
      },
    });
    const task = manager.spawn(root, { task: 'Inspect repository' });
    assert.equal((await manager.wait(task.agent_id, 2000)).status, 'completed');
    assert.equal(await fs.readFile(CURRENT_SESSION_FILE, 'utf8'), originalCurrent);
    assert.equal(await fs.readFile(PERSISTENT_CONFIG_FILE, 'utf8'), originalSettings);
    const child = JSON.parse(await fs.readFile(childSessionPath, 'utf8'));
    assert.equal(child.history[0].content, 'Inspect repository');
    assert.equal(child.autoApprove, false);
    assert.equal(root.history.length, 0);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
