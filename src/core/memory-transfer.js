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
function formatOnboardingPreview(prompt = EXPORT_PROMPT, columns = 60, language = 'en') {
  const es = language === 'es';
  const width = Math.max(26, Math.min(72, Math.floor(columns || 60) - 4));
  const inside = width - 4;
  const words = String(prompt).replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let current = '';
  while (words.length && lines.length < 3) {
    const word = words.shift();
    if (!current) current = word;
    else if (Array.from(`${current} ${word}`).length <= inside) current += ' ' + word;
    else { lines.push(current); current = word; }
  }
  if (current && lines.length < 3) lines.push(current);
  while (lines.length < 3) lines.push('');
  const row = line => `│ ${Array.from(line).slice(0, inside).join('').padEnd(inside)} │`;
  return [
    es ? 'Aquí tienes el siguiente prompt' : 'Here is the following prompt',
    '┌' + '─'.repeat(width - 2) + '┐',
    ...lines.map(row),
    '└' + '─'.repeat(width - 2) + '┘',
    es ? 'Pulsa C para copiar el prompt · P para pegar' : 'Press C to copy full prompt · P to paste export',
  ].join('\n');
}

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
  output('Paste the complete export. Type :save on its own line to save, or :cancel to abort.');
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

function styleTerminal(text, color, output) {
  if (!output?.isTTY || process.env.NO_COLOR !== undefined || process.env.TERM === 'dumb') return text;
  const colors = { accent: '36', warn: '33', success: '32', subtle: '2', title: '1;36' };
  return `\x1b[${colors[color] || '0'}m${text}\x1b[0m`;
}

function renderOnboardingIntro(output, language, columns) {
  const es = language === 'es';
  const width = Math.max(30, Math.min(70, (columns || 64) - 4));
  const inner = width - 4;
  const lines = [
    es ? 'Zyn · Configuración inicial' : 'Zyn · Optional setup',
    es ? '¿Importar tu perfil de otra aplicación?' : 'Import your profile from another app?',
    es ? 'Puedes omitirlo y configurarlo después.' : 'Optional. You can configure it later.',
  ];
  const row = value => `│ ${String(value).slice(0, inner).padEnd(inner)} │`;
  const border = char => char + '─'.repeat(width - 2) + (char === '╭' ? '╮' : '╯');
  const content = [border('╭'), ...lines.map(row), border('╰')];
  return content.map((line, i) => styleTerminal(line, i === 1 ? 'title' : i === 2 ? 'subtle' : 'accent', output)).join('\n');
}

function renderMemoryPrompt(output, prompt, columns, language) {
  const lines = formatOnboardingPreview(prompt, columns, language).split('\n');
  return lines.map((line, index) => {
    const color = index === 0 ? 'title' : index === lines.length - 1 ? 'success' : line.startsWith('│') ? 'subtle' : 'accent';
    return styleTerminal(line, color, output);
  }).join('\n');
}

async function collectValidatedMemoryExport(rl, output, lang = 'en') {
  const es = lang === 'es';
  let lines = [];
  let bytes = 0;
  output.write(es ? '  Pega la exportación. Escribe :save para guardar o :cancel para salir.\n' : '  Paste the export. Type :save to save or :cancel to skip.\n');
  for await (const line of rl) {
    if (line.trim() === ':cancel') return null;
    if (line.trim() === ':save') {
      try {
        const clean = parseImportedMemory(lines.join('\n'));
        await saveImportedProfile(clean);
        return clean;
      } catch (error) {
        output.write(styleTerminal(es ? '  Invalid export. Debe contener ## MEMORIES y ## PREFERENCES. Vuelve a pegarla o escribe :cancel.\n' : '  Invalid export. Include ## MEMORIES and ## PREFERENCES. Paste the full export again, or type :cancel.\n', 'warn', output));
        lines = [];
        bytes = 0;
        continue;
      }
    }
    bytes += Buffer.byteLength(line, 'utf8') + 1;
    if (bytes > MAX_IMPORT_BYTES) {
      lines = [];
      bytes = 0;
      output.write(styleTerminal(es ? '  Exportación demasiado grande; pega una versión más pequeña.\n' : '  Export exceeds the import size limit; paste a smaller export.\n', 'warn', output));
      continue;
    }
    lines.push(line);
  }
  return null;
}

async function firstRunMemoryOnboarding({ input = process.stdin, output = process.stdout, ask, readLines, copy = require('./clipboard').copyToClipboard, language } = {}) {
  if (!input.isTTY || !output.isTTY || await hasSeenMemoryOnboarding()) return false;
  const { DEFAULT_LANGUAGE } = require('../config');
  const lang = language || DEFAULT_LANGUAGE;
  const es = lang === 'es';
  const readline = require('node:readline/promises');
  const rl = readline.createInterface({ input, output, terminal: true });
  try {
    output.write('\n' + renderOnboardingIntro(output, lang, output.columns) + '\n' + styleTerminal(es ? '  [Y] Importar     [N] Omitir' : '  [Y] Import     [N] Skip', 'success', output) + '\n');
    const response = ask ? await ask(rl) : await rl.question('  › ');
    if (!/^(s|si|sí|y|yes)$/i.test(String(response).trim())) {
      await markMemoryOnboarding();
      return false;
    }
    const columns = output.columns || 64;
    output.write(`\n${renderMemoryPrompt(output, EXPORT_PROMPT, columns, lang)}\n`);
    while (true) {
      const choice = (await rl.question(es ? '  [C] Copiar  [P] Pegar  [N] Omitir: ' : '  [C] Copy  [P] Paste  [N] Skip: ')).trim().toLowerCase();
      if (choice === 'n' || choice === ':cancel') { await markMemoryOnboarding(); return false; }
      if (choice === 'c') {
        const result = copy(EXPORT_PROMPT, { output });
        output.write(result.verified
          ? (es ? '  ✓ Prompt copiado al portapapeles.\n' : '  ✓ Full prompt copied to clipboard.\n')
          : (result.method === 'OSC52'
              ? (es ? '  Copia solicitada al terminal (OSC52); depende de la compatibilidad.\n' : '  Clipboard request sent to terminal (OSC52); support varies.\n')
              : (es ? '  Portapapeles no disponible; usa zyn memory prompt.\n' : '  Clipboard unavailable; use zyn memory prompt.\n')));
        continue;
      }
      if (choice === 'p' || choice === '') break;
      output.write(es ? '  Selecciona C, P o N.\n' : '  Choose C, P or N.\n');
    }
    const pasted = readLines ? await readLines(rl) : await collectValidatedMemoryExport(rl, output, lang);
    if (pasted === null) return false;
    if (readLines) await saveImportedProfile(pasted);
    await markMemoryOnboarding();
    output.write(es ? '  ✓ Memoria guardada para las nuevas sesiones.\n' : '  ✓ Profile saved for future sessions.\n');
    return true;
  } finally { rl.close(); }
}

module.exports = { PROFILE_FILE, ONBOARDING_FILE, MAX_IMPORT_BYTES, getMemoryExportPrompt, formatOnboardingPreview, parseImportedMemory, saveImportedProfile, readImportedProfile, clearImportedProfile, markMemoryOnboarding, hasSeenMemoryOnboarding, collectMemoryExport, collectValidatedMemoryExport, firstRunMemoryOnboarding };
