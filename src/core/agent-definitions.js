'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { USER_DATA_ROOT } = require('../config');

const ROOT = path.join(USER_DATA_ROOT, 'agents');
const VALID_NAME = /^[a-z][a-z0-9_-]{1,39}$/;
const ROLES = new Set(['explore', 'review', 'plan', 'general']);
const SAFE_TOOLS = new Set([
  'list_dir','read_file','search_text','glob_files','file_info',
  'fetch_url','fetch','fetch_http','webfetch','scrape_site','web_search','web_read',
  'load_skill','memory','git','run_command','make_dir','write_file','append_file','replace_in_file',
]);

function validateName(name) {
  if (typeof name !== 'string' || !VALID_NAME.test(name)) {
    throw new Error('Agent name must contain 2-40 lowercase letters, digits, - or _, starting with a letter.');
  }
  return name;
}
function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid agent definition.');
  const name = validateName(input.name);
  const role = input.role || 'explore';
  if (!ROLES.has(role)) throw new Error('Unknown agent role.');
  const description = String(input.description || '').trim();
  if (description.length > 240) throw new Error('Agent description must be 240 characters or fewer.');
  const instructions = String(input.instructions || '').trim();
  if (!instructions || instructions.length > 10000) throw new Error('Agent instructions must contain 1-10000 characters.');
  let allowedTools = null;
  if (input.allowedTools !== undefined && input.allowedTools !== null) {
    if (!Array.isArray(input.allowedTools) || input.allowedTools.length > 25 ||
        input.allowedTools.some(x => typeof x !== 'string' || !SAFE_TOOLS.has(x))) {
      throw new Error('Definition contains unsupported tools.');
    }
    allowedTools = [...new Set(input.allowedTools)];
  }
  return { name, role, description, instructions, allowedTools };
}
function filename(name) {
  return path.join(ROOT, validateName(name) + '.json');
}
function defineAgent(input) {
  const record = validate(input);
  fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  const dest = filename(record.name);
  let original;
  try { original = JSON.parse(fs.readFileSync(dest, 'utf8')); } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const stored = {
    ...record,
    createdAt: original?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const temp = dest + '.' + process.pid + '-' + Math.random().toString(36).slice(2) + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, dest);
  } finally {
    try { fs.unlinkSync(temp); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
  return stored;
}
function readAgent(name) {
  let content;
  try { content = fs.readFileSync(filename(name), 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  const decoded = JSON.parse(content);
  const record = validate(decoded);
  return { ...record, createdAt: decoded.createdAt, updatedAt: decoded.updatedAt };
}
function listDefinitions() {
  let filenames;
  try { filenames = fs.readdirSync(ROOT).filter(name => name.endsWith('.json')); }
  catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  return filenames.flatMap(file => {
    if (!VALID_NAME.test(file.slice(0, -5))) return [];
    try { const def = readAgent(file.slice(0, -5)); return def ? [def] : []; } catch { return []; }
  }).sort((a,b) => a.name.localeCompare(b.name));
}
function removeDefinition(name) {
  try { fs.unlinkSync(filename(name)); return true; }
  catch (err) { if (err.code === 'ENOENT') return false; throw err; }
}
module.exports = { defineAgent, readAgent, listDefinitions, removeDefinition, validate, ROOT };
