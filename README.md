# Zyn Agent

<p align="center"><img src="assets/brand/logo.svg" width="180" alt="Zyn Agent logo" /></p>

A terminal-based coding agent (v1.7.0) with an Ink TUI, CLI, model-provider adapters, local tools, session storage, MCP connections and portable Agent Skills. Built for Node.js 22 or newer.

The source code and current implementation live at [toZyn/Zyn-Agent](https://github.com/toZyn/Zyn-Agent). This README describes implemented behavior, not a promise of feature parity with other coding agents.

## Install

```sh
npm install -g zyn-ai
zyn
```

Development-only changes are tracked in [unreleased terminal and context fixes](docs/UNRELEASED_UX.md).

**Release channels:** GitHub may contain a newer version than npm. An npm update is published separately after explicit maintainer approval.

From source:

```sh
git clone https://github.com/toZyn/Zyn-Agent.git
cd Zyn-Agent
npm ci
npm start
```

`zyn "Explain this repository"` runs one prompt. `zyn --resume` resumes the most recent session; `zyn --resume <id>` opens a specific one. Interactive sessions launch the TUI when Ink is installed.

## First launch and imported memory

On the first interactive launch, Zyn offers an **optional** profile import. Press `Y` to import or Enter to skip. If importing, press `C` and Enter to copy the export prompt when needed (Termux API, supported desktop clipboard, or terminal OSC52), paste the response directly into the terminal, and press Enter on a blank line to finish. No second paste menu or `:save` command is required. `N` skips the import. The prompt is not printed in full by default. Invalid exports can be pasted again without exiting. The setup screen uses the terminal theme saved in Zyn settings. Clipboard support is terminal-dependent; copying may not be verifiable.

The import remains on your machine until you choose to use a model. New Zyn sessions receive a copy of the imported profile, and resumed sessions use their stored copy. Profiles are treated as **user-provided context, not trusted instructions**. They may be sent to the selected model provider as part of the model's prompt. Review exported content and remove information you do not want to share before importing it.

You can also use a local file:

```sh
zyn memory prompt
zyn memory prompt --show
zyn memory import ./export.md
zyn memory forget
```

Inside the agent, `/memory prompt` copies the prompt and shows a short preview; `/memory prompt --show` explicitly prints the complete prompt. `/memory import <file>` imports a saved export, and `/memory forget` removes it. Forget removes the imported profile and copies in saved Zyn sessions; it does not delete data in the original application or remove its backups.

## ChatGPT account models without Codex CLI

Zyn supports direct [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source) for eligible accounts. This authorization is implemented in Zyn using standard OAuth 2.0 PKCE and OpenID Connect, not by copying Codex session tokens or depending on the Codex executable. OpenAI assigns the OAuth client ID during the first sign-in; no manual API key, `client_id` or `client_secret` is needed.

```sh
zyn auth chatgpt login
zyn auth chatgpt models
zyn auth chatgpt status
zyn auth chatgpt logout
```

In the TUI, `/auth chatgpt login` (or `/login chatgpt`) presents a compact authorization panel and attempts to open the browser. `C` copies the full authorization URL, `O` tries the browser again, `L` explicitly shows the URL, and Escape cancels. After a successful login, the TUI offers a model selector. In a classic terminal, `zyn auth chatgpt login` presents equivalent options without printing the complete URL automatically. The browser must be able to reach Zyn's loopback `127.0.0.1` callback; authenticating from a different computer requires secure forwarding. Identity-only consent does not grant model use.

The account token is saved with owner-only permissions in Zyn's local data directory. Zyn calls the public `/v1/models` and `/v1/responses` endpoints with the granted OAuth access token. This feature is subject to account eligibility, plan limits, preview capabilities and user consent. It is **not** an unlimited or unofficial ChatGPT API. See [Official Sign in with ChatGPT documentation](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

This implementation is independent of the separately licensed OpenAI Sign in with ChatGPT DevKit. Zyn does not bundle the DevKit or copy its noncommercial source code.

## Core commands

The main commands are organized by workflow. Run `/help` in the TUI, `/help <command>` for focused usage, or `zyn help` in the shell. All discoverable commands are listed in the [full command reference](docs/COMMANDS.md).

Examples: `/model` opens the selector, `/model <id>` switches models, `/login chatgpt` opens authorization, `/account` shows connected accounts and the active provider (ChatGPT, GitHub and Gmail), `/context` displays provider-measured usage when supplied as well as labeled local estimates, and `/stats` reports observable session counters. Neither `/stats` nor `/usage` claims to read your provider's billing data.

The native `zyn auth` command also supports `status`, `list`, `github login|status|logout`, `gmail login|status|logout`, and the ChatGPT login/status/models/logout flow. Model IDs displayed in selectors and status bars are the actual provider IDs (`gpt-6-luna` rather than `chatgpt-gpt-6-luna`). Old prefixed session keys remain supported for migration. English is the default language even when the operating system uses a different locale; use `/lang` for a language picker, or `/lang es` and `/lang en` to switch immediately without restarting. GitHub and Gmail require their respective installed official CLIs (or other existing supported credentials).


| Task | Command |
| --- | --- |
| Help and status | `/help`, `/status` |
| Sessions | `/new`, `/sessions`, `/resume <id>` |
| Models and providers | `/models`, `/providers`, `/provider` |
| Context and preferences | `/memory`, `/settings`, `/persona`, `/lang` |
| Project and skills | `/cwd <path>`, `/skills list`, `/skills show <name>` |
| External tools | `/mcp`, `/plugins`, `/git` |
| Session history and output | `/history`, `/compact`, `/transcript`, `/export` |
| Stop or exit | `/stop`, `/exit` |

Commands use the same underlying handlers in the classic CLI and the TUI wherever possible. Some selectors are rendered differently. Run `/help` for the complete grouped reference.


## Context, tool execution and terminal stability

Zyn uses model-specific context metadata when the provider supplies it. If the provider does not publish a verified context window, Zyn displays `?` instead of inventing a number. Actual token usage is reported from provider responses when available; `~` identifies an approximation. `/context` shows both measurements independently. This does not modify provider quotas or create unlimited context.

The defaults for `max-tool-steps`, `max-history` and `max-output` are now `0`, which means **no arbitrary application-level cap** for those settings. Users can set an explicit limit with `/settings` to manage machine resources. Repeated identical tool calls that produce no progress trigger a protective pause. Normal permission approval, provider request timeouts, file-reading pagination and context-size constraints remain in effect.

On mobile terminals, the framed header and colored activity indicators use the existing theme palette. Long tool output is summarized in the live viewport; `/transcript` opens a separate, scrollable preview of recent session events, while `/export` preserves the full transcript in a file. The conversation starts at the top of the available history area, and the input remains at the bottom; the transcript viewer uses a separate scroll area instead of mixing raw logs into messages.

## Universal Agent Skills

Zyn discovers standard skill directories in projects and user-level locations, including `.agents/skills/`, `.claude/skills/`, `.qwen/skills/` and `~/.zyn/skills/`. It continues to load bundled legacy skills. Each skill consists of `SKILL.md` with YAML frontmatter (`name`, `description`) and may include `references/`, `scripts/`, `assets/`, and other files.

```text
.agents/skills/code-audit/
├── SKILL.md
├── references/
│   └── checklist.md
├── scripts/
│   └── check.py
└── assets/
    └── template.json
```

Zyn includes skill names and descriptions in the agent context, then loads full instructions only when needed. Bundled resources are accessible on demand through `load_skill {name, resource}`. **Installing a skill never executes its scripts automatically.** Inspect third-party scripts before authorizing their execution with other tools.

```sh
zyn skills list
zyn skills show code-audit
zyn skills show code-audit references/checklist.md
zyn skills install owner/repository/path/to/skill
```

You can also use `/skills list`, `/skills show <name> [resource]`, and `/skills install <owner/repo/path> [name]` in the agent. The installer downloads a complete directory from a public GitHub repository with file-count and size limits. Existing skill directories are not overwritten silently.

See [Agent Skills](https://agentskills.io/specification) for the portable format and [Capabilities and limitations](docs/AGENT_CAPABILITIES.md) for the comparison with Claude Code and Qwen Code.

## Project context

Zyn reads bounded instructions from `AGENTS.md`, `CLAUDE.md` and `QWEN.md` found in the working directory and ancestor directories. These files provide project-specific guidance; they are not permission to execute arbitrary commands. The project cwd is configurable with `/cwd`.

## Tools and integrations

The core includes file, shell, web, model-provider and session tools. Available providers and model IDs depend on configuration and external services; use `/providers` and `/models` to inspect the active catalog. MCP servers expose additional tools and are managed with `/mcp`. Optional npm plugins can register tools.

Tools and third-party packages can execute on the local machine. **There is no universal process sandbox for npm plugins or downloaded skill scripts.** Only install packages and connect servers you trust, and review commands before approving them. `/auto` adjusts approvals but does not create an isolation boundary.

## Privacy and storage

Session files, user preferences and imported memory are stored under `~/.zyn/` by default; set `ZYN_DATA_DIR` to change the root. User memory lives at `~/.zyn/chat/imported-memory.md`, with copies in individual session JSON files. New saves apply restrictive file permissions on POSIX systems, but the protection also depends on the operating system and directory permissions. Back up or delete this directory according to your needs.

## Development and verification

```sh
npm ci
npm run check
npm test
npm run test:tui
npm run test:all
```

The TUI integration tests use Python 3 with a POSIX pseudo-terminal. They cover input events, narrow terminals, large message loads, scrolling, resizing and the optional first-run memory import. Tests using simulated messages do not demonstrate provider reliability or true model reasoning quality.

See [Architecture](docs/ARCHITECTURE.md), [TUI testing](docs/TUI_TESTING.md), and [Capabilities and limitations](docs/AGENT_CAPABILITIES.md). Issues: [GitHub Issues](https://github.com/toZyn/Zyn-Agent/issues).

MIT license. See [LICENSE](LICENSE).
