# Zyn Agent v1.8.0

Released 2026-11-21. This release adds persistent subagents and restores Zyn's compact terminal presentation while preserving complete, scrollable output.

### Persistent subagents

- Added spawning, waiting, listing, follow-up, interruption, resumption and closing of child agents, plus `/agents` controls.
- Added independent child histories and transcripts, saved specialist definitions, parent/peer messaging and persisted coordinator state.
- Added read-only explore/review/plan roles and a general worker, with explicit permissions and up to three active children per parent.
- Interrupted read-only tasks can recover after restart. Writable tasks require explicit resumption and reconciliation of any work already performed.
- Workers share the process and workspace; they are not operating-system sandboxes or automatically isolated worktrees. Live provider behavior is not established by the offline tests.

### Terminal presentation and streaming

- Restored the original framed banner, semantic colors and inline tool-event markers. Removed oversized AGENT cards.
- Removed the two-line tool-output preview cap and the automatic eviction of conversation items after 400 messages.
- Added scrolling by actual rendered rows, including within one long answer, and wrapping at the current terminal width.
- Removed the fixed half-screen streaming reservation so short output and input stay close together.
- Fixed inline Markdown text flow and incremental final-answer decoding, including JSON escapes, without displaying tool/comment JSON as answer text.
- Made the Zyn model selector open the available catalog immediately instead of blocking queued commands on a network refresh.
- Improved mobile resizing, transcript viewing, approval panels, onboarding and memory-import recovery.

### Context and account reporting

- Disabled arbitrary default tool-step, history-character and tool-result-character caps; explicitly configured caps still work.
- Retained the identical-result no-progress guard. Provider limits, timeouts and available resources still apply.
- Use provider-reported context sizes when available and show unknown sizes as unknown. Distinguish estimated text tokens from measured provider usage.
- Consolidated account/provider status for ChatGPT, GitHub and Gmail.

### Validation

- Passed 153 Node tests and 43 pseudo-terminal scenarios on the final implementation.
- Added a visual regression that checks a completed subagent alongside a partial streamed answer, resizing from 62 to 48 to 90 columns while generation is active.
- Verified complete long tool outputs, long single-answer navigation, model-selector cancellation, child dispatch, persistence and restart recovery.
- A 10,000-message terminal workload completed in approximately 11.8 seconds at 243 MB RSS, with zero full-screen clears and successful scrolling and exit. These measurements depend on device and workload.
- Tests use simulated provider responses; real-provider response quality and repetition remain outside this offline validation.

### Distribution

Creating this GitHub release does not publish to npm. npm publication is a separate, manually initiated workflow.

Previous release: [v1.7.0](https://github.com/toZyn/Zyn-Agent/releases/tag/v1.7.0).
