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

## Scrolling and render performance

Ink 7 does not provide native `scrollable` or `mouse` attributes on `Box`. The application uses a height-limited virtual history viewport, renders only items fitting the visible row budget, and clips the live streaming area to keep the input and status bar on screen. PageUp/PageDown scroll through prior history; xterm mouse-wheel events are decoded from SGR mouse reports; the input editor ignores those reports. The scroll offset stays anchored when new items arrive, up to the viewport retention limit.

Long slash-command output is split into smaller system items so it remains navigable rather than creating one oversized, clipped result. Only the last 400 UI items stay in memory; persistent sessions and transcripts are not modified by UI scrolling. Single unusually long messages may still be clipped within one item and deserve a separate text-pagination improvement.

## Portable profile and workspace instructions

`src/core/memory-transfer.js` owns the one-time consent prompt, validation, local profile file and deletion. `src/utils/sessionStorage.js` snapshots imported memory into session records, while `src/core/prompts.js` adds it to model context as untrusted user-provided information. Profiles are not copied into public logs by the importer. The user can remove global and session copies through `zyn memory forget` or `/memory forget`.

`src/core/project-context.js` reads a bounded set of local `AGENTS.md`, `CLAUDE.md` and `QWEN.md` files. They provide workspace instructions, not elevated system/tool permissions.

## Agent Skills

`src/core/skills.js` validates YAML frontmatter, discovers projects and personal skill folders, downloads nested GitHub contents without running them, and exposes individual resources to `load_skill`. Skill bodies are not injected into the model prompt until requested; only descriptions appear in the index. Binary assets are preserved, while unsupported binary contents are not decoded into text. No general subagent runtime or lifecycle-hook executor is implemented. See `docs/AGENT_CAPABILITIES.md` for the comparison and gaps.
