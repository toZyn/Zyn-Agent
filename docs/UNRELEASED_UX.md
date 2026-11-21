## Unreleased · terminal UX and context reliability

- Restored the original framed TUI banner from the earlier stable UI and semantic colors; tool-event previews now fit narrow terminals and keep complete output available in session transcripts.
- Fixed first-run memory import so invalid input is explained and can be pasted again without a stack trace or application exit. The optional wizard has a colored, framed introduction.
- `/account` is now a consolidated account/provider status for ChatGPT, GitHub and Gmail, rather than an alias exclusive to ChatGPT.
- Model context windows use provider-reported metadata when available. Unknown sizes display as unknown, never an assumed 128K. The status line distinguishes approximate text estimates (`~`) from measured usage returned by a provider.
- The default arbitrary tool-step, history-character and tool-result-character caps are disabled (`0`); explicit configurable caps remain available. A repeated identical tool-result guard pauses unproductive loops. Provider context windows, quotas, request timeouts, filesystem and terminal resource limits still apply.
- Expanded offline PTY tests to cover recovery from malformed profile exports, terminal ANSI colors, restoration of the original banner, compact event rendering, live model-switch context reporting and actual token usage in a simulated ChatGPT response.
- This change is **not released to npm** until authorized separately.
