# Assistant output and terminal lifecycle

## Why 1.8.0 failed

The output path treated any response beginning with prose as prose through its end. A later JSON tool call therefore entered the visible answer. Pretty-printed comment/action objects did not match the newline-only parser. ChatGPT output items lost their boundaries and phases, and streamed previews could be committed before the final action was known. Retrying after visible output replayed progress. The tool dispatcher separately flattened command output into a 100-character preview.

The original visual fixtures appended already-clean text directly to the UI store. Those tests exercised rendering but bypassed the provider, protocol decoder, tool dispatcher and agent loop where these failures originated.

## Current boundaries

- The Responses adapter preserves item/content IDs and commentary/final-answer phases. Delta, text-done and item-done events reconcile into the same fragment; authoritative snapshots replace rather than concatenate earlier text.
- `response-protocol.js` scans complete top-level objects and partial content strings while respecting nested braces and escapes. Tool envelopes are control data; comments and final content are separate parts. Incomplete control data is withheld from prose and is never executed.
- `AssistantStream` owns one request's stable part IDs. Provisional text preceding a tool becomes commentary in the same part. Finishing a response updates existing parts once. Provider commentary cannot finish the agent turn simply because its inner text uses a final envelope.
- The UI store replaces parts by ID. Rendering consumes decoded text, not protocol JSON, and does not unescape an already-decoded answer a second time.
- A transport failure after visible progress is surfaced instead of transparently replaying that progress. Empty responses terminate without an empty-comment continuation loop. Existing tool-result no-progress detection remains enabled.
- Direct command responses use the same lifecycle. Command results preserve complete lines in their tool event; assistant answers do not consume those event bodies as prose.

Markdown is parsed before terminal wrapping so emphasis spans remain intact. Ordered items preserve their explicit numbers across nested lists. Oversized tables switch to wrapping labeled rows instead of truncating cell contents. Identifier underscores and literal backslashes remain data.

## Reference implementations inspected

- [OpenCode event publisher](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/runner/publish-llm-event.ts): separate text, reasoning, tool-input and execution events, fragment IDs, authoritative ended values and no transparent retry after output starts.
- [OpenCode message updater](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/message-updater.ts): update the owning assistant and content part instead of appending a second final message.
- [Codex response-item handling](https://github.com/openai/codex/blob/main/codex-rs/core/src/stream_events_utils.rs): preserve message phase, distinguish commentary from final answers, and route tool calls separately from assistant text.

Zyn retains its own JSON control protocol for compatible providers; this is not a port of either implementation.

## Regression coverage

`response-protocol-regression.test.mjs` exercises every prefix of mixed prose/tool responses, pretty JSON, incomplete and malformed envelopes, native message phases and authoritative completion events. `agent-stream-lifecycle.test.mjs` exercises the actual agent loop and command execution with only the remote model request replaced.

`hardware_stream_pty.py` runs the actual terminal app, Responses adapter, agent loop, command confirmation, command execution and subagent coordinator against a simulated SSE service. It verifies live commentary before tool approval, resizing while active, complete results, unique final output, Markdown, ordered lists, literal paths and interactive questions followed by a child agent. These fixtures do not authenticate to or evaluate a real provider/model.
