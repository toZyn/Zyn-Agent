const fs = require('node:fs');
const path = require('node:path');
const { SLASH_COMMANDS } = require('../src/cli/commands');
const groups = [
  ['Help and diagnostics', ['help', 'version', 'doctor', 'status', 'history', 'tools', 'context', 'stats', 'usage']],
  ['Sessions', ['session', 'sessions', 'new', 'resume', 'title', 'undo', 'redo', 'reset', 'clear', 'transcript', 'export', 'bg']],
  ['Models and connections', ['auth', 'login', 'logout', 'account', 'model', 'models', 'providers', 'provider', 'git', 'gmail']],
  ['Workspace and execution', ['cwd', 'init', 'diff', 'plan', 'permissions', 'auto', 'stop', 'compact', 'agents']],
  ['Skills and integrations', ['skills', 'plugins', 'mcp']],
  ['Personalization and interface', ['memory', 'persona', 'lang', 'config', 'settings', 'theme', 'thinking']],
  ['Exit', ['exit', 'quit']],
];
const byName = new Map(SLASH_COMMANDS.map(command => [command.name, command]));
const seen = new Set();
const lines = [
  '# Zyn Agent command reference',
  '',
  'The command index below is generated from the registered interactive slash commands. Use `npm run docs:commands` to regenerate it after changing the registry.',
  '',
  'Most commands run within both the Ink TUI and the classic interactive terminal. Where a selector is available, the TUI opens the interactive picker; otherwise the handler displays the available choices.',
  '',
];
for (const [heading, names] of groups) {
  lines.push(`## ${heading}`, '', '| Command | Function |', '| --- | --- |');
  for (const name of names) {
    if (seen.has(name)) throw new Error(`Duplicate command in documentation: ${name}`);
    seen.add(name);
    const command = byName.get(name);
    if (!command) throw new Error(`Unknown command in documentation: ${name}`);
    lines.push(`| \`/${name}\` | ${command.desc} |`);
  }
  lines.push('');
}
const uncovered = [...byName.keys()].filter(name => !seen.has(name));
if (uncovered.length) throw new Error(`Commands missing from reference: ${uncovered.join(', ')}`);
lines.push('## Command examples', '',
  '```text',
  '/help model',
  '/model',
  '/model chatgpt-account',
  '/login chatgpt',
  '/auth chatgpt status',
  '/auth chatgpt models',
  '/logout chatgpt',
  '/context',
  '/stats',
  '/plan on',
  '/permissions manual',
  '/diff',
  '/skills list',
  '/mcp',
  '```', '',
  'The commands `/context`, `/stats` and `/usage` report information available to Zyn locally. Token numbers are estimates based on text length, not measured provider usage or billing.',
  '',
  'The `/plan on` policy blocks mutation tools while planning. It is not a full operating-system sandbox for third-party plugins or processes.',
  '',
  'To disconnect an authenticated `gh` or `gws` CLI account, use the respective official CLI in a regular terminal. ChatGPT account login and logout are handled directly by Zyn.',
  '',
  '## Non-interactive shell commands', '',
  '```text',
  'zyn --version',
  'zyn help',
  'zyn doctor',
  'zyn models',
  'zyn sessions',
  'zyn tools',
  'zyn auth status',
  'zyn auth chatgpt login',
  'zyn auth chatgpt models',
  'zyn auth chatgpt status',
  'zyn auth chatgpt logout',
  'zyn auth github login',
  'zyn auth github status',
  'zyn auth github logout',
  'zyn auth gmail login',
  'zyn auth gmail status',
  'zyn auth gmail logout',
  'zyn skills list',
  'zyn skills show testing',
  'zyn memory prompt',
  'zyn memory import ./export.md',
  'zyn memory forget',
  '```', '',
  'All account connections require explicit authorization. GitHub and Google Workspace workflows rely on their respective official CLIs, while ChatGPT sign-in uses the user-authorized direct OAuth flow.', '',
);
const content = lines.join('\n');
const output = path.join(__dirname, '..', 'docs', 'COMMANDS.md');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== content) {
    console.error('docs/COMMANDS.md is out of date. Run npm run docs:commands.');
    process.exitCode = 1;
  } else console.log(`Verified ${seen.size} slash commands in docs/COMMANDS.md`);
} else {
  fs.writeFileSync(output, content);
  console.log(`Documented ${seen.size} slash commands in docs/COMMANDS.md`);
}
