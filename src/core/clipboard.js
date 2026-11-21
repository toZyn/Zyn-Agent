const { spawnSync } = require('node:child_process');
function clipboardCommands(platform = process.platform, env = process.env) {
  if (platform === 'darwin') return [['pbcopy', []]];
  if (platform === 'win32') return [['clip.exe', []]];
  const terminals = [];
  if (String(env.PREFIX || '').includes('com.termux')) terminals.push(['termux-clipboard-set', []]);
  terminals.push(['wl-copy', []], ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]);
  return terminals;
}
function copyToClipboard(text, { output = process.stdout, run = spawnSync, platform, env = process.env, osc52 = true } = {}) {
  const value = String(text || '');
  for (const [command, args] of clipboardCommands(platform, env)) {
    const result = run(command, args, { input: value, encoding: 'utf8', timeout: 1500, maxBuffer: 1024 * 1024, env });
    if (!result.error && result.status === 0) return { method: command, verified: true };
  }
  if (osc52 && output?.isTTY && value.length < 20000) {
    output.write(`\x1b]52;c;${Buffer.from(value, 'utf8').toString('base64')}\x07`);
    return { method: 'OSC52', verified: false };
  }
  return { method: null, verified: false };
}
module.exports = {clipboardCommands,copyToClipboard};
