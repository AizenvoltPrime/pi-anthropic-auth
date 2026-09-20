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
