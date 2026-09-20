---
issue: 66
issue_title: "splitAssistantToolUseTrailingContent breaks interleaved thinking: 400 \"thinking blocks in the latest assistant message cannot be modified\""
---

# Retro: #66 — splitAssistantToolUseTrailingContent breaks interleaved thinking

## Stage: Planning (2026-09-20T17:30:00Z)

### Session summary

Planned the fix for a third-party report that `splitAssistantToolUseTrailingContent` corrupts interleaved-thinking assistant turns.
The operator pushed back on the first `ask_user`, which offered three fixes without separating verified facts from inherited assumptions — so the session ran a live Anthropic OAuth probe before asking again.
That probe falsified the split's entire premise, and the plan (`docs/plans/0066-remove-assistant-tool-use-split.md`) removes the function rather than special-casing `thinking` inside it.

### Observations

1. The first `ask_user` was premature and correctly rejected.
   It presented three fix options and a behavior table, but never distinguished "we measured this" from "OpenCode said so in 2026".
   The operator's reply — asking what was independently verified and what the ideal end-user outcome was — is the `ask-user` skill's "do not ask on an open gap" rule arriving from the other direction.
2. The decisive measurement was not about the reported bug at all.
   `[tool_use, tool_use, text]` returns 200 on all five Claude models this extension serves, so the helper prevents a rejection that does not happen.
   That turned the "risky, unverified" option (delete it) into the evidence-backed one and demoted both narrow fixes.
3. The split came from `docs/plans/gap-analysis-and-next-steps.md:180-188`, ported from an OpenCode source comment and explicitly flagged there as "the strongest remaining candidate for a real Pi compatibility gap".
   It was never tested from this repo.
   A ported workaround with a cited-but-unverified premise is a standing liability; the plan records the measurement in `docs/architecture.md` and the `anthropic` skill so it is not re-adopted.
4. Signed `thinking` blocks cannot be forged for probing.
   The probe generated organic thinking blocks from a real Anthropic response and replayed mutations, per the `anthropic` skill's step 4.
   A forged `signature: "sig1"` would have produced signature-verification errors that look like the reported failure but prove nothing.
5. The reporter's 400 was not reproduced, and the plan says so.
   Four models and two prompt strategies would not produce two `thinking` blocks in one assistant turn on demand.
   Notably, displacing a *single* signed thinking block returns 200 — consistent with Anthropic merging consecutive same-role messages, which makes the one-block hoist a no-op and explains why this bug hid for months.
   The operator chose to label the gap inferred and proceed, since the removal rests on the trailing-text measurements instead.
6. Scope grew by one small item during design: with the split gone, the debug log's `assistantMessagesBefore`/`After` and `toolUseNamesBefore`/`After` pairs can never differ.
   They collapse in a separate `refactor:` commit so `cliff.toml` keeps the changelog to one entry.
7. Rejected alternatives: relocate only `text` blocks (keeps a measured-unnecessary transformation, still reorders narration against tool calls every turn), and the issue author's suggestion to skip messages containing `thinking` (same, plus it leaves `server_tool_use`-class blocks reorderable).

## Stage: Implementation — TDD (2026-09-20T17:45:00Z)

### Session summary

Landed the removal of `splitAssistantToolUseTrailingContent` across six commits: two Tidy-First test-fixture extractions, one upstream characterization, the fix itself, a debug-log cleanup, and the doc pass.
Test count went 88 to 90; the suite, `tsc`, lint, and the fallow dead-code gate are all green.
The live OAuth repro passed twice on the reporter's own setup (`claude-sonnet-5` with thinking, multi-tool-call turns), with no 400 and one assistant message per turn.

### Observations

1. Deviation from the plan: TDD steps 2 and 3 were folded into a single `fix:` commit.
   Keeping them separate would have put a knowingly-red commit in history, since the regression pin cannot pass until the helper is gone and the two inverted assertions break the moment it is.
   The red state was confirmed before implementing — the failure diff showed exactly the reported corruption (`[thinking, thinking]` followed by `[tool_use, tool_use]`).
   Noted in the commit body.
2. The Tidy-First assessor split its verdict by file, and both halves held up.
   It declined to prepare `src/request-shaping.ts` (a self-contained deletion needs no preparation) while recommending two fixture extractions in the test file.
   Those paid off immediately: the two new tests are content arrays rather than 30–60 line payload copies.
3. The debug log's collapsed fields turned out to be the cheapest verification signal in the live repro.
   `assistantMessages` rising 1, 2, 3 across three turns is direct evidence that no turn was split — under the old code a thinking turn with trailing content would have inflated that count.
4. The `--thinking` flag plus `-ne` is the repro combination that matters here.
   `-ne` guarantees only the working-tree copy loads, and without `--thinking` the interleaved-thinking path is never exercised at all.
5. Pre-completion reviewer: PASS.
   No warnings.
   It independently confirmed no stale references to the removed symbol or to the reworded "assistant tool-use ordering normalization" mechanism survive in `src/`, `test/`, `AGENTS.md`, `.pi/skills/`, or `README.md`, and that the historical plan docs that still mention it are covered by Non-Goals #5.
6. Still unreproduced, and deliberately so: the reporter's exact 400.
   No model would emit two `thinking` blocks in one assistant turn on demand during planning.
   The fix does not rest on it — it rests on the measurement that Anthropic accepts the ordering the removed helper existed to prevent.

## Stage: Final Retrospective (2026-09-20T19:10:42Z)

### Session summary

One continuous session took issue #66 from a third-party bug report through planning, TDD implementation, and release as `v3.0.1`.
The pivotal moment was the operator rejecting the first `ask_user`: the three fix options it offered were all built on an inherited, unverified premise, and a live OAuth probe then falsified that premise outright, turning a `thinking` special-case into a straight deletion.
Nine commits landed, tests went 88 to 90, and the pre-completion reviewer returned PASS with no warnings.

### Observations

#### What went well

1. The `anthropic` skill's "probe with organic data" guidance paid for itself in a way it was not written for.
   It exists to stop forged fixtures from producing fake refusals; here, following it into a real live probe surfaced a finding nobody was looking for — that `[tool_use, tool_use, text]` returns 200 on all five models, so the function under discussion had no reason to exist.
   The skill's value was not the answer to the question asked but the discovery that the question was the wrong one.
2. The `tidy-first-assessor` split its verdict by file and explicitly declined to prepare `src/request-shaping.ts`, reasoning that a self-contained deletion needs no preparation.
   That is the correct call and not the obvious one — an assessor biased toward finding work would have proposed structure around code about to be deleted.
   Its two test-file extractions then made the new tests content arrays instead of 30–60 line payload copies.
3. The `refactor:` commit that collapsed the tautological debug fields turned out to be the cheapest verification instrument in the live repro.
   `assistantMessages` rising 1, 2, 3 across three turns is direct evidence no turn was split; under the old code a thinking turn with trailing content would have inflated it.
   A cleanup landed for readability became the measurement.
4. Incremental verification held throughout: `pnpm run check`, `pnpm test`, and `pnpm run lint` ran after each tidying and each TDD step, plus `fallow:dead-code` at the baseline and the end, plus two live `pi` CLI repros.

#### What caused friction (agent side)

1. `instruction-violation` (user-caught) — the first `ask_user` at turn 22 offered three directions while the load-bearing premise behind all three (does Anthropic actually reject `[tool_use..., text]`?) was unverified.
   `AGENTS.md` § "Context before, not inside" says "Do not ask on an open gap … the options themselves may be wrong."
   The options themselves *were* wrong: none of the three was the right answer, and the correct one — delete the function — was absent from the option set entirely.
   Impact: one wasted `ask_user` round-trip, and the operator had to supply the reframe.
   Notable: that rule was added to `AGENTS.md` by the immediately preceding retro (#67, "Changes made" item 2) and failed to fire on the very next issue, because the gap here was not an "unexplained discrepancy" but an inherited claim nobody had tested.
2. `rabbit-hole` — roughly 17 consecutive tool calls (turns 29–45) trying to make some model organically emit two `thinking` blocks in one assistant turn, so the reporter's exact payload could be replayed.
   It never succeeded, and the attempt was ultimately abandoned and labelled inferred.
   Impact: the bulk of the planning stage's wall time; no rework, and the arc did incidentally produce the decisive `[tool_use, tool_use, text]` result at turn 44.
   The strategy change (probe the causal mechanism instead of reproducing the payload) came at turn 43, well past the 5-call threshold.
3. `missing-context` — seven of those calls (turns 30–36) were spent hunting for Anthropic model IDs in `packages/ai/src/providers/anthropic.models.ts`, which does not contain them; they live in `packages/ai/src/providers/data/anthropic.json`.
   Impact: 7 tool calls on a lookup, on an expensive model, for mechanical work.
4. `other` (tool misuse) — used `rg -rn` twice (turns 14 and 32) intending "recursive" when `-r` is `--replace`, silently rewriting every match to the literal string `n`.
   Output at turn 14 read `normalizes assistant message n when Pi serializes ...`.
   Impact: one confusing result I had to mentally undo; low, but it corrupted evidence rather than erroring.
5. `instruction-violation` (self-identified, **recurring**) — wrote `\u2014` escapes into an `Edit` `newText` at turn 110, landing five literal backslash-u sequences in this retro file, repaired at turn 111.
   Retro #67 diagnosed this exact failure mode precisely — "the `newText` case is the worse failure mode, and it is the one the addendum does not call out: a bad `oldText` fails visibly, a bad `newText` silently corrupts the file" — and then made no change to prevent it.
   Impact: one silent file corruption plus one repair call, on the second consecutive issue.
   Then a third time, while writing this retro's own `### Changes made` section: `\ns` in a `newText` (intended as a section marker) was interpreted as a JSON newline escape and split three lines apart.
   The rule proposed and adopted below was being violated in the act of recording it, which is the strongest argument available that it belongs in `AGENTS.md` rather than in a retro nobody re-reads.
6. `other` (malformed tool call) — the turn 109 `Edit` bundled a filler second edit with `oldText: "placeholder-never-matches"`, which failed the whole call.
   Impact: one wasted call, immediately retried.

#### Diagnostic details

1. Model-performance correlation.
   The entire session — planning, TDD, ship, and this retro — ran on `anthropic/claude-opus-5` with no mid-session switch.
   This is the direct contrast to #67, whose retro flagged that the ship stage silently dropped to `sonnet-5` and then became the session's hardest diagnostic problem.
   Here the ship stage was genuinely mechanical and went clean in 13 calls.
   The one mismatch in the other direction: the turn 30–36 model-ID lookup is mechanical grep work that an `Explore` subagent should have absorbed.
2. Escalation-delay tracking.
   Friction point 2 measured ~17 consecutive tool calls on one approach before the strategy changed.
   Delegation was not the remedy — the hunt needed live API execution and `Explore` is read-only, which `/plan-issue` already accounts for — so the correct move was an earlier abandonment budget, not a subagent.
3. Unused-tool detection.
   `radius_web_search` was never called.
   Anthropic's own interleaved-thinking documentation would likely have explained in one call when `thinking` blocks appear between tool calls within a single response versus across turns, which is precisely what 17 local calls failed to establish empirically.
   `colgrep` was also never used, though it would not have helped here — the misses were data-file lookups, not semantic ones.
4. Feedback-loop gap analysis.
   No gap.

#### What caused friction (user side)

1. The turn 22 pushback was the highest-leverage intervention of the session and arrived in the best possible form — a redirecting question ("what have we independently verified, and what remains to verify?") rather than a correction, plus a concrete requirement (state the ideal end-user outcome and how close each option gets).
   It changed the outcome materially: without it the session would have shipped a `thinking` special case and left the dead premise in place.
2. Opportunity, small: the plan's own step 6 gated the live repro behind an `ask_user` for the operator's Claude Max session, even though the planning stage had already demonstrated direct authenticated API access from this session.
   The plan was more cautious than its own evidence warranted; at implementation time the repro just ran directly.
   Nothing was lost, but a plan that contradicts a measurement taken 40 turns earlier is worth noticing.

### Changes made

1. `AGENTS.md` section `ask_user` Tool Usage, "Context before, not inside" — widened the "Do not ask on an open gap" rule.
   It previously covered only unexplained discrepancies; it now also covers a premise the repo inherited rather than measured, and names the option such a set usually omits ("remove the thing the premise justifies").
   Added because the rule, landed by retro #67, failed to fire on the very next issue.
2. `AGENTS.md` section Editing Conventions — added item 4: write non-ASCII literally in `Edit` `newText`, never as `\uXXXX`.
   Retro #67 diagnosed this failure mode and landed no mitigation; it recurred in this session's first retro edit.
3. Declined: a `/plan-issue` rule forbidding red-only TDD steps.
   Proposed after the plan's step 2 pin could not pass until step 3, forcing an unplanned fold; the operator chose not to codify it.
