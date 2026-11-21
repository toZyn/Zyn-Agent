export function readTerminalDimensions(stdout, env = process.env) {
  let pair;
  try { pair = stdout?.getWindowSize?.(); } catch {}
  const col = Number(pair?.[0] || stdout?.columns || 100);
  const row = Number(pair?.[1] || stdout?.rows || 40);
  const override = Number(env.ZYN_TUI_ROWS);
  const width = Math.max(12, Math.min(500, Number.isFinite(col) ? Math.floor(col) : 100));
  const autoHeight = Math.max(8, Math.min(200, Number.isFinite(row) ? Math.floor(row) : 40));
  const height = Number.isInteger(override) && override >= 8 && override <= 200 ? override : autoHeight;
  return { width, height };
}
