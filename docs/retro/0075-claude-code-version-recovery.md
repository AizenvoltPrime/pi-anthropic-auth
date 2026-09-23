---
issue: 75
issue_title: "Recover from claude_code_version_too_old instead of surfacing the raw 400"
---

# Retro: #75 — Recover from claude_code_version_too_old instead of surfacing the raw 400

## Stage: Planning (2026-09-23T00:32:03Z)

### Session summary

Measured the issue's unverified premise live (12 `pi -p` probes with the env override forcing low versions) and read the Anthropic SDK 0.124.0 `fetch` call path to answer the stream-interference question.
Wrote `docs/plans/0075-claude-code-version-recovery.md`: a 7-step plan adding a rejection parser, a learned floor, a one-shot retry inside the existing `billing-version-sync` `fetch`, and an appended hint for unrecoverable rejections.

### Observations

- Premise measured: every rejection (n=4, `claude-opus-5-5` and `claude-fable-5-1`) named the floor as `version X.Y.Z or newer is required`; the floor is inclusive (2.1.251 succeeds on fable-5-1); a rejected run is under 0.63 s of whole-process wall time; six other models accept 1.0.0.
- Operator decisions: one global learned floor, not per model and not per request (operator invited pushback; agreed, because a named floor is always a released Claude Code version that real Claude Code sends to every model); env override stays absolute; unrecoverable rejections get a hint.
  The hint was first answered as "raw 400", then reversed by the operator mid-session.
- SDK facts that shaped the design: our `fetch` sits below the SDK middleware, 400 is never SDK-retried, and `APIError.makeMessage` prints the whole JSON body, so a hint appended to `error.message` is visible to the user.
  `response.clone()` keeps the non-matching 400 path untouched; a 200 is only `status`-checked.
- The floor is owned by the `createAnthropicOAuthStreamSimple` factory closure (optional second parameter for tests), keeping module-level state out, as [#74] did.
- Live-verification catch: on pi 0.87.1, Pi's own `claude-cli/2.1.280` already meets every current floor, so the recovery path is unreachable live without temporarily patching out the send-time Pi-version read.
  The devDep `pnpm exec pi` (0.86.0, user-agent 2.1.251) does not help either, because its catalog lacks `claude-opus-5-5`.
- The [#74] plan's deferred scheduled-workflow question is dropped rather than deferred: runtime recovery covers the case it was meant to catch.
- No follow-up issues filed; the status-command idea stays held on PR #71.

## Stage: Implementation — TDD (2026-09-23T02:43:02Z)

### Session summary

Landed all five code steps of the plan plus one Tidy-First preparatory commit, then live verification and docs, in seven commits.
OAuth requests now retry once at the floor a `claude_code_version_too_old` rejection names, remember that floor for the wrapper's lifetime, and append a `[pi-anthropic-auth]` hint when recovery cannot help.
Tests went from 119 to 157 (+38); `check`, `lint`, and `fallow dead-code` are clean.

### Observations

- Tidy-First (one commit): the `sonnet-5` assessor flagged that the cast `RESPONSE_STUB` had no `status`, `headers`, or `clone()`, and that the capturing fetch could not script response sequences; replacing it with a real `Response` queue kept the recovery and hint steps pure additions.
- A mutation check caught an unpinned invariant: deleting the `status !== 400` gate left every test green, because reading a 200 through `clone()` does not mark the original `bodyUsed`.
  A `vi.spyOn(success, "clone")` assertion now pins that a success response is never inspected.
  The override and `required <= sent` gates were mutation-checked the same way and did fail.
- Deviation: a floor named by a *rejected retry* is also learned (the plan said the floor learns nothing further).
  It is a real Anthropic floor, so learning it lets the next request go out at it; recorded in the `feat:` commit body.
- Deviation: the retry and hint decisions share one private `planRecovery` returning a `Recovery` union, instead of the separate retry and hint rules the plan sketched; the second rejection reuses it, with a `retry` verdict turned into a `set-override` hint.
- `CLAUDE_CODE_VERSION_TOO_OLD` stayed module-private (the plan sketched it as exported); nothing outside `src/version-rejection.ts` needs it, and exporting it would trip `fallow dead-code`.
- Added `test/version-rejection-fixtures.ts` (not in the plan) because both `test/billing-version-sync.test.ts` and `test/oauth-transport.test.ts` need a real rejection `Response`.
- Live verification, both under Pi's real loader on pi 0.87.1: the override negative control returned the 400 with the override hint appended; the patched positive (pin forced to 2.1.260, pi-version read disabled) logged `claude-code-version-recovery {"sentVersion":"2.1.260","requiredVersion":"2.1.280"}` and returned `OK`.
  Both patches were reverted with `git checkout`.
- Pre-completion reviewer: WARN.
  Reviewer warnings: `CLAUDE_CODE_VERSION_TOO_OLD` unexported versus the plan's sketch (intentional, noted above); `isRecord` now duplicated in three files (`src/request-shaping.ts`, `src/billing-version-sync.ts`, `src/version-rejection.ts`), with a fourth consumer as the trigger to extract it.
  Provenance note: each premise condition ran once (n=1 per model/version pair), which the plan already states.

## Stage: Final Retrospective (2026-09-23T03:16:43Z)

### Session summary

One session covered planning, TDD, ship, and this retro, and shipped `v3.2.0`.
OAuth requests now retry once at the floor a `claude_code_version_too_old` rejection names, remember that floor for the wrapper's lifetime, and carry a `[pi-anthropic-auth]` hint when recovery cannot help.
Tests went from 119 to 157; the issue closed with no follow-ups.

### Observations

#### What went well

- **The issue's own open question was answered with live data before the design was asked about.**
  Twelve `pi -p` probes (turns 13-14) measured whether every rejection names its floor, whether the floor is inclusive, what a rejection costs, and which models are gated.
  Reading `@anthropic-ai/sdk` 0.124.0 `client.js` answered the stream-interference question from source (our `fetch` sits below the middleware; 400 is never SDK-retried).
  Every `ask_user` option was built on those measurements, following the lesson from [#74]'s retro.
- **Planning found that the live positive check could not be run as-is**, before implementation.
  Pi 0.87.1 already reports 2.1.280, so no current floor can trigger recovery unpatched; the plan wrote down the exact working-tree patch, and it worked first try at turn 64.
- **A mutation check found a test that could not fail.**
  Deleting the `status !== 400` gate left all tests green, because reading a 200 through `clone()` does not set the original's `bodyUsed`.
  A `vi.spyOn(success, "clone")` assertion fixed it; the existing testing-skill rule ("prove a pin by mutation") is what caught it.
- **No em-dash corruption this time**, after four repairs in [#74].
  Doc edits with em-dashes went through Python scripts using the `'\u2014'` escape and an `assert s.count(old) == 1` guard, and every doc write was followed by the `u20[0-9a-f]{2}` scan the [#74] retro added.
- **Tidy-First earned its dispatch again**: the `sonnet-5` assessor spotted that the cast `RESPONSE_STUB` could not script response sequences, which kept both `feat:` commits free of test-harness changes.

#### What caused friction (agent side)

1. `premature-convergence`: two of the three `ask_user` recommendations in planning were overridden (per-model floor became one global floor; "raw 400" became "emit a hint", reversed by the operator right after the answers came back).
   Both recommendations applied "keep the override thin" to places it does not govern (user-facing error text, and state granularity).
   Impact: no rework (the reversal came before the plan was written), but one extra round trip.
2. `instruction-violation` (self-identified at retro time): source and doc edits went through `python3 - <<'EOF'` scripts and `cat >> <<'EOF'` instead of the `Edit` tool (turns 43-72), against the system-prompt rule and `markdown-conventions`' "not shell heredocs" rule.
   The early scripts had no uniqueness guard (turn 46's `s.replace` calls on `src/oauth-transport.ts`); later ones added `assert s.count(old) == 1`.
   Impact: no rework, but a silent no-op replacement was possible where the guard was missing.
3. `missing-context`: the plan sketched `CLAUDE_CODE_VERSION_TOO_OLD` as `export const` with no consumer outside its file; `fallow dead-code` would have rejected the export.
   Impact: a small deviation, flagged by the reviewer as WARN.
4. `other`: scan commands appended after `rumdl check` (`rg -n 'u20...'`) exit 1 on no match, so three tool calls (turns 26, 70, 72) rendered as errors even though they passed.
   Impact: added noise but no rework.

#### What caused friction (user side)

- The hint reversal arrived as a separate message right after the `ask_user` answers.
  Opportunity: the answer's per-option note field (used well on the persistence question, "Push back if you don't think so") would have carried it in the same round.

### Diagnostic details

1. **Model-performance correlation**: every main-session turn ran on `anthropic/claude-opus-5-5`, because the `plan-issue.md` pin carried through `/tdd-plan` and `/ship-issue`, which have no pin of their own.
   Ship is mechanical (about eight tool calls), so it did not need opus, but switching model mid-session would throw away the prompt cache for the long shared context, so a `ship-issue.md` pin to `sonnet-5` might not save anything (estimated, not measured).
   Both subagents ran `anthropic/claude-sonnet-5` and returned correct, useful judgments (the Tidy-First stub finding; the reviewer's export and `isRecord` WARNs).
2. **Escalation-delay tracking**: nothing notable; no stretch of more than five tool calls spent on one error.
3. **Unused-tool detection**: nothing notable.
4. **Feedback-loop gap analysis**: `test`, `check`, and `eslint`/`biome` ran after every TDD step, so the one `no-base-to-string` lint error (turn 53) was caught within its own step.

### Changes made

1. `AGENTS.md`: one sentence under "Keep The Override Thin" limiting it to request shaping, so user-facing diagnostics favor an actionable message over the raw upstream error (Refs #75).

[#74]: https://github.com/gotgenes/pi-anthropic-auth/issues/74
