---
issue: 74
issue_title: "CLAUDE_CODE_VERSION is a hand-maintained pin that drifts every Claude Code release"
---

# Retro: #74 — CLAUDE_CODE_VERSION is a hand-maintained pin that drifts every Claude Code release

## Stage: Planning (2026-09-22T23:15:00Z)

### Session summary

Investigated the four options the issue proposed, found that the mechanism behind its preferred option (`transformHeaders`) does not reach this extension, and identified `ProviderRequestOptions.fetch` as the seam that does.
Spiked the seam offline to confirm Pi's `claude-cli/<version>` user-agent is observable, measured the cost of a wire-time body rewrite, and confirmed that following Pi unconditionally would regress users on the `>=0.86.0` peer floor.
Wrote `docs/plans/0074-claude-code-version-reconciliation.md` (7 steps: two extractions, a pin bump, version helpers, the fetch wrapper, an offline drift test, docs) and filed [#75] for the deferred self-healing retry.

### Observations

- The issue's option 4 was falsified in two independent ways: `Models.applyAuth` strips `transformHeaders` before calling the provider (`packages/ai/src/models.ts:672`), and it runs on auth headers upstream of where `createClient` adds the `user-agent` (`packages/ai/src/api/anthropic-messages.ts:952`).
  The *idea* survived; the mechanism did not.
  Worth checking the mechanism before the option set, not after.
- The decisive measurement was the peer floor: pi-ai 0.86.0 and pi 0.87.0 both ship `claudeCodeVersion = "2.1.251"`, below the current 2.1.260 pin.
  That turned "follow Pi" into `max(pin, pi)` and kept the pin load-bearing.
  Without it the design would have shipped a regression for anyone not on 0.87.1.
- The issue framed the fetch-seam approach as necessarily "observe-and-cache", with a first-request gap it called out as a real cost.
  That framing is wrong for this wrapper: the closure is created per `streamSimple` invocation, so `onPayload` and `fetch` for the same request share a local and the gap disappears.
  No cache, no startup probe, no module-level state.
- Rejected a `JSON.parse`/`JSON.stringify` round-trip at the fetch layer in favor of an exact-string splice, specifically to avoid putting a re-serialization downstream of the byte-exact section preservation Issue [#67] landed.
  That invariant is now pinned by a new test rather than by the absence of a mutation point.
- Two extractions (`src/claude-code-version.ts`, `src/billing-header.ts`) precede the behavior change.
  Both are justified by the new code — `src/constants.ts` would otherwise grow fetch-adjacent functions, and `src/billing-version-sync.ts` would otherwise import two newly-exported privates from `src/request-shaping.ts`.
  The tidy-first assessor may re-derive these at `/tdd-plan`; if it proposes something different, prefer its shaping.
- Detection was scoped to the offline drift test only.
  It catches "Pi moved ahead" with no network but cannot catch "Anthropic moved ahead of both", which is left to [#75] or a future scheduled workflow.
- Conflict watch: PR [#71] (issue [#70]) also edits `src/constants.ts`.
  Steps 1 and 2 move symbols out of it.

## Stage: Implementation — TDD (2026-09-22T23:05:00Z)

### Session summary

Landed all seven plan steps plus three Tidy-First preparatory commits, in ten commits.
The bundled `CLAUDE_CODE_VERSION` is now a floor that Pi's own `claude-cli` user-agent can raise at the wire, the pin moved to 2.1.280 to unblock `claude-opus-5-5`, and an offline drift test pins both our floor and the upstream mechanisms the design depends on.
Tests went from 90 to 119 (+29); `check`, `lint`, and `fallow dead-code` are clean.

### Observations

- The Tidy-First assessor caught a real trap the plan had deferred: the plan said "decide during implementation" where `MessageParam` should live, and both obvious answers were wrong (`billing-header.ts` owning a general message type, or an import cycle back to `request-shaping.ts`).
  It went to a new `src/anthropic-message.ts` instead.
  Two other preparatory commits landed on its recommendation: hoisting the OAuth gate in `oauth-transport.ts` so the `fetch` seam could reuse it, and lifting `buildExpectedBillingHeader`/`withVersionOverride` into `test/billing-header-fixtures.ts` so the new suite could share the independent oracle without importing production code.
- The live verification was the most valuable step and was cheap.
  Forcing the pin down to 2.1.260 in the working tree and running `claude-opus-5-5` on pi 0.87.1 returned `OK` — the same value that had returned a hard 400 minutes earlier — which proves the wire-level upgrade fires under Pi's real loader, not just under vitest.
  Setting the *same* 2.1.260 through `PI_ANTHROPIC_AUTH_CLAUDE_CODE_VERSION` then returned the 400, which is a negative control and a live proof that the override is absolute.
  A unit test could not have produced either result.
- All three drift tests passed on first write, so each was mutation-checked before being accepted as a pin: flipping `fetchWasCalled` to `false`, narrowing the user-agent regex to an impossible shape, and lowering the pin to `1.0.0` each produced a distinct failure.
- One API was added beyond the plan: `hasClaudeCodeVersionOverride`.
  Without it the upgrade path would read `resolveClaudeCodeVersion()` (which already returns the override) and could raise a user's explicit pin, silently breaking the documented "pin exactly" contract.
- `eslint`'s `no-unnecessary-condition` surfaced something subtle and useful: because `isAnthropicOAuthToken` is a type predicate over `options?.apiKey`, TypeScript narrows `options` itself to non-nullish inside the true branch, so `options?.fetch` there was a dead optional chain.
- Pre-completion reviewer: PASS.
  Two informational WARNs, neither addressed: `isRecord` is duplicated between `src/request-shaping.ts` and `src/billing-version-sync.ts` (three lines, two callers — shared extraction judged premature), and `fallow dupes` flags the 18-line clone between `src/billing-header.ts` and `test/billing-header-fixtures.ts`, which is the intentional independent-oracle pattern and will keep appearing.

## Stage: Final Retrospective (2026-09-22T23:47:42Z)

### Session summary

One session covered planning, TDD, a manual test pass, a prompt-template model bump, ship, and this retro.
It shipped `v3.1.0`: the Claude Code pin became a floor that Pi's `claude-cli` user-agent raises at the `fetch` boundary, the pin moved to 2.1.280, and an offline drift test now guards both.
Follow-up [#75] (runtime recovery from `claude_code_version_too_old`) was filed during planning.

### Observations

#### What went well

- **Falsifying the issue's own mechanism before asking.**
  The issue preferred reading Pi's version through `transformHeaders`; reading `packages/ai/src/models.ts:669-673` showed it is stripped before our wrapper ever runs.
  A 30-line offline spike then proved `options.fetch` exposes the `user-agent`, so the `ask_user` options were built on measured facts rather than on the issue's hypothesis.
- **The peer-floor measurement prevented a regression.**
  Checking `claudeCodeVersion` at v0.86.0 (2.1.251, *below* the 2.1.260 pin) turned "follow Pi" into `max(pin, pi)`.
  Without it, the design would have lowered the reported version for every user on the peer floor.
- **A live positive/negative control pair, invented at TDD time.**
  Forcing the pin to 2.1.260 in the working tree made `claude-opus-5-5` succeed (so the upgrade provably fired under Pi's real loader), and supplying the same 2.1.260 through the env override made it fail (so the override is provably absolute).
  No unit test can make either claim.
- **Tidy-First earned its dispatch.**
  The `sonnet-5` assessor caught that the plan's "decide during implementation" on `MessageParam`'s home had two wrong obvious answers, and its three preparatory commits left the `feat:` commit a pure addition.

#### What caused friction (agent side)

1. `instruction-violation` (self-identified, **recurring** — second retro here after `0066`, and pi-packages' `0960` retro logs the same) — wrote escaped em-dashes into `Edit` `newText` four times during the docs step (turns 126-140): a literal `\u2014` in `AGENTS.md`, a sentence split by stray line breaks in `README.md`, a failed `oldText` plus a `\nu2014` corruption in `docs/architecture.md`, and two literal `\u2014` in `.pi/skills/anthropic/SKILL.md`.
   `AGENTS.md` Editing Conventions #4 already forbids exactly this, and `docs/retro/0066-*.md` already flagged it as recurring — the prose rule does not work.
   Impact: ~12 tool calls of repair, including an 8-call sequence on `docs/architecture.md` that needed `od -c` to diagnose.
   It recurred once more while drafting this retro entry: every intended em-dash landed as a literal `\-`, repaired with a `sed` pass.
   pi-packages' `scripts/lint/invisible-characters.mjs` gate would not have caught any of these, since it targets invisible bytes (a form feed plus `erence2`), not visible escape text or a bare-newline split.
2. `other` (tool misuse, **recurring** — third retro to log it after #47 and #66) — `rg -rn` four times in planning (turns 10, 12, 17, 22), where `-r` is `--replace` and every match was silently rewritten to `n`.
   At turn 17 the garbled `import { n } from` output was misread as a minified export name before the cause was spotted at turn 22.
   Impact: two re-runs and one false inference that luckily did not reach the plan.
3. `missing-context` — guessed `UserMessage.timestamp` as an ISO string in `test/claude-code-version-drift.test.ts`; vitest passed, `tsc` failed, and a second guess (`Date.now()`) was right.
   Impact: two extra tool calls; the incremental `pnpm run check` caught it before the commit.
4. `other` — the plan left `MessageParam`'s home as "decide during implementation".
   The Tidy-First assessor resolved it, so the workflow absorbed the gap.
   Impact: none, but the plan was less decided than it looked.

#### What caused friction (user side)

- The first `/tdd-plan` attempt ran on `claude-opus-5-5` while this session's loaded extension still sent `cc_version=2.1.260`, so it hit this issue's own 400 (`req_011CfKHnvBs1chYP8fUmyARh`) and rendered as an empty turn.
  Switching back to `opus-5` and retrying was the right recovery.
  Opportunity: a model this change is *unblocking* only works in-session after the fix lands in the working tree and extensions reload; `.pi/settings.json` loads `"../"`, so a `/reload` after the pin-bump commit would have made `opus-5-5` usable mid-session.
- The prompt-template bump to `claude-opus-5-5` landed before `v3.1.0` published.
  That is safe in this repo because `"../"` loads the working tree, but it would 400 for anyone running these prompts against an installed 3.0.1 alone.

### Diagnostic details

1. **Model-performance correlation** — planning and TDD ran on `anthropic/claude-opus-5` (judgment-heavy: falsifying the issue's mechanism, the `max(pin, pi)` rule, the per-call correlation design); ship and the prompt bump ran on `anthropic/claude-sonnet-5` (mechanical); this retro runs on `anthropic/claude-opus-5-5` via the newly pinned `retro.md`.
   Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) run `anthropic/claude-sonnet-5`, and both returned correct, judgment-bearing reports.
   No mismatch.
2. **Escalation-delay tracking** — the `docs/architecture.md` em-dash repair ran 8 consecutive tool calls (turns 130-137).
   The cause was known, so no subagent would have helped; a deterministic guard would have made the failure loud at write-time instead of at a manual sweep.
3. **Unused-tool detection** — nothing notable; the `rg -rn` misfire was a flag habit, not a missing tool.
4. **Feedback-loop gap analysis** — `check`/`test`/`lint` ran after every TDD step, which caught the formatting, `no-unnecessary-condition`, `no-base-to-string`, and `timestamp` errors inside the step that caused them.
   The one gap is that `pnpm run lint` does not cover `.pi/**/*.md` or escaped codepoints, so the em-dash corruption was caught only by an ad-hoc `grep` sweep at turn 139.

### Cross-repo context

The operator asked for this retro to consult `~/development/pi/pi-packages/`, the parity source for this repo's shared skills.
It already solves the `rg -r` trap in its `shell-traps` skill, and it has a fuller "Non-ASCII in authored prose" section in `markdown-conventions`, plus an `edit-tool` skill.
Its `scripts/lint/invisible-characters.mjs` gate (#960) targets invisible bytes, not the visible escape forms this session produced, and its own `0960` retro logs the same literal-escape failure.
Five shared skills here have drifted 35-115 lines from pi-packages, and `shell-traps`/`edit-tool` were never ported.
A first draft of this retro proposed a `git grep` lint guard in `package.json`; it was dropped because it diverges from pi-packages' gate design and cannot see code spans, so it would flag the ported skill section that quotes `\u2014` on purpose.

### Changes made

1. `AGENTS.md`: Editing Conventions item 5, the `rg -r` is `--replace` rule, with pi-packages' `shell-traps` wording verbatim (Refs #47, #66, #74).
2. `.pi/skills/markdown-conventions/SKILL.md`: new "Non-ASCII in authored prose" section, adapted from pi-packages (without its `pi-autoformat` and `invisible-characters.mjs` references) and extended with this session's corruption forms and scan commands.
3. Filed gotgenes/pi-packages#967: a deterministic, code-span-aware gate for the visible escape forms, designed upstream first and then ported here.
4. Filed [#76]: resync the drifted shared skills with pi-packages and decide on porting `shell-traps` and `edit-tool`; folding the `AGENTS.md` `rg -r` stopgap back into `shell-traps` is part of it.

[#67]: https://github.com/gotgenes/pi-anthropic-auth/issues/67
[#70]: https://github.com/gotgenes/pi-anthropic-auth/issues/70
[#71]: https://github.com/gotgenes/pi-anthropic-auth/issues/71
[#75]: https://github.com/gotgenes/pi-anthropic-auth/issues/75
[#76]: https://github.com/gotgenes/pi-anthropic-auth/issues/76
