---
issue: 67
issue_title: "Pi 0.86.0 XML-sectioned system prompt breaks the sanitizer: unclosed <tools>, orphaned </docs>"
---

# Section-aware system prompt sanitizer for Pi 0.86.0

## Release Recommendation

**Release:** ship independently

`docs/architecture.md` carries no numbered roadmap and no `Release:` annotations, so this issue is not a batch member.
It is a breaking change (peer floor raised to `>=0.86.0`) and ships as `3.0.0`.
The release closes three issues at once — #67, #68, and #69 — because all three are consequences of the same upstream 0.86.0 restructure and cannot be landed independently (see Design Overview, "Why the three issues land together").

## Problem Statement

Pi 0.86.0 restructured its default system prompt into XML-tagged sections.
Our paragraph-based sanitizer cuts across those tag boundaries, so every shaped OAuth request now carries an unclosed `<tools>` and an orphaned `</docs>`.

Reproduced through the real upstream builder, not a fixture: a prompt built by the globally installed pi 0.86.0's own `buildSystemPrompt` (`/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js`), piped through `shapeAnthropicOAuthSystemPrompt`, produces exactly the damage the issue reports.

Requests still succeed.
This is a prompt-quality and fingerprinting regression, which is why it needs a test to hold it rather than a user-visible symptom to chase.

## Goals

- Shaped OAuth system prompts are tag-balanced: no unclosed or orphaned section tags reach Anthropic.
- Shaping is driven by the prompt's explicit section structure rather than by paragraph anchors and a terminator constant.
- **Breaking:** the peer floor rises from `>=0.80.8` to `>=0.86.0`, and the pre-0.86 flat-prompt path is removed.
- Pi-identifying content is stripped wherever it appears in an OAuth request, including the mid-conversation system messages introduced in 0.86.0 (Issue #69).
- `pnpm run check` passes against pi 0.86.0's branded `TranscriptContext` (Issue #68).
- Everything Pi appends — `addendum`, `project_context`, `skills`, `cwd`, and extension-registered custom sections — survives byte-identically.

## Non-Goals

- Issue #66 (`splitAssistantToolUseTrailingContent` breaking interleaved thinking) is untouched; it lives in `src/request-shaping.ts` but in a different function than the one this plan edits.
- Issue #56 (CI never exercises the peer floor) is not fixed here.
  The floor raise narrows it — the floor becomes the current release rather than a version six releases back — but no CI matrix job is added.
- Issue #53 (compat-dispatch re-examination) and Issue #46 (background-agent coverage gap) are unchanged.
  Mid-conversation shaping added for #69 runs inside `shapeAnthropicOAuthPayload`, so it inherits exactly the same call-path coverage as today's `system[]` shaping — no new seam.
- No change to billing-header generation, `cache_control` handling, or assistant-message ordering.
- No live probe of whether Anthropic's classifiers care about tag balance; see Open Questions.

## Background

### What upstream changed

`buildSystemPromptSections` (`packages/coding-agent/src/core/system-prompt.ts`) now returns an ordered record: `preamble` as untagged text, then `tools`, `rules`, `docs`, `addendum`, `project_context`, `skills`, `cwd`, each wrapped as `<name>\n${content}\n</name>`.
`getSystemMessageText` (`packages/ai/src/utils/text.ts`) joins the non-empty parts with `\n\n`, and that flattened string is what lands in `params.system[1]` — the block our shaping sees.

The restructure arrived in commit `9e05370b2` ("Mid conversation system messages"), first tagged in **v0.86.0**.
Verified: a prompt built with the locally installed 0.84.0 is still the flat `Available tools:` / `Guidelines:` / `Current working directory:` shape.
Both shapes therefore sit inside the current `>=0.80.8` declared floor, which is why the floor has to move for the flat path to be removable.

### Why the current sanitizer breaks

`sanitizeSystemTextWithReport` splits on blank lines and drops whole paragraphs containing a `PARAGRAPH_REMOVAL_ANCHORS` entry.
Under the new shape those paragraphs straddle tag boundaries:

- the `"In addition to the tools above"` paragraph's last line is `</tools>`, so the close tag is removed with it;
- the `docs` paragraph carries the `<docs>` open tag, while `PI_DEFAULT_PROMPT_TERMINATOR` ends the shaped span one line short of `</docs>`, so the close tag survives with nothing to close.

Measured defect count on the 0.86.0 output: **2** (one unclosed `<tools>`, one orphaned `</docs>`).

### Constraints from AGENTS.md

- Keep the override thin; prefer request shaping over broader prompt rewriting.
- Isolate compatibility logic in small, purpose-specific helpers.
- Tests build payload fixtures inline; `test/upstream-prompt-drift.test.ts` is the one sanctioned exception that imports Pi's own `buildSystemPrompt`, because depending on the internal *is* the verification.
- Assert on shaped prompts with regexes pinning specific markers, not deep-equal on whole strings.
- Pin markers Pi actually emits — the `<cwd>` section replaces the old `Current working directory:` bare line.

## Design Overview

### Decisions taken

Four decisions were settled with the operator before writing this plan:

1. **Raise the peer floor to `>=0.86.0`** and ship a section-only sanitizer, rather than carrying a dual-shape path for pi 0.80.8–0.85.1.
   Issue #56 already records that the floor is never exercised in CI, so a retained legacy path would be untested code claiming support we do not verify.
2. **Fold Issue #69 in.** Once shaping is section-aware, a mid-conversation `Updated system prompt section "docs"` update is dropped by the same rule table instead of a second, anchor-based code path.
3. **Import `TranscriptContext` explicitly** in `src/oauth-transport.ts` rather than deriving it via `Parameters<AnthropicStreamSimpleDelegate>[1]`.
   Verified: `StreamFunction` at `packages/ai/src/types.ts:345` already declares `context: TranscriptContext`, so both spellings resolve to the identical type; the explicit import names it in source and fails `pnpm run check` loudly on a future upstream rename, which is the signal `.pi/skills/upstream-watch` is built around.
   `TranscriptContext` is public (`packages/ai/src/index.ts:38` re-exports `./types.ts`), as is `normalizeContext` (`index.ts:46` re-exports `./utils/transcript.ts`).
4. **Drop `<docs>` anchored, not by name.** Upstream lets extensions register custom sections by name and applies them *after* the built-ins, so an extension may legally overwrite `docs`.
   Dropping only when the body carries the Pi documentation anchor preserves that content and keeps a drift signal.

### Why the three issues land together

The drift canary imports the *installed* pi, so it only exercises the section path once devDeps move to 0.86.0 — and that bump makes `pnpm run check` red without #68's type fix.
Conversely, the canary cannot be green on both sides of the shape boundary: on 0.84.0 devDeps it verifies the flat prompt, on 0.86.0 the sectioned one.
There is therefore no commit ordering in which the devDep bump, the type fix, and the sanitizer cutover are each independently green.
The TDD order below front-loads the new machinery as unconsumed additions so the unavoidable cutover commit is mostly deletion and wiring.

### New module: chunk parser

`src/system-prompt-sections.ts` parses the flattened prompt into ordered top-level chunks and renders them back.

```typescript
/** One top-level chunk of pi's structured system prompt. */
export type PromptChunk = {
  /** Tag name, or null for untagged text (the preamble, or an unparsed remainder). */
  name: string | null;
  /** Exact source text of the chunk, tags included. */
  raw: string;
  /** Text between the tags; equals `raw` when untagged. */
  body: string;
};

export function parseSystemPromptChunks(text: string): PromptChunk[];
export function renderSystemPromptChunks(chunks: readonly PromptChunk[]): string;
export function namedSection(name: string, body: string): PromptChunk;
```

Parsing rules, mirroring what upstream emits:

- A section starts at `\n\n<name>\n` (or `<name>\n` at offset 0), where `name` matches upstream's own `/^[a-z][a-z0-9_-]*$/`.
- It ends at the first `\n</name>` with the *matching* name that is followed by `\n\n` or end of text.
- Each boundary consumes exactly two newlines, so any additional blank lines stay inside the adjacent chunk.
- Text before the first section, between sections, or after an unmatched open tag is emitted as a `name: null` chunk, byte-exact.

Round-trip invariant, pinned by test: `renderSystemPromptChunks(parseSystemPromptChunks(t)) === t` for every fixture.
This is what makes passthrough safe — an unrecognized or extension-registered section is never re-serialized, only copied.

Attribute-bearing tags do not match the open-tag pattern, so `<project_instructions path="…">` inside a `project_context` body cannot be mistaken for a section start.
Matching the close tag by name means a nested `<tools>` block inside someone's `AGENTS.md` cannot terminate the enclosing section early.

### Shared rule table

Both the leading prompt and mid-conversation updates run the same per-section decision:

```typescript
type SectionDecision =
  | { kind: "keep" }
  | { kind: "drop" }
  | { kind: "replace"; body: string };

function decideSection(name: string, body: string): SectionDecision;
```

| Section | Condition | Decision |
| --- | --- | --- |
| `preamble` | body starts with `PI_DEFAULT_PROMPT_PREFIX` | replace with `MINIMAL_ANTHROPIC_OAUTH_PROMPT` |
| `docs` | body contains `PI_DOCS_SECTION_ANCHOR` | drop |
| `tools` | body contains `PI_TOOLS_FILLER_ANCHOR` | replace with the body minus that paragraph |
| anything else | — | keep |

`TEXT_REPLACEMENTS` is applied to the surviving bodies of the Pi-owned sections only (`preamble`, `tools`, `rules`).
That is exactly the region the retired preamble span covered, so the rule's blast radius is unchanged and a user's `project_context` is never rewritten.

Two adapters feed the table, which is the point of separating it: the leading-prompt path maps chunks, the update path maps framed parts.
Neither adapter knows the other's format.

### Leading-prompt path

```typescript
const chunks = parseSystemPromptChunks(prompt);
if (!chunks.some((chunk) => chunk.name !== null && PI_OWNED_SECTIONS.has(chunk.name))) {
  warnUnstructuredPromptOnce();
  return prompt;
}
return renderSystemPromptChunks(chunks.flatMap(shapeChunk));
```

`shapeChunk` returns `[]` to drop, `[chunk]` to keep, or `[namedSection(name, body)]` to replace.
The first untagged chunk is offered to the table as `preamble`; later untagged chunks are kept verbatim.

The structure guard matters: on a prompt with no Pi-owned sections the whole text is a single untagged chunk, and replacing it wholesale would delete `project_context`, `skills`, and `cwd`.
So the degraded path warns once and passes through untouched.
This replaces today's `sanitize-fallback` mode, and it is a deliberate semantic change: with the floor at `>=0.86.0`, "no sections found" means upstream restructured again, in which case our anchors are no more trustworthy than our section names.
Passing Pi's own prompt through is safe — the request still succeeds, merely un-de-fingerprinted — and the warning is the signal to re-verify.

### Mid-conversation updates (Issue #69)

`renderSystemMessageUpdate` (`packages/ai/src/utils/text.ts`) frames each changed section, joining parts with `\n\n`:

- `Removed system prompt section "<name>".`
- `Updated system prompt section "<name>":\n\n<name>\n…\n</name>`

Note that `diffSystemPromptSections` iterates *all* current sections including `preamble`, so an `Updated system prompt section "preamble":` part can carry the Pi identity as untagged text.
The rule table already handles that key, which is why the table is keyed by section name rather than by tag presence.

```typescript
export function shapeSystemUpdateText(text: string): string | undefined;
```

It splits the text into framed parts, applies `decideSection` to each, drops the framing line along with a dropped part, and returns `undefined` when nothing survives.

In `src/request-shaping.ts`:

```typescript
function shapeSystemRoleMessages(messages: MessageParam[]): MessageParam[];
```

For each `role: "system"` message it rewrites text blocks through `shapeSystemUpdateText`, drops blocks that shape to nothing, and drops the message only when its `content` array ends up empty.
`tool_addition` / `tool_removal` blocks are non-text and pass through, so a message that carried both a dropped `docs` update and a tool change keeps the tool change.

Blast radius verified live against the installed 0.86.0 catalog — exactly four models set `supportsMidConvoSystemMessages`: `claude-fable-5`, `claude-fable-5-1`, `claude-opus-4-8`, `claude-opus-5`.
Every other Anthropic model takes `collapseSystemMessages()` and is already fully covered by the `system[]` path.

### Expected shaped output

Against the 0.86.0 fixture, after the change:

```text
You are an expert coding assistant.
Be concise and helpful.
Use the available tools to answer the user's request.
Show file paths clearly when working with files.

<tools>
- read: Read file contents
- bash: Execute shell commands
</tools>

<rules>
- Use bash for file operations like ls, rg, find
- Always check the frobnicator before deploying
- Be concise in your responses
- Show file paths clearly when working with files
</rules>

<addendum>
## Custom Note (from another extension)
- Some critical project instruction.
</addendum>

<project_context>
Project-specific instructions and guidelines:

<project_instructions path="/tmp/project/AGENTS.md">
Preserve built-in Anthropic behavior by default.
</project_instructions>
</project_context>

<cwd>
/tmp/project
</cwd>
```

## Module-Level Changes

### Source

1. `src/system-prompt-sections.ts` — **new**.
   `PromptChunk`, `parseSystemPromptChunks`, `renderSystemPromptChunks`, `namedSection`.
2. `src/constants.ts` — **remove** `PI_DEFAULT_PROMPT_TERMINATOR` and `PARAGRAPH_REMOVAL_ANCHORS`; **add** `PI_TOOLS_FILLER_ANCHOR` (`"In addition to the tools above"`), `PI_DOCS_SECTION_ANCHOR` (`"Pi documentation (read only when the user asks about pi itself"`), and `PI_OWNED_SECTIONS`.
   `PI_DEFAULT_PROMPT_PREFIX`, `MINIMAL_ANTHROPIC_OAUTH_PROMPT*`, and `TEXT_REPLACEMENTS` are unchanged.
   The former Pi-identity anchor is dropped as redundant: `PI_DEFAULT_PROMPT_PREFIX` already detects the preamble, and the preamble is now replaced wholesale.
3. `src/system-prompt-shaping.ts` — **rewrite**.
   Remove `sanitizeSystemTextWithReport`, `sanitizeSystemText`, `SanitizedSystemTextReport`, `shapePreambleSpan`, `previewParagraph`, and `warnTerminatorMissingOnce`.
   Add `decideSection`, the chunk adapter behind `shapeAnthropicOAuthSystemPrompt`, `shapeSystemUpdateText`, and `warnUnstructuredPromptOnce`.
   `shapeSystemBlocks` and `_resetShapingWarnings` keep their names and exported signatures; `_resetShapingWarnings` now resets the unstructured-prompt latch.
   `shouldLogPromptDebug` is retained but re-expressed over the new report shape.
4. `src/request-shaping.ts` — add `shapeSystemRoleMessages` and call it from `shapeAnthropicOAuthPayload`.
   Extend the `debugLog("before-provider-request", …)` payload with the count of shaped system-role messages.
   `splitAssistantToolUseTrailingContent` is untouched.
5. `src/oauth-transport.ts` — import `TranscriptContext` from `@earendil-works/pi-ai`; use it in `AnthropicStreamSimple`'s `context` parameter and drop the now-unused `Context` import.
6. `package.json` — `peerDependencies` for both packages to `>=0.86.0`; `devDependencies` for both to `0.86.0`.
   Install with `pnpm clean --lockfile && pnpm install` if the lockfile age gate trips.

### Tests

1. `test/system-prompt-sections.test.ts` — **new**.
   Parse/render round-trip, attribute-tag immunity, nested same-name safety, unmatched open tag, extra blank lines, extension-registered custom sections.
2. `test/system-prompt-shaping.test.ts` — **rewrite**.
   The fixtures `PI_PREAMBLE`, `PI_UPSTREAM_SYSTEM_PROMPT`, and the drifted-terminator fixture are replaced with 0.86.0-shaped equivalents.
   All five `sanitizeSystemText` tests are removed with the export.
   The terminator-drift and fallback-mode tests (`preserves everything pi appended when the terminator drifts`, `sanitizes beyond the preamble span in fallback mode`, `warns once when the preamble terminator is missing`, `preserves anchorless trailing content when the terminator is missing`) are replaced by unstructured-prompt degraded-mode tests.
3. `test/upstream-prompt-drift.test.ts` — **rewrite**.
   The `PI_DEFAULT_PROMPT_TERMINATOR` and `PARAGRAPH_REMOVAL_ANCHORS` canaries are replaced with section-level canaries: the installed pi still emits `tools`/`rules`/`docs` sections, the docs body still carries `PI_DOCS_SECTION_ANCHOR`, the tools body still carries `PI_TOOLS_FILLER_ANCHOR`, and shaping does not warn.
   Its `/\nCurrent working directory: \/tmp\/project$/` assertion becomes a `<cwd>` section assertion.
   The `<project_context>` assertion stays as-is.
4. `test/request-shaping.test.ts` — add mid-conversation system-message cases: a dropped `docs` update, a cleaned `tools` update, a `preamble` update carrying the Pi identity, a message whose only text block is dropped, and a message retaining non-text blocks.
5. `test/index-registration.test.ts` and `test/oauth-transport.test.ts` — replace the `as unknown as Context` fakes with `normalizeContext({ messages: [] })`, and update the local `dispatch`/delegate signatures to `TranscriptContext`.

### Docs

Prose updates, each grepped by its own vocabulary:

1. `AGENTS.md` — line 38 ("Sanitizes Pi's default preamble by anchor"), line 99 (`src/system-prompt-shaping.ts` description), line 416 (`test/system-prompt-shaping.test.ts` coverage), line 418 (`test/upstream-prompt-drift.test.ts`, which names the terminator), line 424 ("preamble anchors … fallback paths").
   Add `src/system-prompt-sections.ts` to the Local Files list and `test/system-prompt-sections.test.ts` to the coverage list.
2. `docs/architecture.md` — line 93 ("sanitizes Pi's default preamble by anchor"), line 188 ("anchor-driven preamble sanitizer") in Related files.
3. `.pi/skills/anthropic/SKILL.md` — line 126 ("anchor-based removal of the Pi identity, custom-tool filler, and Pi documentation paragraphs"), line 95 (unchanged in substance, verify), and the Useful References list gains the new module.
4. `.pi/skills/upstream-watch/SKILL.md` — the watchlist row "Pi's default preamble matches our prefix/terminator anchors" becomes a section-structure row.
5. `README.md` — the Development → Requirements list gains an explicit `pi >= 0.86.0`.
   Line 22's "known exception on Pi 0.80.8 and later" is a historical statement about when the background-agent gap opened and stays as-is.
6. Peer-floor prose: `rg -n '0\.80\.8' AGENTS.md docs/architecture.md .pi/skills/` and update only the sentences asserting the *current* floor (`AGENTS.md` lines 80, 486, 518; `docs/architecture.md` lines 72, 74, 123).
   Sentences describing what 0.80.8 historically changed stay.

`docs/plans/` and `docs/retro/` are historical records and are not edited.

## Test Impact Analysis

**New tests the change enables.**
The chunk parser is a pure function over strings, so `test/system-prompt-sections.test.ts` can pin parsing edge cases — attribute tags, nested same-name tags, unmatched open tags, extension-registered sections — that were previously unreachable because paragraph splitting had no notion of structure.
The round-trip identity (`render(parse(t)) === t`) is a single assertion that subsumes a family of "did shaping mangle the tail?" tests written today as per-fixture footer checks.

**Tests that become redundant.**
The five `sanitizeSystemText` tests disappear with the export; their intent (identity removal, filler removal, docs removal, text replacement, anchorless preservation) is re-covered at the `decideSection` and whole-prompt levels.
The four terminator-drift and fallback-mode tests lose their subject entirely — there is no terminator and no span.
Two of them (`preserves everything pi appended when the terminator drifts`, `preserves anchorless trailing content when the terminator is missing`) are really testing tail preservation, which the round-trip invariant now covers structurally; they are replaced by one degraded-mode passthrough test rather than reproduced.

**Tests that must stay.**
`preserves content appended between preamble and Project Context (issue #9)`, `preserves trailing footer when there is no Project Context section`, `preserves content appended at the very end of the system prompt`, and `does not sanitize extension content outside the Pi preamble span` all pin Issue #10's preservation contract at the layer being reworked — they are re-expressed against the sectioned fixture, not deleted.
`shapeSystemBlocks passes through non-text blocks and blocks without the prefix` is unaffected.
`test/pi-anthropic-ordering-experiment.test.ts` is untouched.

## Invariants at Risk

1. **Issue #10 — extension-contributed tool snippets and guidelines survive shaping.**
   Pinned by `preserves content appended between preamble and Project Context` and the drift canary's `- read: Read file contents` / `- ${EXTRA_GUIDELINE}` assertions.
   Re-expressed against the sectioned fixture; both must still assert.
2. **Issue #47 — everything Pi appends after the preamble survives.**
   Today pinned by terminator-drift tests that this plan deletes.
   Replacement pin: the round-trip identity plus explicit `addendum` / `project_context` / `skills` / `cwd` assertions in both the unit fixture and the drift canary.
   This invariant must not be left resting on the deleted tests.
3. **Issue #52 — the drift canary catches upstream prompt drift at build time rather than as a mid-session `console.warn`.**
   The canary is rewritten, not weakened: it keeps a "shaping did not warn" assertion, now watching the unstructured-prompt latch.
4. **Quantitative: tag balance.**
   Measured baseline on the 0.86.0 fixture: 2 defects (one unclosed `<tools>`, one orphaned `</docs>`).
   Predicted after: 0.
   Pinned by an explicit test that counts open and close tags in the shaped output and asserts they match — not by an assertion on adjacent content.
5. **Quantitative: test count.**
   Measured baseline: 64 tests across 8 files, all green; `pnpm run check` green on devDeps 0.84.0.
   Predicted after: ~72–78 across 9 files (estimated — 9 removed, roughly 17–23 added).
   The exact number is not a gate; the gate is that no removed test's *invariant* is unpinned, per the table above.
6. **Issue #46 — call-path coverage is unchanged.**
   The #69 work adds no seam; it extends `shapeAnthropicOAuthPayload`, which runs wherever it runs today.
   `test/index-registration.test.ts`'s pin that registration leaves the built-in `anthropic-messages` api-registry entry untouched must stay green.

## TDD Order

1. **`refactor: add system prompt section parser`**
   New `src/system-prompt-sections.ts` and `test/system-prompt-sections.test.ts`.
   Red: round-trip and parsing-edge-case tests against the not-yet-written module.
   Green: implement the parser.
   No consumers yet, so the suite stays green on devDeps 0.84.0 — and `refactor:` keeps `cliff.toml` from emitting a second changelog entry for one change.

2. **`refactor: add section-aware shaping rules alongside the anchor path`**
   Add `PI_TOOLS_FILLER_ANCHOR`, `PI_DOCS_SECTION_ANCHOR`, `PI_OWNED_SECTIONS` to `src/constants.ts`; add `decideSection` and the chunk adapter to `src/system-prompt-shaping.ts` under a new exported name, leaving `shapeAnthropicOAuthSystemPrompt` still on the anchor path.
   Red: new tests in `test/system-prompt-shaping.test.ts` against 0.86.0-shaped inline fixtures, including the tag-balance assertion.
   Green: implement.
   Still green on 0.84.0 because nothing is rewired and nothing is removed.

3. **`feat!: require pi >=0.86.0 and shape the XML-sectioned system prompt`**
   The coordinated cutover, necessarily one commit (see "Why the three issues land together"):
   - `package.json` peer floor `>=0.86.0`, devDeps `0.86.0`, reinstall;
   - `src/oauth-transport.ts` imports `TranscriptContext`; `test/index-registration.test.ts` and `test/oauth-transport.test.ts` switch to `normalizeContext` (closes #68);
   - `shapeAnthropicOAuthSystemPrompt` points at the section path; `warnUnstructuredPromptOnce` replaces the terminator warning;
   - remove `PI_DEFAULT_PROMPT_TERMINATOR`, `PARAGRAPH_REMOVAL_ANCHORS`, `sanitizeSystemText`, `sanitizeSystemTextWithReport`, `SanitizedSystemTextReport`, `shapePreambleSpan`, `previewParagraph`, and their tests;
   - rewrite `test/upstream-prompt-drift.test.ts` against the sectioned prompt.

   Every removal in this step breaks its importers at the type level in the same commit, so the extraction, the consumers, and the consumer tests cannot be split further.
   Footer: `BREAKING CHANGE: requires pi and pi-ai >= 0.86.0; hosts below that version are no longer supported and the pre-0.86 flat-prompt sanitizer path is removed.`

4. **`fix: shape mid-conversation system prompt updates`**
   Red: `test/request-shaping.test.ts` cases for a dropped `docs` update, a cleaned `tools` update, a `preamble` update carrying the Pi identity, an emptied message, and a message retaining non-text blocks.
   Green: `shapeSystemUpdateText` in `src/system-prompt-shaping.ts` and `shapeSystemRoleMessages` in `src/request-shaping.ts`.
   Closes #69.

5. **`docs: describe the section-aware sanitizer and the 0.86.0 floor`**
   The doc sweep listed under Module-Level Changes → Docs.
   Run `pnpm exec rumdl check` on every edited markdown file.

Before treating step 3 or 4 as done, run the live CLI repro with `-ne` per AGENTS.md — the section parser is new string-handling code reached on every OAuth request, and green `check`/`lint`/`test` under vitest does not prove behavior under pi's `jiti` loader.

## Risks and Mitigations

1. **The cutover commit is large.**
   Steps 1 and 2 front-load the parser and the rule table as unconsumed, fully tested additions, so step 3 is predominantly deletion and one rewiring line plus the canary rewrite.
   Mitigation is structural, not procedural.
2. **Breaking the peer floor strands users on pi <0.86.0.**
   They keep the working `2.x` line; the caret pin means `pi update` will not pull them across the major, matching the Issue #43 precedent.
   The `BREAKING CHANGE:` footer and the README requirement line are the notice.
3. **Bumping devDeps may surface 0.86.0 breakages beyond #67 and #68.**
   The issue reports 62/64 tests passing and exactly two `tsc` errors at 0.86.0, which is the operator's own measurement on a clean worktree.
   If step 3 turns up more, they are in scope for that step — the floor raise is the commitment, not the error count.
4. **The parser mis-slices an exotic prompt.**
   The round-trip identity assertion is the guard: any chunk the parser does not confidently recognize is emitted untagged and byte-exact, so a mis-parse degrades to passthrough rather than corruption.
   Name-matched close tags and attribute-tag immunity are each pinned by a test.
5. **Degraded mode is now passthrough, not anchor sanitization.**
   On a future upstream restructure, un-de-fingerprinted prompts would reach Anthropic instead of partially-sanitized ones.
   The one-time `console.warn` plus the rewritten drift canary make this loud at build time, which is where Issue #52 wanted it.
6. **Dropping a mid-conversation `docs` update desynchronizes the model's view of its sections.**
   It does not: we never sent the original `docs` section, so dropping its update keeps the model's view consistent with what it actually received.

## Open Questions

1. Does Anthropic care about tag balance at all, or only the model's comprehension?
   The issue raises this and it is worth a live probe during implementation, but the answer does not change the plan — the current output is malformed either way.
   Not filed as an issue: it is a question about the fix's motivation, not deferred work.
2. Should `PI_OWNED_SECTIONS` include `rules`?
   It is listed for `TEXT_REPLACEMENTS` scoping only; no rule drops or rewrites it.
   Resolve during step 2 if the scoping turns out to be simpler without it.
