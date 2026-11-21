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
