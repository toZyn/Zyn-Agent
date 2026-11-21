# Subagents in Zyn Agent

This document describes the development-branch implementation and the public reference architectures it was compared against. It does not claim feature parity.

## Reference behavior

OpenAI Codex's published Rust implementation separates the spawn and coordination tools from thread/session control. It uses agent IDs, child thread metadata, parent ownership, inherited run configuration, limits on spawn depth and active agents, and distinct operations to spawn, send messages, wait, interrupt, resume, and close children. Relevant public files include `codex-rs/core/src/tools/handlers/multi_agents.rs`, `codex-rs/core/src/tools/handlers/multi_agents_spec.rs`, and `codex-rs/core/src/agent/control/spawn.rs` in https://github.com/openai/codex.

Claude Code's published documentation (https://code.claude.com/docs/en/sub-agents) describes subagents with a separate context window, role-specific system prompts, restricted tools, independent permission behavior, built-in Explore/Plan/general-purpose workers, custom definitions, foreground/background execution, and optional worktree isolation. Claude Code's complete proprietary implementation is not public; the description here is based on its documentation, not private source code.

## Zyn architecture

`src/core/subagents.js` owns the per-session coordinator and child lifecycle. The parent can call `spawn_agent`, `wait_agent`, `list_agents`, `followup_agent`, `resume_agent`, `interrupt_agent`, and `close_agent` through the tool registry. `/agents` lists child statuses; `/agents stop <id>` requests cancellation. Use `/agents resume <id>` for an interrupted worker.

Each child gets a new session ID and a separate saved history/transcript. The default `fork: none` carries only the task, selected model/provider configuration and workspace metadata. `fork: all` copies parent history and imported context rather than sharing mutable references. Children do not update the current-session pointer or global persistent settings. Child sessions are stored under the private chat subagents directory rather than being displayed as ordinary parent sessions.

Built-in roles: `explore`, `review`, and `plan` are read-only. `general` can request file and shell changes with the parent session's regular interactive approvals. The child never inherits `autoApprove`. Third-party plugins, external MCP mutations and account-management actions are not delegated by default. Children cannot create other subagents or prompt the user directly. The maximum is three concurrently running children per parent session.

Each worker runs through Zyn's existing model provider and agent-turn loop, not a synthetic one-response text-generation shortcut. Execution and provider usage are independent per child; the parent receives short status and result records, not every intermediate chunk in its own context.

## Limitations and safety boundaries

Workers share the same Node.js process, workspace and operating-system permissions. They are separate model sessions, **not** operating-system sandboxes or automatically isolated Git worktrees. The coordinator keeps atomic state snapshots under `~/.zyn/chat/agent-runs` and child sessions under `~/.zyn/chat/subagents`. After a restart, an interrupted read-only worker resumes its last task with its saved history. Writable workers remain interrupted until the user explicitly confirms `/agents resume <id>` or the `resume_agent` tool. Recovery is restart-and-continue, not exactly-once execution; tasks already partly executed may need reconciliation. Running children consume actual model requests and are subject to provider context windows, quotas and rate limits. Offline tests exercise the coordinator and tool dispatcher with a simulated model; live multi-provider execution still requires end-to-end validation with explicit user authorization.

Do not dispatch overlapping writable tasks to the same files. Prefer separate read-only exploration and review agents. Keep all external actions and file modifications behind the original user approval flow.

## Development verification

Run `npm run test:all`. `tests/subagents.test.mjs` covers role permissions, history isolation, fork copying, concurrency, follow-up, cancellation and timeouts. `tests/subagents-persistence.test.mjs` checks that saving a child cannot change the parent's selected session or persistent settings. `tests/subagents-dispatch.test.mjs` checks the real tool-dispatch path without network credentials. Tests are intentionally offline and cannot prove live provider or mobile-emulator behavior.


## Persistent specialists

Definitions live in the user's private `~/.zyn/agents/<name>.json` directory, each with `name`, `role`, `description`, `instructions`, and optional `allowedTools`. They persist independently of sessions. Names are validated and file writes are atomic. A definition cannot increase permissions beyond its base role. The `spawn_agent` tool accepts `definition: "name"`.

Use `/agents define storage-checker review Inspect disk usage without modifying files` to save a specialist. `/agents definitions` lists available definitions; `/agents show <name>` shows its configuration; `/agents delete <name>` requires user confirmation. The agent tools also support `list_agent_definitions`, `save_agent_definition` and `remove_agent_definition`, with confirmation for modifications.

## Inter-agent messages

`send_agent_message { agent_id, message }` routes a message to a child, peer, or parent using `agent_id: "parent"`. `/agents` displays a readable eight-character agent ID; unique prefixes of eight or more characters resolve to the original UUID, while ambiguous identifiers are rejected. `wait_agent` also includes unread messages addressed to the parent, so progress reports appear with the next wait result. `read_agent_messages {}` drains the current agent's mailbox. Messages are stored with the parent coordinator and preserved across restarts. Child agents can read queued messages between model/tool steps; idle agents can receive them during a later follow-up. `/agents send <id> <message>` and `/agents inbox` expose the same channel to the user. Messages cannot bypass tool permissions.

## Recovery boundaries

The model requests remain real, separately metered provider calls. The coordinator uses in-process tasks, not isolated OS containers or Git worktrees. Graceful termination interrupts children and saves their recoverable state. Read-only tasks may run again after restart. General agents cannot invoke unrestricted plugin, MCP or account writes. File changes require the parent's confirmation. Pending work not checkpointed may need inspection before resumption.
