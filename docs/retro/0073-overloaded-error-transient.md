---
issue: 73
issue_title: "Anthropic overloaded_error is surfaced as an unhandled request failure"
---

# Retro: #73 — Anthropic overloaded_error is surfaced as an unhandled request failure

## Stage: Planning (2026-09-23T04:11:29Z)

### Session summary

Third-party issue (filed by `viniciosrab`) evaluated during `/plan-issue` and closed as not planned, with an explanatory comment and no plan file.
`overloaded_error` is Anthropic's HTTP 529 capacity response, and Pi already retries it, so there is nothing in this extension to change.

### Observations

- Pi retries overloaded errors at two layers, both present at the `v0.86.0` peer floor: `retryProviderRequest` in pi-ai's `anthropic-messages.ts`, and `agent-session.ts` `_isRetryableError`, which matches `/overloaded/i` (3 retries by default, backing off 2 s, 4 s, then 8 s).
- The extension never touches this path: `src/billing-version-sync.ts` reads only 400 responses, so a 529 passes through unchanged, and the wrapper runs again on every Pi retry.
- None of the text the extension adds contains a word that matches Pi's non-retryable regex (`billing`, `quota exceeded`, and similar), so our hints cannot turn off Pi's retry.
- The screenshot showed `claude-opus-5` in a custom TUI with `working…` still displayed under the error, which fits Pi's auto-retry still running; this was not confirmed.
- The "unhandled" in the title means the raw JSON reaches the TUI, not an uncaught exception; how that error is displayed belongs to Pi's TUI.
- The operator had seen the same error themselves and judged it transient; the decision was to close as not planned rather than ask for more information or add a docs note.
