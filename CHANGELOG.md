# Zyn Agent v1.7.0

A feature release focused on reliable terminal workflows, account connections, meaningful command behavior and provider presentation. It includes the changes developed since v1.6.0.

### Agent commands and developer workflow

- Added `/doctor`, `/tools`, `/plan on|off`, `/permissions`, `/init`, `/diff`, `/context`, `/stats`, `/usage`, `/version`, `/account`, `/login` and `/logout`, with actionable output rather than placeholder screens.
- `/model` now opens the existing selector or switches to a given model ID. `/help <command>` explains individual commands. `/clear` and `/quit` are discoverable aliases.
- Added non-interactive `zyn --version`, `zyn help`, `zyn doctor`, `zyn models`, `zyn sessions`, `zyn tools` and expanded `zyn auth` operations. These do not invoke a language model.
- Enforced read-only plan mode at the tool dispatcher. `/stats` and `/usage` show observed session counts and clearly labeled text-based estimates, never fabricated billing information.

### ChatGPT account integration (preview)

- Added independent, consent-based Sign in with ChatGPT using OAuth 2.0 Authorization Code + PKCE and OpenID Connect. No Codex CLI, manually configured client ID/secret, exported Codex cookies or API key is needed for eligible users.
- Retrieves account-visible models with the official `/v1/models` endpoint and streams inference through `/v1/responses` with `store: false`.
- Protects account login through state, nonce, cryptographic ID-token validation, restricted local credential files, rotating refresh tokens and cross-process refresh locking.
- Supports `zyn auth chatgpt login|status|models|logout`, plus `/auth chatgpt ...` in the TUI and model selection via `/providers`.
- **Limit:** automated tests use mock credentials and mocked API responses. A real-account login and end-to-end model test is still outstanding, and access depends on OpenAI's eligibility, consent and usage limits.

### Integrations and interface

- GitHub API calls can reuse an authenticated official `gh` CLI without exporting its token. `zyn auth github login|status|logout` provides the corresponding account workflow.
- Gmail can reuse the official `gws` authentication for supported operations, and supports `zyn auth gmail login|status|logout`. Google Workspace may require its own OAuth client setup; it is not magically bypassed.
- Added the black-and-white Zyn logo, compact provider marks, and clearer provider labels for terminals.
- Improved command documentation, error handling and diagnostics.

### Reliability and testing

- Added command regression tests, full TUI tests, authentication/refresh/streaming tests and a reproducible benchmark.
- Baseline 10,000-message TUI benchmark on the test environment: approximately 11.4 seconds for the insert workload, 140 MB RSS, zero full-screen clears and successful scroll/exit. Measurements are workload- and device-dependent, not a comparative claim against other agents.
- GitHub Releases and npm publication are now **independent**. This release does not publish to npm, which requires a separately initiated manual workflow.

### Known limitations

- No general multi-agent orchestration framework, plugin isolation sandbox or lifecycle hook engine is claimed.
- OAuth on a remote server needs a safe way for the browser to reach the loopback callback.
- Exact provider billing/quota cannot be inferred from approximate session token counts.
