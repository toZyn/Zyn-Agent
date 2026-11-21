const fs = require('node:fs');
const path = require('node:path');

const PROJECT_FILES = ['AGENTS.md', 'CLAUDE.md', 'QWEN.md'];
const MAX_CONTEXT_CHARS = 32000;

function loadProjectInstructions(cwd, options = {}) {
  let directory = path.resolve(cwd || process.cwd());
  const stopAt = options.stopAt ? path.resolve(options.stopAt) : null;
  const folders = [];
  for (let i = 0; i < 16; i++) {
    folders.push(directory);
    if (directory === stopAt) break;
    const parent = path.dirname(directory);
    if (directory === parent) break;
    directory = parent;
  }
  let remaining = MAX_CONTEXT_CHARS;
  const sections = [];
  for (const folder of folders.reverse()) {
    for (const filename of PROJECT_FILES) {
      if (remaining < 100) break;
      const full = path.join(folder, filename);
      let stat;
      try { stat = fs.lstatSync(full); } catch { continue; }
      if (!stat.isFile() || stat.size > 32768) continue;
      const text = fs.readFileSync(full, 'utf8').slice(0, remaining);
      if (!text.trim()) continue;
      sections.push(`Source: ${full}\n${text}`);
      remaining -= text.length;
    }
  }
  return sections.join('\n\n');
}

module.exports = { loadProjectInstructions, PROJECT_FILES };
