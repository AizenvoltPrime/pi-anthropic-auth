---
issue: 79
issue_title: "fix: keep Pi's per-message effort on Opus 5.5, Opus 5, and Fable 5.1"
pr: 79
---

# Keep Pi's per-message effort on managed-effort models

## Release Recommendation

**Release:** ship independently

PR #79 is not part of any roadmap batch in `docs/architecture.md`.
The contributor's `fix:` commit cuts a patch release on its own.

## Problem Statement

On models Pi marks `compat.supportsMidConvoEffort` (Fable 5.1, Opus 5, Opus 5.5), Pi pins the top-level `output_config.effort` to `"high"` and carries the requested effort as content-less `{ role: "system", content: [], output_config: { effort } }` entries in `messages[]`.
`shapeSystemRoleMessages` in `src/request-shaping.ts` drops every system message whose `content` ends up empty, so every effort entry is removed and every request runs at `"high"`.
Nothing errors.
The defect shipped in v3.0.0 with the Issue #69 system-message shaping.

PR #79 (@AizenvoltPrime, commit `a741507`, rebased as `65b14d2`) keeps a system message when it carries `output_config`.
The PR-review stage (`docs/retro/0079-keep-per-message-effort.md`) verified the defect offline and live and chose to adopt the PR mostly as-is, with follow-ups pushed to the PR branch.

## Goals

1. Land the contributor's fix unchanged, rebased onto `main`.
2. Pin Pi's effort-message shape and our passthrough of it with an offline drift test that drives Pi's own transport.
3. Correct the "Anthropic rejects an empty `content` array" claim and name the keep rule in `src/request-shaping.ts`.
4. Record the behavior in `docs/architecture.md`, `AGENTS.md`, and the `upstream-watch` and `anthropic` skills.

## Non-Goals

1. Generalizing the keep rule beyond `output_config` (considered and declined in the PR review).
2. Touching the top-level `output_config`.

## Background

Pi's `insertThinkingLevelMessages` (`packages/ai/src/api/anthropic-messages.ts`, commit `4e69b0c28`, first in v0.85.0) inserts one effort entry before each prior assistant turn whose `providerThinkingLevel` Pi recorded for the same provider, and one trailing entry for the active effort.
The installed pi-ai 0.86.0 catalog sets `supportsMidConvoEffort` on `claude-fable-5-1`.
Live, pi 0.87.1 with `--thinking low`: `main` logged `systemMessagesBefore: 1`, `systemMessagesAfter: 0`; the PR logged `1 → 1` and Anthropic answered 200.

## Design Overview

The drift test lives in a new `test/managed-effort-drift.test.ts`, alongside the two existing sanctioned Pi-internals suites.
It picks the model from Pi's catalog by the `supportsMidConvoEffort` flag rather than by id, so a renamed or retired model does not silently skip the check.
It captures the outgoing body twice through a throwing capturing `fetch` — Pi's bare `anthropicMessagesApi().streamSimple`, and the same transport wrapped in `createAnthropicOAuthStreamSimple` with an `sk-ant-oat` stub token — over a context holding a prior assistant turn recorded at `"medium"`, requested at `"low"`.
It asserts:

1. the catalog still has a managed-effort Anthropic model (the premise);
2. Pi alone still emits the effort entries, historical `"medium"` and active `"low"` (fails when Pi changes the carrier, which would make our keep rule dead code);
3. the wrapped body's effort entries equal Pi's.

In `src/request-shaping.ts`, the inline `message.output_config !== undefined` becomes a named `carriesEffort(message)` predicate whose doc comment holds the rationale, and the `shapeSystemRoleMessages` doc comment states the drop rule precisely: a message our shaping empties is dropped unless it carries effort.
`MessageParam` in `src/anthropic-message.ts` declares `output_config?: unknown`, since shaping now reads it.

## Module-Level Changes

| File | Change |
| --- | --- |
| `src/request-shaping.ts` | contributor's fix; `carriesEffort` predicate; corrected doc comment |
| `src/anthropic-message.ts` | declare `output_config?: unknown` on `MessageParam` |
| `test/request-shaping.test.ts` | contributor's two tests (unchanged) |
| `test/managed-effort-drift.test.ts` | new offline drift suite |
| `docs/architecture.md` | "What the wrapper does" item 2 notes effort entries survive |
| `AGENTS.md` | Current Status item 5, Testing conventions item 3 (third sanctioned exception), Coverage areas |
| `.pi/skills/upstream-watch/SKILL.md` | fix the stale "`messages[]` carries only `user`/`assistant` roles" row; add the effort-carrier row |
| `.pi/skills/anthropic/SKILL.md` | confirmed-local-fixes bullet |

## Test Impact Analysis

No existing test changes.
The contributor's two tests stay as written.

## Invariants at Risk

1. System messages our shaping empties that carry nothing else are still dropped (`drops a mid-conversation docs section update entirely`).
2. API-key requests are never shaped (`test/oauth-transport.test.ts`).

## TDD Order

1. **Rebase (done).**
   `a741507` rebased onto `main` as `65b14d2`, authorship kept.
2. **Invariant pin: managed-effort drift suite.**
   Add `test/managed-effort-drift.test.ts` as designed above.
   It passes on arrival because the fix is already in the branch, so prove it by mutation: with the `output_config` keep clause removed, assertion 3 goes red; with the expected historical effort changed, assertion 2 goes red.
   Commit: `test: pin Pi's per-message effort through the OAuth wrapper (#79)` with the `Co-authored-by` trailer.
3. **Refactor: name the keep rule.**
   Add `carriesEffort`, correct the doc comment, declare `output_config` on `MessageParam`.
   Verify: suite green unchanged, `pnpm run check`.
   Commit: `refactor: name the effort rule that keeps an emptied system message (#79)` with the trailer.
4. **Docs.**
   The four doc files above.
   Commit: `docs: record that effort-carrying system messages survive shaping (#79)` with the trailer.
5. **Live re-check.**
   `PI_ANTHROPIC_AUTH_DEBUG=all pi --model anthropic/claude-fable-5-1 --thinking low -ne --no-session --tools read -e src/index.ts -p "reply with exactly: PONG"` shows `systemMessagesAfter: 1` and `PONG`.

Every follow-up commit ends with:

```text
Co-authored-by: AizenvoltPrime <alex11737@gmail.com>
```

## Risks and Mitigations

1. Force-pushing the rebased branch to the contributor's fork rewrites their commit SHA; authorship is preserved and the operator chose the rebase.
2. The drift suite depends on Pi internals, as the two existing sanctioned suites do; it is listed with them in `AGENTS.md` so it is not read as precedent.
