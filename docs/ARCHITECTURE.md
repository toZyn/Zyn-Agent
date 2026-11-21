# Zyn-Agent architecture

Zyn-Agent is a Node.js agent with a command-line interface, an Ink/React terminal interface and optional integrations. Keep the CLI, the terminal presentation, the provider interfaces and the agent's tool execution independent so they can be tested without requiring live model credentials.

## Runtime path

`zyn.js` invokes `src/cli/runtime.js`. Interactive terminals use `src/tui/app.mjs`; single-shot inputs use the CLI runtime. The TUI calls `src/core/agent.js` for model turns. Models and providers are registered under `src/providers`; tool implementations live under `src/tools`; sessions are persisted by `src/utils/sessionStorage.js`.

## Terminal modules

| File | Responsibility |
| --- | --- |
| `src/tui/app.mjs` | Ink components, command orchestration and input routing |
| `src/tui/store.mjs` | UI state, selection promises, message history and event updates |
| `src/tui/input-events.mjs` | Normalization, edit operations, Unicode cursor movement and batched key events |
| `src/tui/turn-runner.mjs` | Serial execution of submitted messages and commands, including failure cleanup |
| `src/tui/layout.mjs` | Terminal-width-dependent layout constraints |
| `src/tui/themes.mjs` | Theme catalog and selection |
| `src/tui/format.mjs` | Presentation-only text helpers |
| `src/tui/viewport.mjs` | Bounded in-memory render history |

## Invariants

- Only one submitted command or model turn executes through the TUI input runner at a time. Inputs received during execution are queued or injected by the agent's explicit queue hook.
- Commands starting with `/` must never be injected as an additional natural-language prompt. They remain queued until the active operation completes.
- Requesting cancellation must not mark the agent idle before the active operation has actually ended.
- An exception in one submitted command must not leave `processing` set indefinitely.
- Bracketed paste must be treated as draft content, not as implicit command submissions. Multiple unbracketed Return events can be decoded as separate submissions.
- Layout widths must follow the terminal dimensions; narrow terminals use a compact banner and status line.
- The viewport retains at most 400 UI items. The durable conversation and transcript are handled by the session persistence layer and are not deleted by viewport trimming.

## Boundaries not yet migrated

`src/tui/app.mjs` still contains application-specific command handlers. `src/cli/commands.js`, `src/tools/index.js`, and the prompt definitions remain large modules. Further extraction should proceed by domain with regression tests, not through simultaneous wholesale rewrites. Model streaming, remote tools, plugin isolation and provider failures require dedicated integration coverage.
