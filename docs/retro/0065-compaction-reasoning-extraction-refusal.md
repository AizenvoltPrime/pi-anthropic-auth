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
