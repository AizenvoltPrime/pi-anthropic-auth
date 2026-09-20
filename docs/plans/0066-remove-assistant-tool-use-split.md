---
issue: 66
issue_title: "splitAssistantToolUseTrailingContent breaks interleaved thinking: 400 \"thinking blocks in the latest assistant message cannot be modified\""
---

# Remove the assistant tool-use split

## Release Recommendation

**Release:** ship independently

`docs/architecture.md` carries no numbered roadmap and no `Release:` annotations, so this issue is not a batch member.
It is a non-breaking bug fix (`fix:`) and ships as `3.0.1`.

## Problem Statement

`splitAssistantToolUseTrailingContent` rewrites any assistant message that has a non-`tool_use` block after a `tool_use` block, hoisting every non-`tool_use` block into a preceding assistant message.
On a Claude response with interleaved thinking — `[thinking, tool_use, thinking, tool_use]` — that produces `[thinking, thinking]` followed by `[tool_use, tool_use]`, moving signed `thinking` blocks away from the `tool_use` they preceded.
Anthropic then rejects the next request with a 400 and the session is wedged: every retry fails identically.

Investigation found a larger problem behind the reported one.
The split exists to prevent an Anthropic rejection of `[tool_use..., text]` that, measured live, does not occur.

## Goals

1. Interleaved-thinking assistant turns reach Anthropic exactly as Pi serialized them, so the reported 400 cannot occur.
2. Remove `splitAssistantToolUseTrailingContent` rather than special-casing `thinking` inside it, retiring the whole class of block-reordering corruption.
3. Record the live measurements that justify the removal, so a future regression is diagnosable rather than re-litigated from first principles.
4. Keep the OAuth gate, billing-header injection, and system-prompt shaping untouched.

This change is **not** breaking.
It alters no public API, no exported symbol, no configuration key, and no default value; the removed function is private to `src/request-shaping.ts`.
It does change the bytes this extension sends for OAuth tool-use turns — see Risks.

## Non-Goals

1. Issue #65 (compaction reasoning-extraction refusal) is untouched, even though it also concerns request content.
2. Issue #46 (background-agent coverage gap) and Issue #53 (compat-dispatch re-examination) are unchanged; this plan edits shaping, not the seam.
3. No change to `src/system-prompt-shaping.ts`, `src/system-prompt-sections.ts`, `src/oauth-transport.ts`, `src/host-transport.ts`, or `src/constants.ts`.
4. No new guard, telemetry, or warning that watches for a future Anthropic rejection of trailing text — see Open Questions.
5. `docs/plans/gap-analysis-and-next-steps.md` is not rewritten.
   It is a historical record of what was believed in April 2026, and its line-numbered references to `src/request-shaping.ts:148-185` are already stale.
   `README.md` needs no edit: its "What It Does" section describes the OAuth gate and the transport wrapper, and never enumerates the individual shaping steps.
6. No attempt to reproduce the reporter's exact two-thinking-block payload; see Design Overview, "What was and was not reproduced".

## Background

### The code

`splitAssistantToolUseTrailingContent` (`src/request-shaping.ts`) is a private helper called from `shapeAnthropicOAuthPayload`:

```typescript
const normalizedMessages = shapeSystemRoleMessages(
  splitAssistantToolUseTrailingContent(messages),
);
```

It finds the first `tool_use` block, checks whether any block at or after that index is not a `tool_use`, and if so emits two assistant messages: all non-`tool_use` blocks, then all `tool_use` blocks.
It has no other caller.

### Where it came from

The helper was ported from OpenCode in commit `52819a9`, on the strength of an OpenCode source comment.
`docs/plans/gap-analysis-and-next-steps.md:180-188` records the reasoning verbatim: OpenCode "rewrites assistant messages where `tool-call` parts are followed by text parts in the same assistant turn", describing Anthropic as rejecting `[tool_call, tool_call, text]`, and concludes "This is the strongest remaining candidate for a real Pi compatibility gap."

That candidate was never tested against Anthropic from this repository.
The docstring's justification — that text and `tool_use` are "semantically independent within a single turn" — is also the claim the issue correctly identifies as false for `thinking`.

### Constraints from `AGENTS.md`

1. Keep the override thin; prefer the smallest integration point that works.
2. Prefer request shaping before prompt rewriting, and do not over-port from OpenCode.
3. Shaping is gated on the `sk-ant-oat` prefix; nothing here changes that gate.
4. Live repro before treating a change as done; the operator has already chosen unit tests plus a live OAuth repro.

## Design Overview

### The change

Delete `splitAssistantToolUseTrailingContent` and its call, leaving:

```typescript
const normalizedMessages = shapeSystemRoleMessages(messages);
```

`shapeSystemRoleMessages` touches only `role: "system"` messages, so after the removal `shapeAnthropicOAuthPayload` never alters an assistant message.
Pi's block order reaches Anthropic verbatim, which is what makes the reported corruption impossible by construction rather than by special case.

### Evidence: how the diagnosis was produced

Two measurements were taken against the real code path, not against hand-built models of it.

First, Pi's own serializer was run — `streamSimple` from `@earendil-works/pi-ai/compat` with `getBuiltinModel("anthropic", …)`, a `Context` carrying an interleaved-thinking assistant turn, a mocked SSE response, and an `onPayload` capture.
Pi 0.86.0 emits `["thinking","tool_use","thinking","tool_use"]` verbatim.
This is the same technique `test/pi-anthropic-ordering-experiment.test.ts` already uses.

Second, `shapeAnthropicOAuthPayload` was run over that shape and three neighbours.
Measured on `main`:

| Pi's assistant content | today's output |
| --- | --- |
| `[thinking, tool_use, thinking, tool_use]` | `[thinking, thinking]` + `[tool_use, tool_use]` |
| `[thinking, tool_use, text]` | `[thinking, text]` + `[tool_use]` |
| `[tool_use, tool_use, text]` | `[text]` + `[tool_use, tool_use]` |
| `[thinking, text, tool_use]` | unchanged |

### Evidence: the split's premise is false

A live probe sent assistant histories to `https://api.anthropic.com/v1/messages` over the operator's Claude Max OAuth token, with the Claude Code OAuth headers Pi sends (`authorization: Bearer sk-ant-oat…`, `anthropic-beta: claude-code-20250219,oauth-2025-04-20`, `user-agent: claude-cli/2.1.260`, `x-app: cli`) and a `system[]` built by this extension's own `shapeAnthropicOAuthPayload`, followed by matching `tool_result` blocks.
All values below are measured, one trial per cell:

| assistant history shape | sonnet-4-5 | haiku-4-5 | sonnet-5 | fable-5 | opus-4-8 |
| --- | --- | --- | --- | --- | --- |
| `[tool_use, tool_use, text]` | 200 | 200 | 200 | 200 | 200 |
| `[text, tool_use, text, tool_use]` | 200 | 200 | 200 | 200 | 200 |
| `[text]` + `[tool_use, tool_use]` (today's output) | 200 | 200 | 200 | 200 | 200 |

Anthropic accepts trailing text after `tool_use`, and accepts text interleaved between `tool_use` blocks.
The rejection the helper was written to prevent does not occur on any model this extension serves.

A second probe used organically generated, genuinely signed `thinking` blocks — a real Anthropic response captured and replayed — rather than forged signatures, which would have confounded every result.
With one `thinking` block in the turn, `[thinking, tool_use, text]` unshaped, today's shaped output, and even a deliberately displaced `[text, thinking, tool_use]` all returned 200.

### What was and was not reproduced

The reporter's 400 was **not** reproduced here, and the plan labels that evidence as inferred.
Across four models and two prompt strategies, no model would emit two `thinking` blocks in a single assistant turn on demand, so the exact payload could not be replayed.

The single-`thinking`-block results above explain why, and are consistent with the report: Anthropic merges consecutive same-role messages, so hoisting one `thinking` block out of a turn reconstructs the original order and is a no-op.
With two `thinking` blocks the hoist genuinely reorders them relative to the intervening `tool_use`, which is what the signature check catches.
That inference is not load-bearing.
The removal is justified by the trailing-text measurements alone: a transformation with no reason to exist should not exist, regardless of the precise mechanism by which it broke.

### Debug-log consequence

With the split gone, `messages` and `normalizedMessages` can differ only in `role: "system"` entries.
Three of the debug log's before/after pairs become tautological — `assistantMessagesBefore`/`assistantMessagesAfter` and `toolUseNamesBefore`/`toolUseNamesAfter` can no longer differ.
A before/after pair that cannot differ is misleading in a debug log whose purpose is to show what shaping changed, so both collapse to a single field.
`systemMessagesBefore`/`systemMessagesAfter` stay: `shapeSystemRoleMessages` can still drop a message.
These field names appear in no test and no document, so the rename is free.

## Module-Level Changes

### `src/request-shaping.ts`

1. Remove `splitAssistantToolUseTrailingContent` and its docstring.
2. Remove its sole call from `shapeAnthropicOAuthPayload`, leaving `shapeSystemRoleMessages(messages)`.
3. Collapse `assistantMessagesBefore`/`assistantMessagesAfter` to `assistantMessages` and `toolUseNamesBefore`/`toolUseNamesAfter` to `toolUseNames` in the `debugLog` call.
   `countAssistantMessages` and `getToolUseNames` each retain a call site and are not removed.
4. Extend the `shapeAnthropicOAuthPayload` docstring to state that assistant messages pass through unmodified, and why.

### `test/pi-anthropic-ordering-experiment.test.ts`

1. Rewrite `"experiment: current hook reshaping splits assistant tool_use blocks from trailing text"` to assert the turn is now passed through unchanged, and drop "hook" from the title — shaping has run in the transport wrapper since Issue #18.
2. Keep `"experiment: Pi serializer preserves trailing assistant text after tool_use blocks"`; it characterizes Pi, not us.
3. Keep `"experiment: current hook reshaping leaves already-valid assistant ordering unchanged"`, retitled for the same reason.
4. Add a Pi-serializer characterization that Pi emits `["thinking","tool_use","thinking","tool_use"]` verbatim for an interleaved-thinking turn.
5. Add the Issue #66 regression pin: `shapeAnthropicOAuthPayload` preserves that block order and emits exactly one assistant message.

### `docs/architecture.md`

1. In "What the wrapper does", remove list item 1 ("normalizes assistant message ordering when Pi serializes `[tool_use..., text]` for Anthropic") and renumber the remaining three.
2. Add a short subsection recording the measurement: what was probed, on which models, on what date, and the conclusion that Anthropic does not reject trailing text after `tool_use`.
   This is the artifact that stops the OpenCode claim from being re-adopted.

### `.pi/skills/anthropic/SKILL.md`

1. Under "Confirmed local fixes", replace "Assistant message ordering must be normalized when Pi serializes `[tool_use..., text]` for Anthropic." with the measured finding and its date.
2. Under "Shape in the `streamSimple` transport wrapper", remove the "assistant message ordering normalization" bullet.
3. Under "Avoid by default", note that `[tool_use..., text]` reordering was measured unnecessary and removed in Issue #66, so it is not re-added without a fresh live rejection.

### `AGENTS.md`

1. In the Extension Surface paragraph, drop "message ordering" from the list of provider-specific logic the `onPayload` step runs.
2. In "Current Status", confirm no item claims ordering normalization before finalizing; adjust if one does.
3. In "Coverage areas", update the `test/pi-anthropic-ordering-experiment.test.ts` description to mention the interleaved-thinking pin.

### `docs/comparison-to-similar-projects.md`

1. Update list item 4 ("assistant tool-use ordering normalization when text trails `tool_use` content in the same assistant turn") so it no longer lists a behavior this extension has.
   The surrounding passage frames these as alignments with `pi-anthropic-oauth`; the entry becomes a divergence with a one-line reason.

### Verified as needing no change

1. `README.md` — no enumeration of shaping steps; only `PI_ANTHROPIC_AUTH_DEBUG=tool-use` mentions `tool_use`, and that flag is unaffected.
2. `test/request-shaping.test.ts` — its one assistant-message fixture carries a text block only, no `tool_use`.
3. `src/oauth-transport.ts`, `src/debug.ts`, `src/diagnostics.ts`, `src/index.ts` — no reference to the removed helper.

## Test Impact Analysis

### New coverage this enables

1. A regression pin for interleaved thinking that was previously impossible to state, because the behavior it pins (passthrough) did not exist.
2. A Pi-serializer characterization for thinking blocks, extending the existing tool-use characterization to the block type that actually broke.

### Tests that become redundant

None are removed.
The two split-asserting tests are inverted rather than deleted: the question "what does shaping do to `[tool_use, tool_use, text]`?" is still worth pinning, and the answer changes from "splits it" to "leaves it alone".
Keeping them as passthrough assertions is what would catch an accidental reintroduction.

### Tests that must stay as-is

1. `"experiment: Pi serializer preserves trailing assistant text after tool_use blocks"` — it characterizes Pi's serializer, which this change does not touch, and it is the tripwire if Pi starts normalizing ordering itself.
2. Every suite in `test/request-shaping.test.ts` covering billing headers, system blocks, beta merging, and the structural payload guard.
3. `test/system-prompt-shaping.test.ts` and `test/system-prompt-sections.test.ts` — untouched surfaces.

## Invariants at risk

1. Assistant turns never send non-`tool_use` content after `tool_use`.
   This invariant is deliberately retired.
   It was asserted by `test/pi-anthropic-ordering-experiment.test.ts:240-243` and documented in `docs/architecture.md` and the `anthropic` skill; all three are updated in this plan, so no prose outlives the behavior.
   Measured replacement: Anthropic returns 200 for that shape on all five models this extension serves (table above).
2. Every OAuth request carries exactly one `x-anthropic-billing-header` system block.
   Unchanged — the billing header is computed from the first user message's text, which the split never touched.
   Pinned by `test/request-shaping.test.ts`.
3. Assistant message count is preserved through shaping.
   This becomes true for the first time; today the split can add a message.
   Predicted post-change value for the reporter's payload: 1 assistant message in, 1 out (measured today: 1 in, 2 out).
4. Non-OAuth and non-Anthropic payloads pass through untouched.
   Unchanged; the token gate in `src/oauth-transport.ts` is not edited.

## TDD Order

1. `test:` characterize Pi's interleaved-thinking serialization.
   Surface: `test/pi-anthropic-ordering-experiment.test.ts`.
   Covers: Pi 0.86.0 emits `["thinking","tool_use","thinking","tool_use"]` for an assistant turn with interleaved thinking, via `streamSimple` + mocked SSE + `onPayload` capture.
   This passes on `main` — it is a characterization of upstream, not of our code, and it establishes the input the next step asserts on.
   Commit: `test: characterize pi interleaved-thinking serialization`.
2. `test:` pin the Issue #66 regression (red).
   Surface: `test/pi-anthropic-ordering-experiment.test.ts`.
   Covers: `shapeAnthropicOAuthPayload` leaves `[thinking, tool_use, thinking, tool_use]` as one assistant message with its block order intact.
   Fails on `main` with two assistant messages.
   Commit: `test: pin interleaved-thinking passthrough for anthropic oauth shaping`.
3. `fix:` remove the split (green).
   Surface: `src/request-shaping.ts`, `test/pi-anthropic-ordering-experiment.test.ts`.
   Covers: delete `splitAssistantToolUseTrailingContent` and its call; invert the two split-asserting tests to passthrough assertions and retitle them.
   The test rewrite lands in this commit because those assertions fail the moment the helper is gone.
   Commit: `fix: stop reordering assistant tool-use content for anthropic oauth`.
4. `refactor:` collapse the tautological debug fields.
   Surface: `src/request-shaping.ts`.
   Covers: `assistantMessages` and `toolUseNames` replace their before/after pairs.
   `refactor:` keeps this out of the changelog, so the release carries one entry for the fix rather than two.
   Commit: `refactor: collapse invariant before/after fields in the oauth debug log`.
5. `docs:` update the four documents.
   Surface: `docs/architecture.md`, `.pi/skills/anthropic/SKILL.md`, `AGENTS.md`, `docs/comparison-to-similar-projects.md`.
   Covers: remove the ordering-normalization claims and record the live measurement with its date and model list.
   Commit: `docs: record that anthropic accepts trailing text after tool_use`.
6. Live OAuth repro before ship — no commit.
   Run a real agentic `pi` session on `anthropic/claude-sonnet-5` with thinking enabled and several tool calls, loading only the local copy (`-ne -e src/index.ts`), with `PI_ANTHROPIC_AUTH_DEBUG=tool-use`.
   Verify no 400, and that the log shows a single assistant message per turn.
   Gate on the operator via `ask_user`, since it needs their Claude Max session.

## Risks and Mitigations

1. An unswept model or endpoint still rejects trailing text after `tool_use`.
   The sweep covered sonnet-4-5, haiku-4-5, sonnet-5, fable-5, and opus-4-8 — the models a Claude Pro/Max OAuth user reaches.
   Shaping is gated on `sk-ant-oat`, so nothing here affects API-key traffic or the nine other `anthropic-messages` providers.
   The recorded measurement in `docs/architecture.md` names the date and models, so a future rejection is diagnosed as drift rather than re-derived.
2. Anthropic reintroduces the constraint later.
   The failure would be a loud 400 on tool use, not silent corruption, and the retained passthrough tests localize it immediately.
   Restoring a narrower helper is cheap; the reverse — keeping an unnecessary transformation that corrupts signed content — is what wedges sessions today.
3. The reported 400 was misattributed and the split is not the cause.
   Independent of attribution, our shaping demonstrably rewrites the reporter's exact block order (measured), and after this change it does not.
   If a 400 persists in their session afterward, the cause is upstream of this extension and the smaller surface makes that easier to establish.
4. One trial per cell in the probe table.
   Request validation is deterministic, unlike the refusal classifiers the `anthropic` skill warns about, so repeated trials add nothing here.
   A 400 for an invalid message shape is a schema check, not a sampled judgment.
5. Losing the OpenCode-derived protection for non-Anthropic Anthropic-compatible endpoints.
   Not applicable: this extension's shaping only ever runs for `sk-ant-oat` tokens against `api.anthropic.com`.

## Open Questions

1. Should a warning fire if Pi ever emits a shape Anthropic rejects?
   Deferred, not filed as an issue: it is speculative instrumentation for a failure mode with zero observed instances, and a 400 is already self-describing.
2. Does Anthropic merge consecutive same-role assistant messages, or tolerate them?
   The single-`thinking`-block results are consistent with merging, but the question is moot once we stop producing consecutive assistant messages.
   Recorded here so a future session does not re-derive it.
3. Was OpenCode's original workaround for the Anthropic API at all, or for an SDK-level shape?
   The OpenCode tree was not readable from this session's sandbox.
   The answer would be historical colour only; the live measurement settles the behavior for this extension.
