---
issue: 65
issue_title: "/compact fails with message that it violates Anthropic's ToS"
---

# Retro: #65 — /compact fails with message that it violates Anthropic's ToS

## Stage: Planning (2026-09-14T20:45:00Z)

### Session summary

Reproduced the reported ToS refusal live against `claude-fable-5` with a disposable spike that drove the built-in Anthropic transport with a real `sk-ant-oat` token and Pi's turn-prefix summarization prompt, then isolated the cause to Pi's `serializeConversation` transcribing thinking blocks as `[Assistant thinking]:` paragraphs.
Confirmed with an unshaped control that this extension is not the cause, and that only removing the reasoning prose clears the refusal — relabeling the marker does not.
Wrote `docs/plans/0065-compaction-reasoning-extraction-refusal.md`: a dual-gated strip in a new `src/summarization-shaping.ts`, drift tests against the installed Pi's own serializer, four documentation surfaces, and an appendix drafting the upstream `earendil-works/pi` bug report for manual submission.

### Observations

- The spike produced four measured rows, all on one identical transcript: thinking present (shaped) → `refusal`; thinking present (unshaped, no billing header, no system shaping) → identical `refusal`; marker relabeled to `[Assistant notes]:` or `[Notes]:` with content unchanged → identical `refusal`; thinking removed → `end_turn` with a correct summary.
  The relabel rows are what killed the cheaper mitigation: the classifier reads the prose, not the label.
- The refusal is volume-dependent — a six-segment transcript with one thinking paragraph passed in the same run.
  That means no test can assert the refusal itself; tests can only pin the payload transformation.
- Grounding the direction took two `ask_user` rounds.
  The operator bounced the first one and asked for the upstream-issue search, the citation for "Anthropic's prompting guidance", and whether the API-key path is affected.
  All three were answerable; the API-key leg remains inference, since there is no Anthropic API key in this environment.
  Lesson: verify the citation *before* offering it as a premise in an option set.
- No upstream Pi issue exists for this.
  The nearest neighbours are pi #9602 (same `[Assistant thinking]` transcription, but framed as token overflow; closed `NOT_PLANNED` by the new-contributor auto-close), pi #7133, and pi #8017 — the latter two are prior maintainer rejections of adjacent refusal-handling requests.
  Pi's `CONTRIBUTING.md` also forbids PRs from unapproved contributors, so the deliverable is a drafted issue, not a patch.
- Scope decisions: unconditional strip (no model-name list to chase, given the `CLAUDE_CODE_VERSION` maintenance history), no opt-out environment variable, and the upstream draft lives as a plan appendix rather than a separate doc.
- Design detail worth not losing: the strip must run **before** `prependBillingHeader`, or the `cch` hash describes a message body Anthropic never receives.
  The plan pins that ordering with its own test rather than leaving it incidental.
- Segment parsing splits on paragraph boundaries followed by a known marker, not on bare `\n\n`, because a reasoning block can contain blank lines and a naive split would orphan its tail inside the request.

## Stage: Implementation — TDD (2026-09-14T20:50:00Z)

### Session summary

Landed all six planned TDD cycles plus one Tidy-First preparatory refactor, closing the `reasoning_extraction` refusal on OAuth summarization requests.
Test count went from 64 tests across 8 files to 78 across 9.
The pre-completion reviewer returned PASS, and a live `pi -ne -e` smoke repro confirmed the extension still loads and ordinary turns still work.

### Observations

- The Tidy-First assessor recommended exactly one preparatory commit — extracting `normalizeSystemBlocks` out of `prependBillingHeader`'s inline three-way ternary — because the new summarization gate needs the same normalized `TextBlock[]` earlier in the pipeline.
  It landed as `a9e3255` and made the `fix:` commit's gate a single reused call.
  The assessor explicitly rejected unifying the duplicated `TextBlock`/`MessageParam` type declarations, on the grounds that keeping `src/summarization-shaping.ts` purely string-level is the plan's design, not an oversight.
- Deviation from the plan: TDD step 2 was planned as `feat:` but committed as `refactor:`.
  Nothing referenced the new module at that commit, so a `feat:` line would have put a second, user-meaningless entry in the changelog for one change.
  `cliff.toml` skips `refactor:`, so the changelog now carries exactly the one `fix:` line that names the observable outcome.
- The first green attempt failed two tests over envelope whitespace: removing the first or last transcript segment took the envelope's own framing newline with it.
  Fixed by holding the leading and trailing newline runs aside with `/^(\n*)([\s\S]*?)(\n*)$/` and rejoining, rather than treating them as part of any segment.
- The two drift tests passed on first write, which the `testing` skill flags as either a pin or a broken probe.
  Proved they are pins by mutation: renaming `PI_TRANSCRIPT_THINKING_MARKER` and altering the summarization anchor each red the corresponding test, then reverted.
- `serializeConversation`'s real output confirmed the multi-paragraph hazard the plan predicted: a thinking block containing a blank line serializes as `[Assistant thinking]: Reason A.\n\nReason B.`, which a naive `split(/\n\n/)` would have left half-stripped in the outbound request.
- The drift-test fixture needed `as Parameters<typeof serializeConversation>[0]` — `AssistantMessage` requires `api`, `provider`, `model`, and `usage` bookkeeping the serializer never reads.
  Vitest passed without it; only `pnpm run check` caught it.
- Pre-completion reviewer: PASS. No warnings.

## Stage: Final Retrospective (2026-09-14T21:15:00Z)

### Session summary

Took a third-party bug report from unreproduced repro-steps to a shipped `v2.0.9` in one session: live-measured the root cause, planned, implemented across six TDD cycles plus one Tidy-First prep commit, and released.
The decisive work was pre-code: a four-row measured spike table that identified Pi's `serializeConversation` as the cause, cleared this extension of blame, and killed the cheaper relabeling mitigation before any design was committed to.
Test count went 64 → 78; the changelog carries exactly one `fix:` line.

### Observations

#### What went well

- The **unshaped control row** is what changed the framing of the whole issue.
  Running the identical payload through pi's built-in transport with no billing header and no system shaping produced an identical refusal, which turned "our extension breaks `/compact`" into "upstream bug this extension can mitigate."
  A spike that only tested the shaped path would have been consistent with the wrong conclusion.
- **Falsifying the cheap fix before planning it.** Relabeling `[Assistant thinking]:` to `[Assistant notes]:` and `[Notes]:` was measured and refused identically.
  Without those two rows the plan would very likely have proposed relabeling — it preserves summary fidelity and looks strictly better — and the failure would only have surfaced in a user report weeks later.
- **Drift tests pinned against pi's own runtime output**, not a fixture: `serializeConversation` is called with a real fixture conversation and the assertion checks that `PI_TRANSCRIPT_THINKING_MARKER` appears in what it actually emits.
  Then proven non-vacuous by mutation — renaming the constant and altering the anchor each red their own test.
  That same run confirmed the multi-paragraph hazard the plan predicted (`[Assistant thinking]: Reason A.\n\nReason B.`), which a naive `split(/\n\n/)` would have half-stripped.
- **`/tdd-plan`'s changelog-preview step earned its place.** It surfaced that the planned `feat:` for the unwired module would put a second, user-meaningless entry in the changelog, and the retype to `refactor:` happened via rebase reword while nothing was pushed.

#### What caused friction (agent side)

1. `missing-context` (user-caught) — the first `ask_user` round offered "Anthropic's Fable 5 guidance says don't have the model echo its reasoning" as a premise, sourced only from a GitHub issue quoting it second-hand in `web_search` results, never from Anthropic's own docs.
   The operator bounced the question and asked for the reference.
   Impact: one wasted `ask_user` round; recovery took 2 `fetch_content` calls and 5 `gh issue list` sweeps.
   No code rework — but the verification materially changed the plan, since it also turned up that pi has declined this class of report twice (pi #7133, pi #8017), which is the fact that justifies shipping a stopgap at all.
2. `missing-context` (user-caught) — "file upstream" was offered as an option without first checking whether an upstream issue already existed.
   Impact: folded into the same recovery as (1); no separate cost.
3. `other` — the first spike used `claude-haiku-4-5` per the `anthropic` skill's default and returned `stop` on every variant, proving nothing.
   Reproduction took three runs: haiku/small → fable/small → fable/large.
   Impact: two extra vitest runs, roughly \$0.13 of API spend, no rework.
   The escalation was principled (one variable per run), but the model choice was avoidable: a Terms-of-Service refusal is a model-side classifier, so it is model-specific by definition.
4. `other` (environment limit) — the claim that the refusal also hits Anthropic API-key users could not be measured; there is no Anthropic API key in this environment.
   Impact: shipped as a documented inference rather than a measurement, flagged as such in the plan, the `ask_user` context, and the issue close comment.

#### What caused friction (user side)

- The operator knew pi's maintainers auto-close new-contributor issues, but shared it only when answering the second `ask_user` round ("Pi's team is notorious for auto-closing issues…").
  Volunteering that with the first bounce would have let the first option set weigh "file upstream" realistically instead of offering it as a clean alternative to a local fix.
- The redirect itself was high-value and worth repeating: asking "what's your reference?" and "would that impact the direct API?" rather than correcting the proposal outright forced verification and surfaced a scoping question the agent had not raised.

### Diagnostic details

1. **Model-performance correlation** — planning and this retrospective ran on `anthropic/claude-opus-5`; the TDD and ship stages ran on `anthropic/claude-sonnet-5`.
   Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) are locked to `anthropic/claude-sonnet-5`.
   No mismatch: the judgment-heavy work (root-cause design, direction gating) sat on the stronger model, and the mechanical ship sequence did not.
   The `sonnet-5` `tidy-first-assessor` produced a correct architectural call in both directions — it recommended extracting `normalizeSystemBlocks` and explicitly *rejected* unifying the duplicated `TextBlock`/`MessageParam` declarations as scope creep — so no under-powering was observed.
2. **Escalation-delay tracking** — no `rabbit-hole` friction points; no sequence exceeded five consecutive tool calls on one error.
   The longest repeated sequence was the three spike runs, each a deliberate single-variable change.
3. **Unused-tool detection** — `Explore` was never dispatched.
   By the letter of `.pi/prompts/plan-issue.md` step 5 it should have been: the bug did not reproduce locally at the outset.
   But the hunt required writing a spike that makes live authenticated Anthropic calls and iterating on its variants, and `Explore` is read-only, so the rule was unexecutable as written.
   This is a real gap in the prompt, not an agent lapse.
   `colgrep` also went unused, correctly — `src/` is eight files and every lookup had an exact symbol.
4. **Feedback-loop gap analysis** — no gap.
   `pnpm test <file>` ran at every Red and every Green, `pnpm run check` before each type-touching commit (it caught the `AssistantMessage` fixture error Vitest missed), and the full `test` + `lint` + `check` + `fallow:dead-code` sweep ran before the push.

### Changes made

1. `.pi/prompts/plan-issue.md` — added a carve-out to the step 5 `Explore` dispatch rule: a root-cause hunt needing live execution (authenticated API spike, CLI repro, iterated variant table) stays inline, because `Explore` is read-only and cannot run it.
2. `.pi/prompts/plan-issue.md` — added a TDD Order rule: a step that adds a module no consumer references yet is suggested as `refactor:`, not `feat:`, so `cliff.toml` skipping `refactor:` leaves one changelog entry per change.
3. `.pi/skills/anthropic/SKILL.md` — extended the live-repro model guidance: a refusal or Terms-of-Service block is model-specific by definition, so reproduce on the model named in the report, or `claude-fable-5` when none is named.

Proposal D (sharpening `/plan-issue` step 6 to require citing the primary source rather than a search result quoting it) was presented and declined — the underlying rule already exists in that step.
