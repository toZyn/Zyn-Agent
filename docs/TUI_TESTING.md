# TUI test coverage

Use Node.js 22+, Python 3, and a POSIX terminal environment.

```sh
npm ci
npm run check
npm test
npm run test:tui
```

`npm test` runs the pure unit tests for terminal input events, Unicode editing, responsive layout, selections, the serial input runner, and bounded rendering. `npm run test:tui` starts isolated copies of `node zyn.js` with pseudo-terminals and temporary `ZYN_DATA_DIR` locations. These tests do not require API keys or connect to language-model services.

The PTY scenarios cover coalesced Return and slash commands, bracketed paste, repeated theme changes, menus and cancel, resize events at different terminal widths, a 10,000-character draft, Ctrl+C, and normal or rapidly coalesced double ESC. Each case checks for process termination or continued responsiveness as appropriate.

The tests run within a temporary data directory and do not alter normal user sessions. They do not prove that remote model APIs, MCP connections, arbitrary plugin code, large tool streams, network disconnections, or prolonged interactive sessions are reliable. Reproduce those separately with controlled providers and exercise the same code paths before shipping changes involving them.

## Flood and scroll regression

`npm run test:tui` also runs `tests/tui_flood_pty.py`. It renders 1,200 simulated alternating user and assistant messages, multiple streaming updates, and a separate 5,000-message case. It checks PageUp/PageDown and xterm SGR mouse-wheel scrolling, resizing, process responsiveness, and that Ink never emits a full-screen clear (`ESC[2J`) during the flood. The flood deliberately runs offline and does not incur model API charges.

For manual extended stress, use `ZYN_FLOOD_MESSAGES=10000 node tests/tui_flood.mjs` in an interactive terminal. That fixture prints message count, elapsed time, retained viewport items, and RSS memory after completion. It is a UI benchmark rather than a provider/network benchmark. Large single-message rendering remains distinct from flooding the history with many messages.

Ink disables interactive output by default under `CI` / `GITHUB_ACTIONS`, even with a TTY. The TUI explicitly enables Ink interactivity only when both standard input and output are TTYs. The PTY regression suite includes this environment to detect blank screens in CI.

The first-launch integration scenario additionally verifies that memory onboarding is optional, accepts a fenced multiline export, writes a private profile file and creates a session snapshot. `ZYN_SKIP_ONBOARDING=1` is used by automated unrelated TUI tests to avoid accidental first-run prompts; the onboarding flow is tested explicitly without that flag.
