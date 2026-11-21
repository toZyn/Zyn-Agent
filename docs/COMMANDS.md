# Zyn Agent command reference

The command index below is generated from the registered interactive slash commands. Use `npm run docs:commands` to regenerate it after changing the registry.

Most commands run within both the Ink TUI and the classic interactive terminal. Where a selector is available, the TUI opens the interactive picker; otherwise the handler displays the available choices.

## Help and diagnostics

| Command | Function |
| --- | --- |
| `/help` | full help |
| `/version` | installed Zyn version |
| `/doctor` | diagnose setup and authentication |
| `/status` | current status |
| `/history` | recent actions |
| `/tools` | list actual agent tools |
| `/context` | show current context size estimate |
| `/stats` | show real session counts |
| `/usage` | show session usage estimate, not billing |

## Sessions

| Command | Function |
| --- | --- |
| `/session` | current session |
| `/sessions` | list sessions |
| `/new` | new session |
| `/resume` | resume session |
| `/title` | rename session |
| `/undo` | undo last turn |
| `/redo` | redo last turn |
| `/reset` | reset context |
| `/clear` | clear conversation context |
| `/transcript` | view transcript |
| `/export` | export to txt |
| `/bg` | background: continue current turn in background |

## Models and connections

| Command | Function |
| --- | --- |
| `/auth` | connect ChatGPT plan, GitHub and Gmail |
| `/login` | connect an account |
| `/logout` | disconnect an account |
| `/account` | ChatGPT account status |
| `/model` | choose or switch model |
| `/models` | list models |
| `/providers` | list/select providers |
| `/provider` | manage providers (sync, set, list, remove) |
| `/git` | configure git credentials |
| `/gmail` | connect Gmail account |

## Workspace and execution

| Command | Function |
| --- | --- |
| `/cwd` | working directory |
| `/init` | create project AGENTS.md |
| `/diff` | inspect local Git changes |
| `/plan` | enforced read-only planning |
| `/permissions` | inspect and change approval mode |
| `/auto` | auto-approval |
| `/stop` | stop agent |
| `/compact` | compact memory |

## Skills and integrations

| Command | Function |
| --- | --- |
| `/skills` | list, inspect and install Agent Skills |
| `/plugins` | manage plugins (install, uninstall, list, search) |
| `/mcp` | MCP servers (connect, disconnect, list, tools) |

## Personalization and interface

| Command | Function |
| --- | --- |
| `/memory` | view, import or forget portable memory |
| `/persona` | set response tone/personality |
| `/lang` | change language |
| `/config` | view/change session settings |
| `/settings` | configure limits, retries, timeouts |
| `/theme` | UI theme |
| `/thinking` | toggle thinking display (on|off) |

## Exit

| Command | Function |
| --- | --- |
| `/exit` | exit |
| `/quit` | exit the session |

## Command examples

```text
/help model
/model
/model chatgpt-account
/login chatgpt
/auth chatgpt status
/auth chatgpt models
/logout chatgpt
/context
/stats
/plan on
/permissions manual
/diff
/skills list
/mcp
```

The commands `/context`, `/stats` and `/usage` report information available to Zyn locally. Token numbers are estimates based on text length, not measured provider usage or billing.

The `/plan on` policy blocks mutation tools while planning. It is not a full operating-system sandbox for third-party plugins or processes.

To disconnect an authenticated `gh` or `gws` CLI account, use the respective official CLI in a regular terminal. ChatGPT account login and logout are handled directly by Zyn.

## Non-interactive shell commands

```text
zyn --version
zyn help
zyn doctor
zyn models
zyn sessions
zyn tools
zyn auth status
zyn auth chatgpt login
zyn auth chatgpt models
zyn auth chatgpt status
zyn auth chatgpt logout
zyn auth github login
zyn auth github status
zyn auth github logout
zyn auth gmail login
zyn auth gmail status
zyn auth gmail logout
zyn skills list
zyn skills show testing
zyn memory prompt
zyn memory import ./export.md
zyn memory forget
```

All account connections require explicit authorization. GitHub and Google Workspace workflows rely on their respective official CLIs, while ChatGPT sign-in uses the user-authorized direct OAuth flow.
