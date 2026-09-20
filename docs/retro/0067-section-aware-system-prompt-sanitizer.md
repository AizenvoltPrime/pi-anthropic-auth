---
issue: 67
issue_title: "Pi 0.86.0 XML-sectioned system prompt breaks the sanitizer: unclosed <tools>, orphaned </docs>"
---

# Retro: #67 — Pi 0.86.0 XML-sectioned system prompt breaks the sanitizer: unclosed `<tools>`, orphaned `</docs>`

## Stage: Planning (2026-09-20T15:37:22Z)

### Session summary

Reproduced the reported damage through the real upstream builder — the globally installed pi 0.86.0's own `buildSystemPrompt` piped through `shapeAnthropicOAuthSystemPrompt` — rather than a hand-built fixture, and confirmed the 0.84.0 prompt is still the flat shape, so both shapes sit inside the declared `>=0.80.8` floor.
Settled four design decisions with the operator via `ask_user` and wrote `docs/plans/0067-section-aware-system-prompt-sanitizer.md`: a chunk parser in a new `src/system-prompt-sections.ts`, a shared `decideSection` rule table feeding two format adapters, a peer-floor raise to `>=0.86.0`, and a five-step TDD order.
The plan closes #67, #68, and #69 in one breaking `3.0.0` release.

### Observations

- **Sectioning landed in v0.86.0**, commit `9e05370b2` ("Mid conversation system messages").
  Verified by `git tag --contains`, not inferred from the changelog.
- **The three 0.86.0 issues cannot be landed independently.**
  `test/upstream-prompt-drift.test.ts` imports the *installed* pi, so it only exercises the section path once devDeps move to 0.86.0 — and that bump reds `pnpm run check` without #68's type fix.
  The canary also cannot be green on both sides of the shape boundary.
  There is no commit ordering where the bump, the type fix, and the cutover are each independently green, so the plan front-loads the parser and rule table as unconsumed additions (steps 1–2) to shrink the unavoidable cutover commit (step 3) to mostly deletion.
- **Rejected: dual-shape support.**
  Keeping the pre-0.86 anchor path would have preserved the `>=0.80.8` floor non-breakingly, but Issue #56 already records that the floor is never exercised in CI — the legacy path would be untested code claiming unverified support.
  Estimated ~330 lines vs ~200 for section-only.
- **Rejected: `Parameters<AnthropicStreamSimpleDelegate>[1]` for the context type** (#68's own suggestion).
  Verified that `StreamFunction` at `packages/ai/src/types.ts:345` already declares `context: TranscriptContext`, so both spellings resolve identically; the derivation's only real advantage — spanning the old and new floors — evaporates with the floor raise, and it converts a future compile-time break into silence, which is the opposite of what `.pi/skills/upstream-watch` wants.
  Also found `normalizeContext` is public, so tests can mint a real branded context instead of casting.
- **Anchored `docs` drop, not by-name.**
  Upstream applies extension-registered `sections` *after* the built-ins, so an extension can legally overwrite `docs`; dropping by name alone would silently eat it.
- **Verified #69's blast radius independently** against the installed 0.86.0 catalog: exactly four models set `supportsMidConvoSystemMessages` (`claude-fable-5`, `claude-fable-5-1`, `claude-opus-4-8`, `claude-opus-5`).
  Also noticed something #69 does not mention — `diffSystemPromptSections` iterates *all* sections including `preamble`, so an `Updated system prompt section "preamble":` part can carry the Pi identity as untagged text.
  That is why the rule table is keyed by section name rather than by tag presence.
- **Deliberate semantic change flagged as a risk:** degraded mode becomes warn-plus-passthrough instead of anchor sanitization.
  The old fallback cannot be kept, because with a single untagged chunk the preamble replacement would delete `project_context`, `skills`, and `cwd`.
- **Measured baselines recorded in the plan:** 64 tests across 8 files green, `pnpm run check` green on 0.84.0, and 2 tag-balance defects in the 0.86.0 shaped output.
  The post-change test count is labelled an estimate; the tag-balance target (0) is the gate.
- No follow-up issues filed — nothing the plan names is deferred work rather than an open question about the fix's motivation.

## Stage: Implementation — TDD (2026-09-20T16:08:00Z)

### Session summary

Landed the section-aware sanitizer across five TDD cycles plus one Tidy-First preparatory commit, closing #67, #68, and #69 in one breaking change (peer floor `>=0.86.0`).
Tests went from 64 across 8 files to 88 across 10; nine anchor-path tests were deleted and every invariant they pinned was re-expressed against the sectioned shape.
All deterministic gates pass, and both code-touching steps were verified live against pi 0.86.0 through the real `jiti` loader.

### Observations

- **The Tidy-First assessor earned its keep.**
  It found that `test/system-prompt-shaping.test.ts` and `test/upstream-prompt-drift.test.ts` were already keeping three literals in sync by copy-paste discipline, and that the rewrite would tighten that coupling further.
  `test/system-prompt-fixture-parts.ts` (literals only — `buildSystemPrompt` stays imported solely by the drift test, preserving the AGENTS.md "one sanctioned exception" boundary) landed first and both rewrites built on it.
- **The tag-balance pin was proven by mutation, not assumed.**
  Running the *old* anchor path over the 0.86.0 fixture through the same `unbalancedTags` helper yields exactly `["<tools>", "</docs>"]` — reproducing the issue's reported defect count of 2 — where the new path yields `[]`.
  A `"the fixture is well-formed before shaping"` test guards the assertion from false-greening on an already-unbalanced fixture.
  The helper itself had a real bug on first write (its open-tag regex rejected attribute-bearing tags while the close regex accepted them, so `</project_instructions>` counted as an orphan); the failing run caught it.
- **The plan's "three issues cannot land independently" analysis held exactly.**
  Bumping devDeps produced precisely the two `tsc` errors #68 predicted, and the drift canary could not be green on both sides of the shape boundary.
  Front-loading the parser and rule table as unconsumed additions (steps 1–2) did shrink the cutover to mostly deletion: `c68eb2e` is 1325 insertions / 1815 deletions, net negative.
- **`pnpm clean --lockfile` side effects were larger than the AGENTS.md note suggests.**
  Beyond clearing the age gate it moved biome 2.5.7 → 2.5.14 (schema migration required) *and* vite 8.2 → 8.3, which promoted `esbuild` from an unsatisfied optional peer to a real dependency needing an `allowBuilds` entry.
  Worth adding the esbuild case to the gotcha if it recurs.
- **Deviation: one public entry point, not two.**
  The plan had step 2 export `shapeStructuredSystemPrompt` alongside the old `shapeAnthropicOAuthSystemPrompt`; step 3 renamed rather than kept both, so the module still exposes a single shaping function.
- **Open Question 2 resolved as yes:** `PI_OWNED_SECTIONS` includes `rules`, because the same set serves the structure guard and the `TEXT_REPLACEMENTS` scope.
- **Found during implementation, not planning:** `decideSection` needed a `withBody` helper because replacing the *untagged* preamble must not wrap it in `<preamble>` tags — `namedSection` is right for every other section and wrong for that one.
- **Unplanned cascade, folded into the cutover commit:** two `test/request-shaping.test.ts` cases used pre-0.86 flat fixtures and began passing through untouched (correctly) once the degraded path landed; both were reshaped to the sectioned form.
- **Pre-completion reviewer: WARN** — one finding, an orphaned docblock in `src/constants.ts` left behind by the deleted `PARAGRAPH_REMOVAL_ANCHORS` (the exact tombstone-comment pattern `code-design` warns about).
  Fixed and amended into the docs commit, with a follow-up grep for related stale prose.
  The reviewer independently re-verified all five "Invariants at Risk" as still pinned.
