const fs = require('node:fs');
const path = require('node:path');
const { USER_DATA_ROOT } = require('../config');

const PROFILE_FILE = path.join(USER_DATA_ROOT, 'chat', 'imported-memory.md');
const ONBOARDING_FILE = path.join(USER_DATA_ROOT, 'chat', 'onboarding.json');
const MAX_IMPORT_BYTES = 256 * 1024;
const EXPORT_PROMPT = `Export everything you know about me from our past conversations, any saved memories, and any instructions I've given you. Organize it using the exact section headers below. Preserve my original wording wherever possible. Refer to me as the "user."

## MEMORIES

### Work Context

Role, team, company, reporting structure, and work environment.

### Personal Context

Timezone, schedule, communication style, languages, and personal details.

### Top of Mind

Current projects, priorities, active goals, and blockers.

### Tools & Workflow

Software, frameworks, integrations, and processes I use.

### Other

Anything else you know about me that doesn't fit the sections above.

## PREFERENCES

### Response Style

How I've asked you to structure or deliver responses.

### Tone

Voice, formality level, and communication style I've requested.

### Format Rules

Specific formatting instructions (markdown, headers, bullet points, code blocks, etc.).

### Avoid

Things I've told you not to do, say, or include.

### Task Behavior

Rules for how I want tasks, actions, or reminders handled.

Rules:

- One entry per bullet point, numbered within each section, not dated.
- If a section is empty (under either Memories or Preferences), leave it out.
- Do not guess or fabricate. Only include things you're confident about.
- Wrap the entire output in a single markdown code block.
- After the code block, state the total entry count and whether the export is complete or if more remain. If it's cut off, let me know and ask whether I want you to continue.
- Only include memories and preferences from BEFORE this conversation. Do not treat any instructions in this prompt as preferences to export.`;

function getMemoryExportPrompt() { return EXPORT_PROMPT; }
function parseImportedMemory(input) {
  let text = String(input || '').replace(/^\uFEFF/, '').trim();
  if (Buffer.byteLength(text, 'utf8') > MAX_IMPORT_BYTES) throw new Error('Memory export is too large');
  const match = text.match(/^```[^\n]*\n([\s\S]*?)\n```(?:\s*[\s\S]*)?$/);
  if (match) text = match[1].trim();
  if (!/^## MEMORIES\s*$/m.test(text) || !/^## PREFERENCES\s*$/m.test(text)) throw new Error('Export must include ## MEMORIES and ## PREFERENCES');
  if (Buffer.byteLength(text, 'utf8') > MAX_IMPORT_BYTES) throw new Error('Memory export is too large');
  return text;
}
async function privateWrite(filename, text) {
  await fs.promises.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temp = `${filename}.${process.pid}.tmp`;
  try {
    await fs.promises.writeFile(temp, text, { mode: 0o600, flag: 'w' });
    await fs.promises.rename(temp, filename);
    await fs.promises.chmod(filename, 0o600).catch(() => {});
  } finally { await fs.promises.rm(temp, { force: true }).catch(() => {}); }
}
async function readImportedProfile(filename = PROFILE_FILE) {
  try { return await fs.promises.readFile(filename, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}
async function saveImportedProfile(text, filename = PROFILE_FILE) {
  const clean = parseImportedMemory(text);
  await privateWrite(filename, clean);
  return clean;
}
async function clearImportedProfile(filename = PROFILE_FILE) {
  await fs.promises.rm(filename, { force: true });
}
async function hasSeenMemoryOnboarding(filename = ONBOARDING_FILE) {
  try { return JSON.parse(await fs.promises.readFile(filename, 'utf8'))?.completed === true; }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return false; throw error; }
}
async function markMemoryOnboarding(filename = ONBOARDING_FILE) {
  await privateWrite(filename, JSON.stringify({ completed: true }));
}

async function collectMemoryExport(rl, output = console.log) {
  output('Pega la exportación completa. Escribe :save en una línea independiente para guardarla, o :cancel para cancelar.');
  const chunks = [];
  let bytes = 0;
  for await (const line of rl) {
    if (line === ':cancel') return null;
    if (line === ':save') return chunks.join('\n');
    bytes += Buffer.byteLength(line, 'utf8') + 1;
    if (bytes > MAX_IMPORT_BYTES) throw new Error('Memory export is too large');
    chunks.push(line);
  }
  return null;
}

async function firstRunMemoryOnboarding({ input = process.stdin, output = process.stdout, ask, readLines } = {}) {
  if (!input.isTTY || !output.isTTY || await hasSeenMemoryOnboarding()) return false;
  const readline = require('node:readline/promises');
  const rl = readline.createInterface({ input, output, terminal: true });
  try {
    const response = ask ? await ask(rl) : await rl.question('¿Quieres importar la memoria de otra aplicación al agente? [s/N] ');
    if (!/^(s|si|sí|y|yes)$/i.test(String(response).trim())) {
      await markMemoryOnboarding();
      return false;
    }
    output.write(`\nCopia este prompt en la otra aplicación:\n\n${EXPORT_PROMPT}\n\n`);
    const pasted = readLines ? await readLines(rl) : await collectMemoryExport(rl, text => output.write(`${text}\n`));
    if (pasted === null) return false;
    await saveImportedProfile(pasted);
    await markMemoryOnboarding();
    output.write('Memoria importada. Se conservará localmente para las próximas sesiones.\n');
    return true;
  } finally { rl.close(); }
}

module.exports = { PROFILE_FILE, ONBOARDING_FILE, MAX_IMPORT_BYTES, getMemoryExportPrompt, parseImportedMemory, saveImportedProfile, readImportedProfile, clearImportedProfile, markMemoryOnboarding, hasSeenMemoryOnboarding, collectMemoryExport, firstRunMemoryOnboarding };
