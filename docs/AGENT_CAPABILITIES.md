# Agent capabilities and limitations

This is an implementation-oriented comparison with the documented features of Claude Code, Qwen Code, and the open Agent Skills format. It is not a performance ranking. Feature availability and security guarantees vary by version and configuration.

| Area | Reference behavior | Zyn status |
| --- | --- | --- |
| Agent Skills discovery | Project and personal folders with `SKILL.md` | Implemented, including `.agents/skills`, `.claude/skills`, `.qwen/skills`, user directories and bundled skills |
| Skill resource packages | `scripts/`, `references/`, `assets/`, other files | Implemented: directory download, resource indexing and on-demand reading; no automatic execution |
| YAML skill metadata | Name, description and optional fields | Implemented via YAML parser; validates core metadata and rejects malformed skills |
| Skill activation | Metadata first; body on demand | Implemented through `load_skill`, with model-directed selection |
| Project instructions | Scoped `AGENTS.md`, `CLAUDE.md`, `QWEN.md` | Implemented with bounded file reads; no automatic code execution |
| Terminal tools | File operations, shell commands, tool feedback | Existing core tool loop; tool safety and provider behavior depend on configuration |
| MCP tools | Discover and use external tools | Existing MCP client; not audited end to end in this change |
| Persistent user profile | Optional imported memories for future sessions | Implemented with first-run opt-in, deletion and session snapshots |
| Agent subagents | Independent delegated tasks, isolated contexts | Not implemented as a general subagent framework |
| Lifecycle hooks | Pre/post-tool policy hooks | Not implemented as a structured hook registry |
| Permissions and sandboxing | Scoped grants and isolation | Partial; local approval exists, but there is no secure OS-level plugin sandbox |
| Visual/desktop automation | Computer-use tool integration | Not part of this verified scope |
| Model execution | Reliable providers, streaming, tool loops | Existing adapters; live-provider interoperability needs separate integration tests |
| ChatGPT-plan sign-in | Account-authorized, no manual API key | Implemented as independent OAuth/OIDC + PKCE client and official Responses streaming; verified against fixtures, live account test outstanding |
| Token renewal and revocation | Avoid losing sessions and leaking credentials | Owner-only local storage, cross-process rotating-token lock, best-effort remote revocation and honest error reporting |
| Coding-agent planning | Predictable non-destructive planning | Central tool-policy enforcement for read-only plan mode, with unit tests; not a secure OS sandbox |

## Engineering decisions

- Skill metadata loads into context first. Complete bodies and resources are fetched individually only when needed.
- Third-party scripts are kept as data until an explicitly authorized local tool executes them.
- Installed skills do not automatically gain MCP capabilities, security privileges or shell execution rights.
- Imported memories are treated as user-controlled data. They do not override tool permissions or high-priority operating rules.
- Documentation states a feature as complete only when an implementation and a repeatable test establish its behavior.

## References

- [Sign in with ChatGPT for open-source apps](https://developers.openai.com/siwc/token-sharing-open-source)
- [ChatGPT plan model discovery and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)

- [Agent Skills specification](https://agentskills.io/specification)
- [Claude Code: Skills](https://code.claude.com/docs/en/skills)
- [Qwen Code: Agent Skills](https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/)
- [Qwen Code: Commands](https://qwenlm.github.io/qwen-code-docs/en/users/features/commands/)
- [Qwen Code: Subagents](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/sub-agents.md)
- [Qwen Code: Hooks](https://qwenlm.github.io/qwen-code-docs/en/users/features/hooks/)
