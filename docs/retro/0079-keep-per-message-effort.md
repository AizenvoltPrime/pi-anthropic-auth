---
issue: 79
issue_title: "fix: keep Pi's per-message effort on Opus 5.5, Opus 5, and Fable 5.1"
pr: 79
---

# PR #79: keep Pi's per-message effort on Opus 5.5, Opus 5, and Fable 5.1

## Stage: PR Review (2026-09-24T18:06:19Z)

### Session summary

PR #79 from @AizenvoltPrime keeps content-less `role: "system"` messages that carry `output_config`, which `shapeSystemRoleMessages` drops on every OAuth request, so the effort chosen on managed-effort models (Fable 5.1, Opus 5, Opus 5.5) silently never reaches Anthropic.
The defect is real, has shipped since v3.0.0, and was reproduced offline and live on current `main`.
The operator chose to adopt the PR mostly as-is, keeping its `output_config` predicate, and to add follow-ups as commits pushed directly to the PR branch (`maintainerCanModify: true`).

### Evaluation

Verify gate (all against current `main`, `2fe3355`):

1. Upstream shape confirmed in the `~/development/pi/pi` clone: `insertThinkingLevelMessages` in `packages/ai/src/api/anthropic-messages.ts` (commit `4e69b0c28`, first in v0.85.0) pins top-level `output_config.effort` to `"high"` for `compat.supportsMidConvoEffort` models and emits `{ role: "system", content: [], output_config: { effort } }` before each historical assistant turn and at the tail.
   The installed pi-ai 0.86.0 catalog sets that flag on `claude-fable-5-1`.
2. Offline repro: a scratch test drove `anthropicMessagesApi().streamSimple` wrapped in `createAnthropicOAuthStreamSimple` for `claude-fable-5-1` with `reasoning: "low"` and a capturing `fetch`.
   Pi alone sent `messages: [user, system{content:[], effort:low}]`; with the extension, `messages: [user]`.
   The scratch file was deleted.
3. Live repro, pi 0.87.1, `--thinking low`, `PI_ANTHROPIC_AUTH_DEBUG=all`, `-ne`: `main` logged `systemMessagesBefore: 1`, `systemMessagesAfter: 0`; the PR branch logged `1 → 1` and Anthropic answered `PONG` (200), so the OAuth path accepts the empty-content effort message.
4. Boundary: the drop happens in `shapeSystemRoleMessages` (`src/request-shaping.ts`), added in `2817a54` for Issue #69 and first released in v3.0.0.
   The PR patches exactly that line.
5. Regression direction: messages our shaping empties that carry nothing else are still dropped; API-key requests never reach shaping.
   No degradation found.

Checks on the PR branch: `pnpm run check`, `pnpm run lint` clean, `pnpm test` 159/159.
Merged onto current `main` (the PR base `857b976` lags it by the #70/#53 work): 196/196, no conflicts.
Both new tests in `test/request-shaping.test.ts` fail with `main`'s `src/request-shaping.ts` restored.

Design: right-sized — a three-line predicate change at the exact boundary, with a doc-comment note and two focused tests.
The `output_config !== undefined` predicate names Pi's actual shape; the more general "any field besides `role`/`content`" rule was considered and not chosen.
Behavior: restores Pi's own request shape, so `fix:`, not breaking.
Surface: no token or auth handling touched.

What is stale around it: the `shapeSystemRoleMessages` docstring still asserts "Anthropic rejects an empty `content` array", which is now only true of messages without `output_config`; and `docs/architecture.md` "What the wrapper does" item 2 does not mention that effort-carrying system messages survive shaping.

### Decision and attribution

Direction: adopt the PR mostly as-is, keeping its `output_config` predicate.
Follow-ups, pushed as our own commits to the PR branch `AizenvoltPrime:fix/keep-per-message-effort` (fall back to follow-up commits on `main` if the push is refused):

1. Correct the empty-`content` claim in the `shapeSystemRoleMessages` docstring.
2. Note in `docs/architecture.md` (and the matching `AGENTS.md` Current Status item 5, if it reads as incomplete) that effort-carrying system messages survive shaping.
3. Add an offline drift test that drives Pi's own transport for a `supportsMidConvoEffort` model through the wrapper and asserts the `output_config` system messages survive — a third sanctioned exception to the no-Pi-internals test rule, to be listed beside `test/upstream-prompt-drift.test.ts` and `test/claude-code-version-drift.test.ts` in `AGENTS.md` Testing Guidance.
4. Any further design improvements to production code or tests are welcome.

Non-goals: generalizing the keep rule beyond `output_config`; touching top-level `output_config`.

Attribution: every follow-up commit carries the trailer (blank line before it, at the end of the body):

```text
Co-authored-by: AizenvoltPrime <alex11737@gmail.com>
```

The PR close/merge comment thanks @AizenvoltPrime by name and links the implementing SHA(s).
Reference the PR as `Refs #79` / `(#79)`, never `Closes #79`.
