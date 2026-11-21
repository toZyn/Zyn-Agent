# Mobile terminal UX changes (unreleased)

This work is under test in `fix/mobile-tui-onboarding-and-auth`. It is not included in the currently published `zyn-ai@1.7.0` release.

- English is the default regardless of `LANG`. Saved session language and explicit `ZYN_LANGUAGE`/`ZYN_DEFAULT_LANG` still override the default. `/lang` opens an interactive language picker; `/lang en` and `/lang es` switch the TUI live.
- First-launch profile import offers a short, three-line framed preview and clipboard copy without dumping the whole export prompt into the terminal. The full prompt is available only on explicit request; clipboard fallback status is not misleading.
- TUI ChatGPT authorization is a temporary, dismissible panel with browser launch, clipboard copy and explicit URL inspection. URLs are not printed into history by default. On successful consent, users can choose the real account model ID.
- The classic CLI login has equivalent compact copy/show/cancel controls. Remote SSH still requires the browser to reach the loopback callback; this does not bypass OAuth or account eligibility.
- Model labels show provider IDs without artificial `chatgpt-` prefixes. Internal namespacing resolves collisions with other providers, and legacy session aliases are supported.
- Tool permission requests use a dedicated, bounded, expandable and scrollable confirmation panel, with `Enter` or `N` defaulting to denial.
- Initial banner uses two lines, with conversation history anchored near the input rather than separated by unnecessary empty rows.
- Misspelled slash commands suggest a close match without running it.

Verification: `npm run test:all`, `npm run bench:tui`, and `tests/mobile_ux_pty.py` on PTY dimensions resembling mobile terminals. These do not establish stability with every Android terminal or every OAuth provider and should be supplemented by real-device feedback.
