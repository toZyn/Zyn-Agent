const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const gitExec = promisify(execFile);
const { parseDocument } = require('yaml');
const { DATA_ROOT, USER_DATA_ROOT } = require('../config');

const SKILLS_DIR = path.join(USER_DATA_ROOT, 'skills');
const LEGACY_DIR = path.join(DATA_ROOT, 'skills');
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_TEXT = 131072;
const MAX_INSTALL_BYTES = 5 * 1024 * 1024;
const MAX_INSTALL_FILES = 128;

function parseFrontmatter(raw) {
  const matched = String(raw || '').match(FRONTMATTER_RE);
  if (!matched) return { meta: {}, body: String(raw || '').trim() };
  const document = parseDocument(matched[1], { maxAliasCount: 20, uniqueKeys: true });
  if (document.errors.length) throw new Error(`Invalid skill YAML: ${document.errors[0].message}`);
  const meta = document.toJS() || {};
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('Invalid skill frontmatter');
  return { meta, body: matched[2].trim() };
}

function validName(name) {
  return typeof name === 'string' && name.length <= 64 && NAME_RE.test(name);
}

function roots(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const home = path.resolve(options.home || os.homedir());
  const legacy = path.resolve(options.legacyDir || LEGACY_DIR);
  const project = [];
  let ancestor = cwd;
  for (let i = 0; i < 16; i++) {
    for (const name of ['.agents', '.claude', '.qwen', '.zyn']) project.push(path.join(ancestor, name, 'skills'));
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  return [...new Set([...project, ...(options.home ? [] : [SKILLS_DIR]), ...['.agents', '.claude', '.qwen'].map(v => path.join(home, v, 'skills')), path.join(home, '.zyn', 'skills'), legacy])];
}

function inside(parent, target) {
  const relative = path.relative(parent, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function resourceFiles(folder) {
  const found = [];
  const scan = (dir, depth) => {
    if (depth > 5 || found.length >= MAX_INSTALL_FILES) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (ent.isSymbolicLink()) continue;
      const absolute = path.join(dir, ent.name);
      const relative = path.relative(folder, absolute).split(path.sep).join('/');
      if (ent.isDirectory()) scan(absolute, depth + 1);
      else if (ent.isFile() && relative !== 'SKILL.md') found.push(relative);
      if (found.length >= MAX_INSTALL_FILES) break;
    }
  };
  scan(folder, 0);
  return found.sort();
}

function readSkillFolder(folder) {
  const main = path.join(folder, 'SKILL.md');
  try {
    if (!fs.statSync(main).isFile()) return null;
    if (!inside(fs.realpathSync(folder), fs.realpathSync(main))) return null;
    if (fs.statSync(main).size > MAX_TEXT) return null;
    const { meta, body } = parseFrontmatter(fs.readFileSync(main, 'utf8'));
    if (!validName(meta.name) || typeof meta.description !== 'string' || !meta.description.trim() || meta.description.length > 1024) return null;
    return {
      name: meta.name,
      description: meta.description,
      title: body.split('\n').find(v => v.startsWith('# '))?.replace(/^#+\s*/, '') || meta.name,
      body,
      meta,
      folder,
      resources: resourceFiles(folder),
    };
  } catch { return null; }
}

function discoverSkills(options = {}) {
  const found = new Map();
  for (const root of roots(options)) {
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const item of entries) {
      if (!item.isDirectory() && !item.isSymbolicLink()) continue;
      const folder = path.join(root, item.name);
      const skill = readSkillFolder(folder);
      if (skill && !found.has(skill.name)) found.set(skill.name, skill);
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function listSkillFolders(options = {}) { return discoverSkills(options).map(skill => skill.name); }
function listSkills(options = {}) {
  return discoverSkills(options).map(({ name, title, description, resources, folder }) => ({ name, title, description, resources, folder }));
}
function loadAllSkills(options = {}) { return listSkillFolders(options); }
function loadSkill(name, options = {}) {
  if (!validName(name)) return null;
  return discoverSkills(options).find(skill => skill.name === name) || null;
}
function readSkillResource(name, resource, options = {}) {
  const skill = loadSkill(name, options);
  if (!skill) throw new Error('Skill not found');
  if (!resource || path.isAbsolute(resource) || resource.includes('\\') || resource.split('/').some(part => part === '..' || part === '.' || !part)) throw new Error('Invalid resource path');
  if (resource === 'SKILL.md') return skill.body;
  if (!skill.resources.includes(resource)) throw new Error('Resource outside skill or not found');
  const filename = path.resolve(skill.folder, resource);
  if (!inside(fs.realpathSync(skill.folder), fs.realpathSync(filename))) throw new Error('Resource outside skill');
  const stat = fs.statSync(filename);
  if (stat.size > MAX_TEXT) throw new Error('Skill resource too large');
  if (!/\.(md|txt|json|ya?ml|js|mjs|cjs|py|sh|ts|toml|csv|xml|html|css|sql)$/i.test(resource)) throw new Error('Binary asset; use file tools');
  return fs.readFileSync(filename, 'utf8');
}

function parseGitHubLocation(input) {
  const text = String(input || '').trim();
  let segments = [];
  let ref;
  if (/^https:\/\/github\.com\//i.test(text)) {
    const url = new URL(text);
    segments = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (segments[2] === 'tree') { ref = segments[3]; segments = [segments[0], segments[1], ...segments.slice(4)]; }
    if (segments[2] === 'blob') throw new Error('Use a skill directory, not a file URL');
  } else segments = text.split('/');
  const [owner, repoRaw, ...rest] = segments;
  const repo = repoRaw?.replace(/\.git$/, '');
  if (![owner, repo].every(v => /^[\w.-]+$/.test(v || '')) || rest.some(v => !/^[\w.-]+$/.test(v) || v === '..')) throw new Error('Invalid GitHub repository path');
  return { owner, repo, subpath: rest.join('/'), ref };
}

async function collectSkillViaGit({ owner, repo, subpath, ref }) {
  const staging = await fsp.mkdtemp(path.join(os.tmpdir(), 'zyn-skill-git-'));
  const checkout = path.join(staging, 'checkout');
  const run = (args) => gitExec('git', args, { timeout: 120000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  try {
    const cloneArgs = ['clone', '--no-tags', '--depth', '1', '--filter=blob:none', '--sparse'];
    if (ref) cloneArgs.push('--branch', ref);
    cloneArgs.push(`https://github.com/${owner}/${repo}.git`, checkout);
    await run(cloneArgs);
    if (subpath) await run(['-C', checkout, 'sparse-checkout', 'set', '--', subpath]);
    else await run(['-C', checkout, 'sparse-checkout', 'disable']);
    const source = path.resolve(checkout, subpath);
    if (!inside(checkout, source) || !fs.statSync(source).isDirectory()) throw new Error('Skill directory not found');
    const files = [];
    let bytes = 0;
    const scan = (folder, prefix = '', depth = 0) => {
      if (depth > 8) throw new Error('Skill directory nesting limit exceeded');
      for (const ent of fs.readdirSync(folder, { withFileTypes: true })) {
        if (ent.isSymbolicLink() || ent.name === '.git') continue;
        const filename = path.join(folder, ent.name);
        const relative = prefix ? `${prefix}/${ent.name}` : ent.name;
        if (ent.isDirectory()) scan(filename, relative, depth + 1);
        else if (ent.isFile()) {
          const stat = fs.statSync(filename);
          if (stat.size > MAX_INSTALL_BYTES || bytes + stat.size > MAX_INSTALL_BYTES) throw new Error('Skill exceeds size limit');
          if (files.length >= MAX_INSTALL_FILES) throw new Error('Too many files in skill');
          const content = fs.readFileSync(filename);
          files.push({ path: relative, content });
          bytes += content.length;
        }
      }
    };
    scan(source);
    return files;
  } finally { await fsp.rm(staging, { recursive: true, force: true }); }
}

async function installSkill(location, customName = null, options = {}) {
  const { owner, repo, subpath, ref } = parseGitHubLocation(location);
  const fetcher = options.fetch || fetch;
  const api = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents`;
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const collected = [];
  let bytes = 0;
  const visit = async (remote, relative = '') => {
    const response = await fetcher(`${api}/${remote.split('/').filter(Boolean).map(encodeURIComponent).join('/')}${query}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'zyn-agent' } });
    if (!response.ok) throw new Error(`GitHub download failed: ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Expected a skill directory');
    for (const item of data) {
      if (collected.length >= MAX_INSTALL_FILES) throw new Error('Too many files in skill');
      if (!item.name || item.name === '.' || item.name === '..' || item.name.includes('/') || item.name.includes('\\')) throw new Error('Unsafe file path');
      const child = relative ? `${relative}/${item.name}` : item.name;
      if (item.type === 'dir') await visit(remote ? `${remote}/${item.name}` : item.name, child);
      else if (item.type === 'file') {
        if (item.size > MAX_INSTALL_BYTES || bytes + item.size > MAX_INSTALL_BYTES) throw new Error('Skill exceeds size limit');
        const resource = await fetcher(item.download_url, { headers: { 'User-Agent': 'zyn-agent' } });
        if (!resource.ok) throw new Error(`Failed to download resource ${child}`);
        const data = Buffer.from(await resource.arrayBuffer());
        bytes += data.length;
        if (bytes > MAX_INSTALL_BYTES) throw new Error('Skill exceeds size limit');
        collected.push({ path: child, content: data });
      }
    }
  };
  try {
    await visit(subpath);
  } catch (error) {
    if (options.fetch && !options.clone) throw error;
    const replacement = await (options.clone || collectSkillViaGit)({ owner, repo, subpath, ref });
    if (!Array.isArray(replacement) || replacement.length > MAX_INSTALL_FILES) throw new Error('Invalid skill directory download');
    const totalBytes = replacement.reduce((sum, file) => sum + (Buffer.isBuffer(file.content) ? file.content.length : Buffer.byteLength(String(file.content))), 0);
    if (totalBytes > MAX_INSTALL_BYTES) throw new Error('Skill exceeds size limit');
    collected.length = 0;
    for (const file of replacement) {
      if (!file.path || path.isAbsolute(file.path) || file.path.includes('\\') || file.path.split('/').some(part => part === '..' || part === '.' || !part)) throw new Error('Unsafe resource path');
      collected.push({ path: file.path, content: Buffer.from(file.content) });
    }
  }
  const main = collected.find(file => file.path === 'SKILL.md');
  if (!main) throw new Error('The selected directory does not contain SKILL.md');
  const { meta } = parseFrontmatter(main.content.toString('utf8'));
  const name = customName || meta.name;
  if (!validName(name)) throw new Error('Invalid skill name');
  if (customName && customName !== meta.name) {
    const matched = main.content.toString('utf8').match(FRONTMATTER_RE);
    if (!matched) throw new Error('Invalid SKILL.md frontmatter');
    const yamlDoc = parseDocument(matched[1]);
    yamlDoc.set('name', name);
    main.content = Buffer.from(`---\n${yamlDoc.toString().trimEnd()}\n---\n${matched[2]}`);
  }
  const destRoot = path.resolve(options.directory || SKILLS_DIR);
  const dest = path.join(destRoot, name);
  await fsp.mkdir(destRoot, { recursive: true, mode: 0o700 });
  if (fs.existsSync(dest)) throw new Error(`Skill ${name} is already installed`);
  const temp = await fsp.mkdtemp(path.join(destRoot, '.skill-'));
  try {
    for (const file of collected) {
      const target = path.resolve(temp, file.path);
      if (!inside(temp, target)) throw new Error('Unsafe resource path');
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, file.content, { mode: 0o600 });
    }
    const skill = readSkillFolder(temp);
    if (!skill) throw new Error('Invalid Agent Skill metadata');
    await fsp.rename(temp, dest);
    return { name, description: skill.description, path: dest, files: collected.length };
  } catch (error) {
    await fsp.rm(temp, { recursive: true, force: true });
    throw error;
  }
}

function buildSkillsPrompt({ include, extraSkills = [], cwd } = {}) {
  return [...new Set([...(include || loadAllSkills({ cwd })), ...extraSkills])]
    .map(name => loadSkill(name, { cwd })?.body)
    .filter(Boolean).join('\n\n');
}
function buildSkillsIndexPrompt(options = {}) {
  const skills = listSkills(options);
  if (!skills.length) return '';
  return ['Available Agent Skills (metadata only; load on demand):', 'Use load_skill {name} to read SKILL.md. Use load_skill {name, resource} to read an individual bundled resource, such as references/guide.md or scripts/check.py. Resources are never executed automatically.', ...skills.map(skill => `- ${skill.name}: ${skill.description}`)].join('\n');
}

module.exports = { FRONTMATTER_RE, SKILLS_DIR, LEGACY_DIR, parseFrontmatter, readSkillFolder, listSkillFolders, listSkills, loadAllSkills, loadSkill, readSkillResource, installSkill, buildSkillsPrompt, buildSkillsIndexPrompt, parseGitHubLocation };
