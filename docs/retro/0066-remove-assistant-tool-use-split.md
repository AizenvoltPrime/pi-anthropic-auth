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
