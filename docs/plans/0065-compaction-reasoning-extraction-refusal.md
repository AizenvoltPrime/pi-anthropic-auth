---
issue: 65
issue_title: "/compact fails with message that it violates Anthropic's ToS"
---

# Strip transcribed assistant reasoning from Anthropic OAuth summarization requests

## Release Recommendation

**Release:** ship independently

`docs/architecture.md` carries no roadmap step for this issue and no `Release:` annotation, so there is no batch to wait on.
The change touches `src/`, `test/`, `README.md`, and `docs/architecture.md`, all inside the release scope, so the `fix:` commit cuts a patch release on its own.

## Problem Statement

Issue [#65] reports that `/compact` fails once the context is full, with:

```text
Error: Compaction failed: Turn prefix summarization failed: This request was blocked as it
seems to violate Anthropic's Terms of Service restrictions on reverse engineering or
duplicating model outputs. To learn more, visit https://www.anthropic.com/legal/commercial-terms.
```

The refusal is Anthropic's `reasoning_extraction` classifier, and it fires because Pi transcribes the assistant's **thinking blocks** into the summarization prompt as plain text.

Pi's `serializeConversation` emits one `[Assistant thinking]: <reasoning prose>` paragraph per assistant turn that produced thinking, wraps the whole transcript in `<conversation>` tags, and sends it as a single user message alongside a "read a conversation between a user and an AI assistant, then produce a structured summary" system prompt.
Anthropic's own Fable 5 guidance names this shape directly:

> **Don't instruct Claude to reproduce its reasoning in the response.** Prompts, skills, or harness instructions that tell the model to echo, transcribe, or explain its internal reasoning as response text can trigger the `reasoning_extraction` refusal category on Claude Fable 5 […] Audit existing skills and system prompts for reflection or show-your-thinking instructions when migrating.
>
> — <https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5>

<!-- -->

> The `stop_details.category` field on refusal responses now includes `"reasoning_extraction"` on Claude Fable 5, returned when a request is blocked under Anthropic's Terms of Service restrictions on reverse engineering or duplicating model outputs.
>
> — Claude Platform release notes, 2026-06-09

The root cause is upstream Pi, not this extension.
The mitigation lands here anyway because this extension already owns the only seam that sees every OAuth summarization payload, and because upstream relief is not on a predictable schedule.

## Goals

- Remove `[Assistant thinking]: …` segments from the serialized `<conversation>` transcript on Anthropic OAuth summarization requests, so compaction, turn-prefix summarization, and branch summarization stop tripping `reasoning_extraction`.
- Gate the removal on two upstream anchors — the summarization system prompt and the `<conversation>` envelope — so ordinary user messages that happen to quote a Pi transcript are never rewritten.
- Compute the billing header's `cch` hash from the stripped text, so the header keeps describing what actually goes on the wire.
- Pin both new anchors against the installed Pi with drift tests, matching the treatment `PI_DEFAULT_PROMPT_PREFIX` already gets.
- Document the behavior for users: compaction summaries no longer carry the assistant's reasoning, and that is deliberate.
- Draft an upstream bug report for `earendil-works/pi` (appendix below), for the operator to submit by hand.

This change is **not breaking**.
No exported symbol, configuration key, default value, or command output changes.
It does alter the content of one class of outbound request — OAuth summarization calls lose transcribed reasoning — which is the fidelity cost stated in Risks below, not an API change.
The suggested commit type is therefore `fix:`, not `fix!:`.

## Non-Goals

- **No model gating.** The strip applies to every Anthropic OAuth summarization request, not only Fable/Mythos models. Chasing a model-name list has already cost this repo two emergency `CLAUDE_CODE_VERSION` bumps (Issue [#60]), and Anthropic's anti-distillation posture is expanding rather than contracting.
- **No opt-out environment variable.** Considered and declined; see Open Questions.
- **No change to the main agent loop.** Real thinking blocks in interactive turns are structured `thinking` content, not transcribed prose, and are not implicated. `src/system-prompt-shaping.ts` is untouched.
- **No change to OAuth gating.** The `sk-ant-oat` gate in `src/oauth-transport.ts` stays exactly as it is; `src/oauth-transport.ts` and `src/host-transport.ts` are not edited.
- **Not fixing it upstream ourselves.** Pi's `CONTRIBUTING.md` forbids PRs from contributors who have not been approved with `lgtm`. The deliverable here is a drafted issue, not a patch.
- **Not covering background agents.** Requests that dispatch through pi-ai's `compat.streamSimple` still bypass the wrapper (Issue [#46]); a background agent that compacts is still exposed. That gap is tracked separately.
- **Not addressing API-key Pi users.** The classifier is model-side and almost certainly hits them too, but this extension only shapes OAuth requests by design.

## Background

### The failing request

All three of Pi's summarization paths build the same payload shape:

1. `compact` → `generateSummaryWithRequest`
2. turn-prefix summarization → `summarizeTurnPrefix` (the path named in the issue)
3. branch summarization → `generateBranchSummary`

Each calls `serializeConversation`, wraps the result in `<conversation>…</conversation>`, appends a format prompt, and sends it as one user message with `SUMMARIZATION_SYSTEM_PROMPT` as the system prompt.
In the installed Pi 0.84.0 the serializer lives at `node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/utils.js` and emits exactly five paragraph markers, joined with `\n\n`:

```text
[User]: …
[Assistant thinking]: …
[Assistant]: …
[Assistant tool calls]: …
[Tool result]: …
```

### Why the extension sees it

Compaction reuses `agent.streamFunction`, so it dispatches through `modelRuntime` and reaches this extension's `streamSimple` wrapper — the call path `docs/architecture.md` already records as covered.
`shapeAnthropicOAuthPayload` in `src/request-shaping.ts` is therefore invoked on every one of these requests today; it just has nothing to say about them, because they carry no Pi preamble for `shapeSystemBlocks` to match.

### Constraints from AGENTS.md

- "Prefer Request Shaping Before Prompt Rewriting. […] Do not add broader prompt rewriting unless real failures show it is necessary." This is a real failure, measured; the change is scoped to exactly the failing payload class.
- "Isolate Compatibility Logic. […] Keep compatibility logic in small helpers." Hence a new `src/summarization-shaping.ts` rather than growing `src/request-shaping.ts` with string surgery.
- Anchor strings copied from upstream belong in `src/constants.ts` and get a drift test — the pattern established for `PI_DEFAULT_PROMPT_PREFIX` by Issue [#52].
- Tests build fixtures inline; `test/upstream-prompt-drift.test.ts` is the one sanctioned exception that imports Pi internals, because depending on the internal *is* the verification.

## Design Overview

### Measured evidence

All rows below are **measured** live against `claude-fable-5` on 2026-09-14, using a disposable spike that drove the built-in Anthropic transport with a real `sk-ant-oat` token and the turn-prefix summarization prompt.
Every row used the identical transcript (~30 `[Assistant thinking]` paragraphs of first-person reasoning prose).
The spike was removed after measurement.

| Variant | Result |
| --- | --- |
| `[Assistant thinking]` present, shaped by this extension | `rawStopReason: "refusal"` — the exact message from Issue [#65] |
| `[Assistant thinking]` present, **unshaped** (built-in transport, no billing header, no system shaping) | identical refusal |
| marker relabeled to `[Assistant notes]:`, content unchanged | identical refusal |
| marker relabeled to `[Notes]:`, content unchanged | identical refusal |
| thinking segments **removed** | `end_turn`, correct structured summary |

Two conclusions drive the design:

1. The extension is not the cause — the unshaped control refuses identically. Removing the billing header or the system shaping does not help.
2. Only removal works. The classifier reads the reasoning prose, not the label, so no relabeling or reframing mitigation is viable.

A short transcript (one thinking paragraph, six segments) passed in the same run, so the trigger is volume-dependent.
That matches the issue's "fill up the context" precondition and means a test cannot assert the refusal — only the payload transformation.

### Decision model

Shaping applies when **both** anchors are present:

1. some `system[]` block contains `PI_SUMMARIZATION_SYSTEM_PROMPT_ANCHOR` (`"You are a context summarization assistant."`), and
2. a user message's text block contains a `<conversation>…</conversation>` envelope.

Requiring both makes a false positive require a user to send a message containing a transcript envelope *while* Pi is running a summarization request — which cannot happen, because summarization requests are synthesized by Pi and contain exactly one user message.

### Segment parsing

The serializer joins parts with `\n\n`, but a thinking paragraph can itself contain blank lines, so a naive `split(/\n\n+/)` would orphan the tail of a multi-paragraph reasoning block.
Split instead on paragraph boundaries that are immediately followed by a known marker:

```typescript
/** Paragraph markers `serializeConversation` emits, in the order it emits them. */
export const PI_TRANSCRIPT_MARKERS = [
  "[User]: ",
  "[Assistant thinking]: ",
  "[Assistant]: ",
  "[Assistant tool calls]: ",
  "[Tool result]: ",
] as const;

export const PI_TRANSCRIPT_THINKING_MARKER = "[Assistant thinking]: ";
```

Anything after a blank line that is *not* a known marker stays attached to the segment it follows, so a multi-paragraph reasoning block is removed whole.

### New module

`src/summarization-shaping.ts` stays purely string-level — it never sees a payload or a message — so `src/request-shaping.ts` keeps ownership of the payload types it already declares.

```typescript
export type StrippedTranscriptReport = {
  text: string;
  removedSegments: number;
};

/** True when `text` is Pi's summarization system prompt. */
export function isSummarizationSystemText(text: string): boolean;

/**
 * Remove `[Assistant thinking]` segments from every `<conversation>` envelope
 * in `text`, leaving text outside the envelope untouched.
 */
export function stripTranscribedThinking(text: string): StrippedTranscriptReport;
```

### Call site

The consumer is `shapeAnthropicOAuthPayload`, and the interaction is Tell-Don't-Ask — it hands over text and takes back text plus a count, never inspecting intermediate state:

```typescript
const isSummarization = systemBlocks.some((block) => isSummarizationSystemText(block.text));
const { messages: strippedMessages, removedSegments } = isSummarization
  ? stripThinkingFromUserMessages(messages)
  : { messages, removedSegments: 0 };
const normalizedMessages = splitAssistantToolUseTrailingContent(strippedMessages);
const finalSystem = prependBillingHeader(shapedSystem, normalizedMessages);
```

Ordering matters: the strip runs **before** `prependBillingHeader`, so `buildBillingHeaderValue` hashes the text that is actually sent.
Reversing the order would emit a `cch` describing a message body Anthropic never receives.

`stripThinkingFromUserMessages` is a private helper in `src/request-shaping.ts` that walks `MessageParam[]`, applies `stripTranscribedThinking` to user text blocks, and sums the counts — it reads only `role` and `content`, the fields `MessageParam` already exists for.

### Debug logging

`removedThinkingSegments` joins the existing `before-provider-request` debug record, so `PI_ANTHROPIC_AUTH_DEBUG=all` shows whether the strip fired on a given request.

### Edge cases

1. No `<conversation>` envelope in the text → returned unchanged, `removedSegments: 0`.
2. Envelope present, no thinking marker → returned unchanged.
3. Thinking segment is the last segment before `</conversation>` → trailing separator cleaned so the envelope does not end with a blank run.
4. A thinking segment containing blank lines → removed whole.
5. `content` given as a bare string rather than blocks → handled, since `MessageParam.content` is `string | MessageBlock[]`.
6. Summarization anchor present but no user message → no-op.

## Module-Level Changes

### `src/constants.ts` (changed)

Add three upstream-derived constants with the same "copied verbatim from Pi" comment treatment the existing anchors carry:

- `PI_SUMMARIZATION_SYSTEM_PROMPT_ANCHOR`
- `PI_TRANSCRIPT_MARKERS`
- `PI_TRANSCRIPT_THINKING_MARKER`

### `src/summarization-shaping.ts` (new)

`isSummarizationSystemText`, `stripTranscribedThinking`, and the `StrippedTranscriptReport` type.

### `src/request-shaping.ts` (changed)

Add the private `stripThinkingFromUserMessages` walker; call it from `shapeAnthropicOAuthPayload` ahead of `prependBillingHeader`; add `removedThinkingSegments` to the debug record.

### `test/summarization-shaping.test.ts` (new)

Unit coverage for the string-level module.

### `test/request-shaping.test.ts` (changed)

Payload-level coverage: strip fires on a summarization payload, does not fire without the system anchor, and the `cch` hash reflects the stripped text.

### `test/upstream-prompt-drift.test.ts` (changed)

Two new drift tests importing `../node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/utils.js` for `SUMMARIZATION_SYSTEM_PROMPT` and `serializeConversation`.
The file's existing header comment already states the policy for this import class — a resolution failure reds the suite deliberately — so it needs no new rationale, only a mention of the second import.

### Documentation

Grepped for every mechanism name this change reworks, not only for removed symbols:

1. `README.md` — new Troubleshooting subsection after "### A new model is rejected as `claude_code_version_too_old`": what the ToS refusal on `/compact` is, that the extension now strips transcribed reasoning, and that summaries consequently omit it. README documents user-facing behavior, which a `src/`-symbol grep never reaches.
2. `docs/architecture.md` — the numbered "## What the wrapper does" list (currently three items at lines 90–95) gains a fourth. Grepped for "prepends", "normalizes assistant message ordering", and "sanitizes Pi's default preamble"; those three claims stay accurate and are not reworded.
3. `AGENTS.md` — "### Current Status" list (items 3–5 at lines 37–39) gains an item; "### Local Files" gains `src/summarization-shaping.ts`; "### Coverage areas" (lines 414–418) gains `test/summarization-shaping.test.ts` and extends the `test/upstream-prompt-drift.test.ts` entry.
4. `.pi/skills/anthropic/SKILL.md` — the "Shape in the `streamSimple` transport wrapper" bullet list (lines 99–104) gains a bullet; "Confirmed local fixes" gains a line. Grepped the whole `.pi/skills/` tree for "compaction" and "summariz" — no other skill names this mechanism.

No exported symbol is removed or renamed, so the removed-export grep sweep finds nothing to update.
No file listed here is also claimed as unchanged in Non-Goals.

## Test Impact Analysis

This is an addition, not an extraction, so the second and third questions have short answers.

1. **New tests the change enables.** `stripTranscribedThinking` is a pure string function, so the multi-paragraph-thinking, envelope-boundary, and no-envelope cases are all directly unit-testable — none of them could be reached before, because no code path parsed a transcript.
2. **Tests that become redundant.** None. Nothing in the current 64-test suite exercises summarization payloads.
3. **Tests that must stay as-is.** All of `test/request-shaping.test.ts`'s existing billing-header and ordering assertions — they pin behavior on non-summarization payloads, which is exactly the path the new gate must leave alone. A regression in the gate shows up there first.

## Invariants at Risk

This change touches `shapeAnthropicOAuthPayload`, which earlier work already constrained.

1. **API-key and non-Anthropic requests pass through untouched** (Issue [#1]). Pinned by `test/oauth-transport.test.ts`'s token-gating tests. Unaffected: the new logic runs strictly inside `shapeAnthropicOAuthPayload`, which the `sk-ant-oat` gate already fences.
2. **The billing block carries no `cache_control`** (an Anthropic block-limit rejection). Pinned in `test/request-shaping.test.ts`. Unaffected: `prependBillingHeader` is not edited.
3. **`cch` is the SHA-256 prefix of the first user message text.** Pinned in `test/request-shaping.test.ts`. This change deliberately alters the *input* to that hash on summarization payloads. Add an explicit test asserting the hash is computed post-strip, so the ordering is pinned rather than incidental.
4. **Extension-appended system content survives shaping** (Issue [#10], Issue [#47]). Pinned in `test/upstream-prompt-drift.test.ts`. Unaffected: `src/system-prompt-shaping.ts` is not edited, and summarization payloads carry no Pi preamble.

Quantitative baselines, measured at planning time:

- Test count before: **64 tests across 8 files** (one run; counts need one run). Expected after: 8–12 new tests across one new file and two changed files.
- Payload size effect: removing thinking segments strictly shrinks the summarization request. The ~30-segment spike transcript reported `cacheWrite: 5054` tokens with thinking and `cacheRead: 842` without — a measured reduction, and an incidental improvement on the overflow problem upstream noted in pi #9602.

## TDD Order

1. **`test:` add failing unit tests for the transcript stripper.**
   Surface: `test/summarization-shaping.test.ts`.
   Covers: envelope detection, thinking-segment removal, preservation of the other four markers, multi-paragraph thinking blocks, no-envelope passthrough, no-thinking passthrough, and the `removedSegments` count.
   Commit: `test: add failing coverage for transcript thinking stripper`

2. **`feat:` implement `src/summarization-shaping.ts` and the constants it needs.**
   Adds `PI_SUMMARIZATION_SYSTEM_PROMPT_ANCHOR`, `PI_TRANSCRIPT_MARKERS`, `PI_TRANSCRIPT_THINKING_MARKER` to `src/constants.ts` and the three exports to the new module.
   The constants ship in the same commit as their only consumer, since neither type-checks alone in a useful state.
   Commit: `feat: add Anthropic summarization transcript stripper`

3. **`test:` add failing payload-level tests for the gate and ordering.**
   Surface: `test/request-shaping.test.ts`.
   Covers: strip fires when the summarization system anchor is present; does not fire on an ordinary payload whose user message contains a `<conversation>` envelope; the billing-header `cch` is derived from the stripped text.
   Commit: `test: add failing coverage for summarization payload shaping`

4. **`fix:` wire the stripper into `shapeAnthropicOAuthPayload`.**
   Adds `stripThinkingFromUserMessages`, calls it ahead of `prependBillingHeader`, and extends the debug record with `removedThinkingSegments`.
   This is the commit that closes Issue [#65].
   Commit: `fix: strip transcribed reasoning from Anthropic OAuth summarization requests`

5. **`test:` pin the two new anchors against the installed Pi.**
   Surface: `test/upstream-prompt-drift.test.ts`.
   Covers: the installed Pi's `SUMMARIZATION_SYSTEM_PROMPT` still contains our anchor; the installed Pi's own `serializeConversation`, run over a fixture conversation containing a thinking block, still emits `PI_TRANSCRIPT_THINKING_MARKER`, and `stripTranscribedThinking` removes it from that real output.
   Commit: `test: pin summarization anchors against the installed pi`

6. **`docs:` update the four documentation surfaces.**
   `README.md` Troubleshooting subsection, `docs/architecture.md` wrapper list, `AGENTS.md` (Current Status, Local Files, Coverage areas), `.pi/skills/anthropic/SKILL.md` (shaping bullets, Confirmed local fixes).
   Commit: `docs: document transcribed-reasoning stripping for OAuth summarization`

A live `pi` repro is **not** a gate for this change: the refusal is volume-dependent and cannot be triggered reliably on demand.
Run the standard `pi -ne -e …` smoke repro from AGENTS.md to confirm the extension still loads and ordinary turns still work.

## Risks and Mitigations

1. **Summary fidelity drops.** Summaries lose the assistant's reasoning. Mitigated by the fact that `serializeConversation` already discards far more (tool results are truncated, tool arguments flattened), and that the alternative is a summarization request that fails outright. Documented in the README so it is not a surprise.
2. **Upstream marker drift.** If Pi reformats the `[Assistant thinking]:` marker or the summarization system prompt, the strip silently stops firing. Mitigated by Step 5's drift tests, which verify against Pi's own serializer output rather than a fixture — the strongest form of this check in the repo.
3. **Upstream path drift.** `dist/core/compaction/utils.js` may move between Pi releases; the drift test then fails to resolve. This is the documented, intended failure mode for that import class, and it fails loudly at `pnpm test` rather than at request time.
4. **False-positive rewriting of a user's own message.** Mitigated by the dual gate. A user message quoting a Pi transcript is only rewritten if the request also carries Pi's summarization system prompt, which Pi only synthesizes for summarization calls that contain no user-authored content.
5. **The mitigation outlives its need.** If Pi fixes `serializeConversation`, this code becomes dead weight rather than a hazard — the strip would find nothing to remove and the drift test would red, prompting removal. The upstream issue in the appendix is what starts that clock.
6. **Not a complete fix for the reporter.** If their compaction runs through a background agent, the wrapper is still bypassed (Issue [#46]). Worth stating when closing Issue [#65].

## Open Questions

1. **An opt-out environment variable** (`PI_ANTHROPIC_AUTH_KEEP_SUMMARIZATION_THINKING`) was considered and declined for now: it adds a second runtime knob for a fidelity preference nobody has asked for, and the failure it would re-enable is a hard request rejection. Revisit only if a user reports a summary quality regression traceable to the strip.
2. **Whether the strip should also cover `[Tool result]` volume.** Out of scope. Upstream already truncates tool results, and nothing in the measured evidence implicates them.
3. **Whether upstream accepts the report.** Pi auto-closes issues from new contributors, and has closed two adjacent reports (pi #7133 "Surface Anthropic refusals as a distinct signal", `no-action`; pi #8017 "Support Anthropic refusal server side fallback"). The appendix draft is written to survive that filter, but the stopgap here does not depend on it.

No follow-up issues are filed by this plan: every deferral above is either a revisit-on-evidence note or already tracked by Issue [#46].

## Appendix: drafted upstream bug report

For submission by the operator at <https://github.com/earendil-works/pi/issues/new?template=bug.yml>, in their own voice and by hand.
Pi's `CONTRIBUTING.md` asks for one screen, the operator's own words, and prior validation with `pi -ne` that the bug is not extension-caused — which the unshaped control row above supplies.

### What happened?

Compaction fails on `claude-fable-5` because `serializeConversation` transcribes thinking blocks into the summarization prompt, which Anthropic's `reasoning_extraction` classifier refuses:

```text
Compaction failed: Turn prefix summarization failed: This request was blocked as it seems to
violate Anthropic's Terms of Service restrictions on reverse engineering or duplicating model
outputs.
```

`serializeConversation` emits `[Assistant thinking]: <reasoning text>` for every assistant turn with thinking, and compaction sends that transcript as a user message.
Anthropic's Fable 5 guidance says not to do this:

> Prompts, skills, or harness instructions that tell the model to echo, transcribe, or explain its internal reasoning as response text can trigger the `reasoning_extraction` refusal category on Claude Fable 5.

(<https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5>, "Recommended scaffolding changes")

I confirmed this is core, not an extension: sending the same payload through pi-ai's built-in Anthropic transport with no extension loaded gets the identical refusal.
Sending it with the `[Assistant thinking]` paragraphs removed and nothing else changed succeeds and returns a normal summary.

### Steps to reproduce

1. Use `claude-fable-5` with thinking enabled.
2. Run a session long enough to accumulate several large thinking turns.
3. Run `/compact`.

It is volume-dependent — a handful of thinking paragraphs passes, a few dozen does not.

### Expected behavior

Compaction succeeds. `serializeConversation` omits thinking blocks, or replaces them with a content-free marker.
Thinking text is the lowest-value part of a summarization input, and dropping it also shrinks the request, which would help pi #9602.

### Version

0.84.0 (also present on `main`; `packages/agent/src/harness/compaction/utils.ts`)

[#1]: https://github.com/gotgenes/pi-anthropic-auth/issues/1
[#10]: https://github.com/gotgenes/pi-anthropic-auth/issues/10
[#46]: https://github.com/gotgenes/pi-anthropic-auth/issues/46
[#47]: https://github.com/gotgenes/pi-anthropic-auth/issues/47
[#52]: https://github.com/gotgenes/pi-anthropic-auth/issues/52
[#60]: https://github.com/gotgenes/pi-anthropic-auth/issues/60
[#65]: https://github.com/gotgenes/pi-anthropic-auth/issues/65
