# Zyn Agent

A terminal-based coding agent with an Ink TUI, CLI, model-provider adapters, local tools, session storage, MCP connections and portable Agent Skills. Built for Node.js 22 or newer.

The source code and current implementation live at [toZyn/Zyn-Agent](https://github.com/toZyn/Zyn-Agent). This README describes implemented behavior, not a promise of feature parity with other coding agents.

## Install

```sh
npm install -g zyn-ai
zyn
```

From source:

```sh
git clone https://github.com/toZyn/Zyn-Agent.git
cd Zyn-Agent
npm ci
npm start
```

`zyn "Explain this repository"` runs one prompt. `zyn --resume` resumes the most recent session; `zyn --resume <id>` opens a specific one. Interactive sessions launch the TUI when Ink is installed.

## First launch and imported memory

On the first interactive launch, Zyn asks whether you want to transfer memories or preferences from another application. **This is optional.** If you agree, Zyn prints a ready-to-copy export prompt. Paste that prompt into the source application, copy its complete answer, paste it into Zyn and write `:save` on a line by itself. Write `:cancel` to abort instead.

The import remains on your machine until you choose to use a model. New Zyn sessions receive a copy of the imported profile, and resumed sessions use their stored copy. Profiles are treated as **user-provided context, not trusted instructions**. They may be sent to the selected model provider as part of the model's prompt. Review exported content and remove information you do not want to share before importing it.

You can also use a local file:

```sh
zyn memory prompt
zyn memory import ./export.md
zyn memory forget
```

Inside the agent, use `/memory prompt`, `/memory import <file>`, or `/memory forget`. Forget removes the imported profile and copies in saved Zyn sessions; it does not delete data in the original application or remove its backups.

## Core commands

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
