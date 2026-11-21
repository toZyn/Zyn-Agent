# Zyn Agent v1.8.1

Released 2026-11-21. This patch addresses the mixed commentary, raw tool JSON, repeated output and Markdown failures reported after v1.8.0. Persistent subagents remain included.

### Streaming and comments

- Separate commentary, final answers and tool envelopes into identified parts instead of treating a mixed response as one text buffer.
- Preserve ChatGPT Responses item boundaries and commentary/final-answer phases; reconcile authoritative completed text without duplicating deltas.
- Stream comments before tool execution, including pretty-printed JSON and prose followed by a tool call. Keep tool JSON out of assistant prose.
- Update each visible part once through completion rather than committing a preview as an extra final answer.
- Surface a transport failure after visible progress without transparently replaying that progress. End empty responses without an empty-comment loop.
- Withhold incomplete or malformed control envelopes and request a complete action instead of showing or executing them.
- Route direct command responses through the same lifecycle. Preserve complete command-output lines and completed subagent results in their dedicated events.

### Terminal formatting

- Parse inline emphasis before wrapping text so bold markers do not split across lines.
- Preserve explicit ordered-list numbers across nested bullet lists.
- Preserve identifier underscores and literal backslashes instead of decoding displayed text twice.
- Show full table cells and headers in wrapping labeled rows when columns cannot fit; do not truncate their contents.

### Verification and limits

- Added failing regressions for the reported mixed-response and duplication cases, then verified them through the protocol parser, actual agent loop and terminal app.
- Full offline checks cover 171 Node tests and 45 pseudo-terminal scenarios, including tool approval, real command dispatch, child spawn/wait, live resizing and interactive questions followed by a subagent.
- Provider responses are simulated. This does not establish the response quality or reliability of a particular live model.
- Architecture and inspected OpenCode/Codex source references: [streaming lifecycle](https://github.com/toZyn/Zyn-Agent/blob/main/docs/STREAMING.md).

### Distribution

Creating this GitHub release does not publish to npm. npm publication uses its separate manually initiated workflow.

Previous release: [v1.8.0](https://github.com/toZyn/Zyn-Agent/releases/tag/v1.8.0).
