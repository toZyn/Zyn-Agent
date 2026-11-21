# Subagents in Zyn Agent

This document describes the development-branch implementation and the public reference architectures it was compared against. It does not claim feature parity.

## Reference behavior

OpenAI Codex's published Rust implementation separates the spawn and coordination tools from thread/session control. It uses agent IDs, child thread metadata, parent ownership, inherited run configuration, limits on spawn depth and active agents, and distinct operations to spawn, send messages, wait, interrupt, resume, and close children. Relevant public files include `codex-rs/core/src/tools/handlers/multi_agents.rs`, `codex-rs/core/src/tools/handlers/multi_agents_spec.rs`, and `codex-rs/core/src/agent/control/spawn.rs` in https://github.com/openai/codex.

Claude Code's published documentation (https://code.claude.com/docs/en/sub-agents) describes subagents with a separate context window, role-specific system prompts, restricted tools, independent permission behavior, built-in Explore/Plan/general-purpose workers, custom definitions, foreground/background execution, and optional worktree isolation. Claude Code's complete proprietary implementation is not public; the description here is based on its documentation, not private source code.

## Zyn architecture

`src/core/subagents.js` owns the per-session coordinator and child lifecycle. The parent can call `spawn_agent`, `wait_agent`, `list_agents`, `followup_agent`, `interrupt_agent`, and `close_agent` through the same tool registry as other agent actions. `/agents` displays active children; `/agents stop <id>` requests cancellation.

Each child gets a new session ID and a separate saved history/transcript. The default `fork: none` carries only the task, selected model/provider configuration and workspace metadata. `fork: all` copies parent history and imported context rather than sharing mutable references. Children do not update the current-session pointer or global persistent settings. Child sessions are stored under the private chat subagents directory rather than being displayed as ordinary parent sessions.

Built-in roles: `explore`, `review`, and `plan` are read-only. `general` can request file and shell changes with the parent session's regular interactive approvals. The child never inherits `autoApprove`. Third-party plugins, external MCP mutations and account-management actions are not delegated by default. Children cannot create other subagents or prompt the user directly. The maximum is three concurrently running children per parent session.

Each worker runs through Zyn's existing model provider and agent-turn loop, not a synthetic one-response text-generation shortcut. Execution and provider usage are independent per child; the parent receives short status and result records, not every intermediate chunk in its own context.

## Limitations and safety boundaries

Workers share the same Node.js process, workspace and operating-system permissions. They are separate model sessions, **not** operating-system sandboxes or automatically isolated Git worktrees. The coordinator's live status and cancellation controls are process-local; after restarting Zyn, unfinished workers do not automatically resume. Running children consume actual model requests and are subject to provider context windows, quotas and rate limits. Offline tests exercise the coordinator and tool dispatcher with a simulated model; live multi-provider execution still requires end-to-end validation with explicit user authorization.

Do not dispatch overlapping writable tasks to the same files. Prefer separate read-only exploration and review agents. Keep all external actions and file modifications behind the original user approval flow.

## Development verification

Run `npm run test:all`. `tests/subagents.test.mjs` covers role permissions, history isolation, fork copying, concurrency, follow-up, cancellation and timeouts. `tests/subagents-persistence.test.mjs` checks that saving a child cannot change the parent's selected session or persistent settings. `tests/subagents-dispatch.test.mjs` checks the real tool-dispatch path without network credentials. Tests are intentionally offline and cannot prove live provider or mobile-emulator behavior.
