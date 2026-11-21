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

## ChatGPT account adapter regression

`tests/chatgpt_pty.py` starts a real terminal session with a temporary, simulated authorized ChatGPT account and an injected HTTP fixture. It verifies that the normal Zyn agent and Ink TUI use model discovery and Responses streaming without a Codex CLI binary or real credentials. `tests/chatgpt-auth.test.mjs` checks dynamic OAuth registration, PKCE, callback CSRF checks, signed ID-token validation, consent scopes, cancellation and rejection of an unexpected account identity. `tests/chatgpt-refresh-concurrency.test.mjs` runs two processes against a test server that rotates refresh tokens, detecting token-reuse races. These tests do not connect to a genuine ChatGPT account or imply unrestricted access to subscription models.

For a repeatable terminal-only stress benchmark, run `npm run bench:tui`, or `python3 scripts/benchmark-tui.py 10000`. It reports insert duration, resident memory, screen clears, whether PageUp worked and the exit status. Compare results only under the same hardware, terminal size and workload; output alone does not prove superiority to other agents.

## Mobile-terminal UX and consent

`tests/mobile_ux_pty.py` verifies a real Ink TUI at 52 columns by 18 rows, including English-by-default even with `LANG=es_PE.UTF-8`, dynamic `/lang es`/`/lang en`, raw model IDs in the status bar, command typo suggestions and the compact ChatGPT OAuth card. The long authorization URL is hidden until the user explicitly presses `L`; `C` uses the clipboard transport. A separate real PTY fixture renders a long shell command in an approval panel, tests expansion with `V`, verifies denial by `N`, and checks for full-screen clear escape sequences. `tests/tui-mobile-ux.test.mjs` checks bounded wrapping and context-aware keys for ChatGPT model-name collisions.

The first-run memory import now renders a three-line export prompt preview, never the complete text unless explicitly requested, and supports clipboard copying via Termux API or supported system clipboards with OSC52 fallback. Some SSH clients and mobile terminal emulators do not implement OSC52. In those cases, use `zyn memory prompt --show` or `/memory prompt --show` for manual copying. The import still validates the complete original profile and preserves per-session snapshots.

On small screens, historical conversation items render directly above the input or confirmation panel; approval command detail is bounded by available terminal height, with `V` for expansion and arrow keys for scrolling. Pressing `Enter` in a permission panel denies by default. This is a UI change, not an increase in shell-command permissions.

These are offline interface tests; the local authorization mock never contacts an account provider, so actual browser/OAuth compatibility still requires a user-authorized live check.
