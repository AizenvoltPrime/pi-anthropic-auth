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

[#67]: https://github.com/gotgenes/pi-anthropic-auth/issues/67
[#70]: https://github.com/gotgenes/pi-anthropic-auth/issues/70
[#71]: https://github.com/gotgenes/pi-anthropic-auth/issues/71
[#75]: https://github.com/gotgenes/pi-anthropic-auth/issues/75
