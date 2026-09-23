---
issue: 75
issue_title: "Recover from claude_code_version_too_old instead of surfacing the raw 400"
---

# Recover from `claude_code_version_too_old` at the wire

## Release Recommendation

**Release:** ship independently

`docs/architecture.md` carries no numbered roadmap and no `Release:` annotations, so this issue is not a batch member.
It is a self-contained user-facing improvement to the `fetch` seam [#74] landed, and nothing else is queued behind it.

## Problem Statement

When Anthropic gates a model on a Claude Code version above what the billing header reports, it rejects the OAuth request with a 400 whose `error.details.error_code` is `claude_code_version_too_old` and whose message names the required floor in plain text.
Nothing in this extension reads that response, so the user sees the raw JSON and has to know about `PI_ANTHROPIC_AUTH_CLAUDE_CODE_VERSION` to get past it.

[#74] made the bundled pin a floor that Pi's own `claude-cli/<version>` user-agent can raise.
That covers Pi being ahead of us, but not Anthropic raising a floor above *both* Pi and the pin, which is exactly how [#60] (`claude-fable-5-1`) and [#74] (`claude-opus-5-5`) each started.

## Goals

1. When a `claude_code_version_too_old` rejection names a floor above the version we sent, rebuild the billing header at that floor and retry the request once, transparently to the SDK and to Pi.
2. Remember the highest floor learned this way for the lifetime of the wrapper, and send every later OAuth request at no less than it, so only the first request after a floor rise pays the rejected round trip.
3. Keep the `PI_ANTHROPIC_AUTH_CLAUDE_CODE_VERSION` override absolute: with it set, never retry and never apply a learned floor.
4. When recovery cannot run or does not succeed, append a hint to the rejection's `error.message` that tells the user what to do, while preserving the status, headers, `error.type`, `error.details.error_code`, and `request_id`.
5. Never read or alter a non-400 response; the streaming 200 path must be untouched.

This change is **not** breaking.
It adds no configuration and changes no default; a request that used to fail now either succeeds or fails with the same status, `error.type`, and `error_code`.
The one observable difference on a still-failing request is the appended hint text in `error.message`, which is additive.

## Non-Goals

1. Retrying any other error class.
   Issue [#73] (`overloaded_error`) is a separate transient-capacity concern; the Anthropic SDK already retries 5xx and 529 itself.
2. Reporting the learned floor in `/anthropic-auth:status`.
   `src/diagnostics.ts` is in PR [#71]'s diff; revisit once that lands (same hold as [#74]'s Open Question 3).
3. A scheduled workflow comparing the pin against `npm view @anthropic-ai/claude-code`.
   [#74]'s plan deferred it until this issue resolved; runtime recovery now covers the "Anthropic moved ahead of both" case it was meant to catch, so it is dropped rather than deferred.
4. Rewriting Pi's outgoing `user-agent` to match a learned floor.
   Same unmeasured-fingerprint reasoning as [#74]'s Open Question 2.
5. No change to `src/request-shaping.ts`, `src/system-prompt-*.ts`, `src/host-transport.ts`, `src/index.ts`, or `src/diagnostics.ts`.

## Background

### The seam already exists

`src/billing-version-sync.ts` ([#74]) injects an `options.fetch` for every `sk-ant-oat` request.
It is constructed per `streamSimple` call in `src/oauth-transport.ts`, records the first user text from `onPayload`, and on the way out splices a rebuilt billing header into the string body when Pi's `claude-cli` version is higher than the pin.
It currently returns the base fetch's `Response` without looking at it.

### How the SDK consumes our `fetch`

Verified in `@anthropic-ai/sdk` 0.124.0 (`client.js`):

1. `fetchWithTimeout` calls our `fetch` as the innermost step, below the SDK's middleware chain, with a string URL and an `init` whose `headers` is a `Headers` instance and whose `body` is a string.
2. One timeout timer spans a single call to our `fetch`, so a retry inside it shares that budget (Pi sets no `timeoutMs`, so the SDK's 10-minute default applies).
3. For `!response.ok`, the SDK reads `response.text()` and builds an `APIError`; 400 is not retried (`shouldRetry` covers 408, 409, 429, and 5xx).
4. `APIError.makeMessage` renders a body with no top-level `message` as `` `${status} ${JSON.stringify(body)}` ``, which is exactly the raw output the issue quotes.
   A hint appended to `error.message` therefore appears in what Pi prints.

### Premise measurement (the issue's first open question)

Measured live on 2026-09-23, pi 0.87.1, `pi --model anthropic/<model> -ne --no-session --tools read -e src/index.ts -p "Reply with exactly: OK"`, with `PI_ANTHROPIC_AUTH_CLAUDE_CODE_VERSION` forcing the reported version:

| Model | Forced version | Result | Wall time (whole process) |
| --- | --- | --- | --- |
| `claude-opus-5-5` | 2.1.260 | 400, names `2.1.280` | 0.66 s |
| `claude-opus-5-5` | 1.0.0 | 400, names `2.1.280` | 0.63 s |
| `claude-fable-5-1` | 2.1.206 | 400, names `2.1.251` | 0.67 s |
| `claude-fable-5-1` | 2.1.250 | 400, names `2.1.251` | 0.62 s |
| `claude-fable-5-1` | 2.1.251 | OK | 2.76 s |
| `claude-opus-5-5` | 2.1.280 | OK | 2.76 s |
| `claude-opus-5`, `claude-haiku-4-5`, `claude-fable-5`, `claude-sonnet-5`, `claude-opus-4-8`, `claude-sonnet-4-6` | 1.0.0 | OK | 2.6-8.4 s |

Findings:

1. Every rejection (n=4, across both gated models) carried the floor as `version X.Y.Z or newer is required` and `details.error_code: claude_code_version_too_old`.
   Still only two gated models exist, so the format is a measured convention, not a contract; the design degrades to the hint when it does not parse.
2. The floor is inclusive: retrying *at* the named version succeeds.
3. A rejected request costs well under 0.63 s: that is the measured wall time of the entire `pi` process, including startup.
4. Only the newest models are gated; every other model accepted 1.0.0.

Verbatim rejection body (used as the test fixture):

```json
{"type":"error","error":{"type":"invalid_request_error","message":"Claude Code 2.1.260 does not support this model; version 2.1.280 or newer is required. Run 'claude update', or update the Claude desktop app, then try again.","details":{"error_code":"claude_code_version_too_old"}},"request_id":"req_011CfKRGHAVWntoFsg5yexPS"}
```

### Constraints from `AGENTS.md`

1. Keep the override thin: all new behavior lives behind the existing OAuth-only `fetch` seam.
2. The body splice stays an exact-string replacement, never a JSON round-trip, so the byte-exact section preservation from [#67] survives the retry.
3. Live-verify through `pi -p ... -ne -e` before treating the seam change as done.

## Design Overview

### Decisions taken with the operator

1. **Persistence:** one learned floor for the wrapper's lifetime, not per model and not per request.
   A floor Anthropic names is a released Claude Code version, and an up-to-date Claude Code sends it to every model; the probes above found no model rejecting any version up to 2.1.280.
   Residual: a learned floor makes our `cc_version` disagree with Pi's `user-agent` on ungated models, the same disagreement the pin already produces whenever it is ahead of Pi.
2. **Override:** absolute.
   With `PI_ANTHROPIC_AUTH_CLAUDE_CODE_VERSION` set, no retry and no learned floor; the rejection is returned with the override hint.
3. **Unrecoverable rejections:** returned with a hint appended to `error.message`.

### Decision model (per request, at the `fetch` boundary)

```text
overridden = env override set
sent = overridden ? override : max(pin, pi user-agent, learned floor)
send body with billing header at `sent` (splice only when sent != resolved pin)

response.status != 400                      -> return response untouched (body never read)
clone is not a claude_code_version_too_old  -> return response untouched
overridden                                  -> return hinted(response, "override")
required unknown, or body not rebuildable   -> return hinted(response, "set env var")
required <= sent                            -> return hinted(response, "upgrade Pi")
otherwise:
  learned floor := max(learned floor, required)
  retry once with billing header at `required`
  retry is not a too_old rejection          -> return retry response
  else                                      -> return hinted(retry, same rules with sent = required)
```

"Not rebuildable" is the existing set of bail-outs: no recorded first user text, a non-string body, or a body that does not contain the header we emitted.
The retry is never followed by a second retry.

### New collaborators

`src/version-rejection.ts` (new) gives the parsed rejection behavior rather than scattering JSON reads:

```typescript
export const CLAUDE_CODE_VERSION_TOO_OLD = "claude_code_version_too_old";

export interface ClaudeCodeVersionRejection {
  /** The floor Anthropic named, when its message carries a parseable one. */
  readonly requiredVersion: string | undefined;
  /** The same error body with `hint` appended to `error.message`. */
  withHint(hint: string): string;
}

/** Returns `undefined` for anything that is not a too-old rejection body. */
export function readClaudeCodeVersionRejection(
  bodyText: string,
): ClaudeCodeVersionRejection | undefined;

export type RecoveryHintReason =
  | { kind: "override"; overrideVersion: string; requiredVersion: string | undefined }
  | { kind: "upgrade-pi"; sentVersion: string }
  | { kind: "set-override"; requiredVersion: string | undefined };

export function describeRecoveryHint(reason: RecoveryHintReason): string;
```

The hint is prefixed `[pi-anthropic-auth]`, matching `src/debug.ts`'s attribution tag.
Draft wording (final text is an implementation detail, pinned by tests):

1. `override`: `[pi-anthropic-auth] PI_ANTHROPIC_AUTH_CLAUDE_CODE_VERSION=2.1.260 is sent verbatim; raise it to 2.1.280 or newer, or unset it to let pi-anthropic-auth recover automatically.`
2. `upgrade-pi`: `[pi-anthropic-auth] The billing header already reported 2.1.280; the rejection likely comes from Pi's own claude-cli version. Upgrade Pi.`
3. `set-override`: `[pi-anthropic-auth] Automatic recovery did not succeed; set PI_ANTHROPIC_AUTH_CLAUDE_CODE_VERSION=2.1.280 and retry.` (with "the current Claude Code release from `npm view @anthropic-ai/claude-code dist-tags`" substituted when the floor is unknown).

`withHint` is the one place this extension JSON-round-trips anything, and it is a *response* body: no byte-exactness invariant applies there.

`src/claude-code-version.ts` gains the learned floor, a small stateful collaborator:

```typescript
export interface LearnedClaudeCodeFloor {
  /** Raises the floor; a lower or equal version is ignored. */
  learn(version: string): void;
  /** Returns `version` raised to the learned floor, if any. */
  applyTo(version: string): string;
}

export function createLearnedClaudeCodeFloor(): LearnedClaudeCodeFloor;
```

`applyTo` keeps the comparison inside the owner (Tell-Don't-Ask); callers never read the raw floor.
Both methods delegate to the existing `higherVersion`, so an unparseable version can neither lower nor corrupt the floor.

### Ownership and wiring

The floor must outlive a single `streamSimple` call, so it cannot live in the per-request sync.
`createAnthropicOAuthStreamSimple` owns it in the factory closure, created once at registration, and injects it into each per-request sync.
No module-level mutable state is introduced.

```typescript
export function createAnthropicOAuthStreamSimple(
  delegate: AnthropicStreamSimpleDelegate,
  learnedFloor: LearnedClaudeCodeFloor = createLearnedClaudeCodeFloor(),
): AnthropicStreamSimple {
  return (model, context, options) => {
    // ...
    const versionSync = isOAuthRequest
      ? createBillingVersionSync(learnedFloor, options.fetch)
      : undefined;
```

`src/index.ts` keeps calling it with one argument, so it is unchanged.
The optional parameter exists so `test/oauth-transport.test.ts` can observe the floor across two wrapped calls; the default is the production wiring.
`createBillingVersionSync` takes the floor first because it is now required and `baseFetch` stays optional.

Design-review check: the sync's dependency surface grows from one optional collaborator to two, each fully used; `oauth-transport.ts` relays the floor one level, which is its owner, not a pass-through intermediary.
No output arguments: the sync tells the floor to `learn`, it never writes a field on it.

### Inside `src/billing-version-sync.ts`

The existing `upgradedBody(userAgent, body)` hard-codes "from the resolved pin to Pi's version".
It generalizes into a private `rebuildBody(body, fromVersion, toVersion): string | undefined` used twice: at send time (pin to `sent`) and on retry (`sent` to `required`).
The retry reuses the original `input` and `init`, replacing only `body`, so the `AbortSignal`, method, and prepared headers carry over.

Reading the rejection uses `response.clone().text()`, so a 400 that turns out not to be a too-old rejection is returned as the original object with its body unread.
When the extension does take ownership (retry or hint), it cancels the original body and, for a hint, returns `new Response(hintedText, { status, statusText, headers })` with `content-length` and `content-encoding` dropped from the copied headers, since the new body is decoded and differently sized.
`request-id` stays in the headers, so the SDK's `APIError.requestID` survives.

A successful recovery emits `debugLog("claude-code-version-recovery", { sentVersion, requiredVersion })`, so a live repro under `PI_ANTHROPIC_AUTH_DEBUG=all` can see that it fired.

### Edge cases

1. **Concurrent requests** (compaction alongside the main loop): each has its own sync; the floor only rises, so interleaved `learn` calls converge on the max.
2. **SDK-level retries** (5xx): each SDK attempt calls our `fetch` afresh and picks up any floor learned meanwhile.
3. **Abort during the retry**: the reused signal rejects the retry fetch, and the rejection propagates to the SDK as an abort, as it would have for the first attempt.
4. **The retry is also rejected** with a higher floor (Anthropic moved again mid-request, or the message named the wrong floor): the floor learns nothing further, and the second response is returned with a hint.
   There is no third attempt.
5. **Anthropic changes the message format**: `requiredVersion` is `undefined`, so there is no retry and the rejection carries the `set-override` hint.
   Changing the `error_code` returns today's raw 400.
6. **API-key requests**: no sync is constructed, exactly as today.

## Module-Level Changes

### Source

1. `src/version-rejection.ts`: **new**; `CLAUDE_CODE_VERSION_TOO_OLD`, `readClaudeCodeVersionRejection`, `ClaudeCodeVersionRejection`, `RecoveryHintReason`, `describeRecoveryHint`.
2. `src/claude-code-version.ts`: add `LearnedClaudeCodeFloor` and `createLearnedClaudeCodeFloor`.
3. `src/billing-version-sync.ts`: take the floor; generalize the splice; apply the floor at send time; inspect 400s; retry once; hint unrecoverable rejections; debug-log a recovery.
   Update the interface doc comment, whose "without a network call, a cache, or a startup probe" claim no longer holds for the recovery path.
4. `src/oauth-transport.ts`: own the floor in the factory closure (optional second parameter) and pass it to `createBillingVersionSync`; extend the doc comment.

### Tests

1. `test/version-rejection.test.ts`: **new**; parsing and hint rendering against the verbatim body above.
2. `test/claude-code-version.test.ts`: a `describe("createLearnedClaudeCodeFloor")` block.
3. `test/billing-version-sync.test.ts`: every `createBillingVersionSync(base.fetch)` call becomes `createBillingVersionSync(createLearnedClaudeCodeFloor(), base.fetch)` (grep: 5 calls, one of them inside the `dispatch` helper); new `describe` blocks for recovery and for hints.
   `RESPONSE_STUB` has no `status`, so every existing test stays on the pass-through branch unchanged.
4. `test/oauth-transport.test.ts`: one test that two calls on the same wrapper share the floor.
   The existing fetch tests return `new Response()` (status 200) and stay green.
5. `test/claude-code-version-drift.test.ts`: no change; it drives pi-ai's transport directly, not our sync.

### Docs

Each stale claim was grepped with its own vocabulary (`claude_code_version_too_old`, `billing-version-sync`, `version floor`, `cc_version`):

1. `AGENTS.md`:
   - Current Status: add an item for runtime recovery and the hint (Issue #75).
   - Local Files: add `src/version-rejection.ts`; extend the `src/billing-version-sync.ts` and `src/claude-code-version.ts` descriptions.
   - Coverage areas: extend item 4 (`test/billing-version-sync.test.ts`) and add `test/version-rejection.test.ts`.
   - "Claude Code Version Floors Gate New Models": replace the closing claim that a version named in an error that is not our pin "means either pi's own user-agent floor or an env override" with the new reading: a surfaced rejection now means the override is set, the floor did not parse, or the retry was rejected, and the appended hint says which.
     Record the premise measurement (n=4, two models, inclusive floor, <0.63 s).
2. `README.md`, "A new model is rejected as `claude_code_version_too_old`": say the extension now retries at the named floor automatically and remembers it for the session; the env override becomes the fallback the hint points at, and a stale override disables recovery.
3. `docs/architecture.md`: the "For OAuth requests the wrapper also injects an `options.fetch` wrapper" paragraph gains the recovery path and the one-retry bound; the Related files list gains `src/version-rejection.ts`.
4. `.pi/skills/anthropic/SKILL.md`: the "Confirmed local fixes" floor bullet and the "One step does not fit in `onPayload`" paragraph gain the recovery; the line-42 measurement stays as written (the live negative control still holds).
5. `.pi/skills/upstream-watch/SKILL.md`: the `claudeCodeVersion` row's "Breaks as" softens from a hard failure to "one rejected round trip, then recovered", and gains the Anthropic-side assumption (the floor is named as `version X.Y.Z or newer is required`).

## Test Impact Analysis

1. New tests enabled: the rejection parser and hint wording are pure and testable against a real captured body; the learned floor is testable without a request; recovery is testable with a scripted base fetch returning a real `Response` sequence.
2. Redundant tests: none.
   The existing billing-version-sync tests pin the send-time upgrade, which this change extends rather than replaces.
3. Must stay as-is: `test/claude-code-version-drift.test.ts` (pins `options.fetch` forwarding, without which recovery silently disables too), `test/pi-anthropic-ordering-experiment.test.ts`, and `test/system-prompt-sections.test.ts`.

## Invariants at Risk

From [#74]'s outcome:

1. **Nothing outside the billing block changes** (pinned by "changes nothing outside the billing header block").
   The retry body is a second splice.
   New test: the retried body, with the billing header excised, equals the original.
2. **The override is absolute** (pinned by "honors an explicit version override instead of raising it").
   Recovery and the learned floor are both new ways to raise it.
   New tests: with the override set, a too-old rejection causes exactly one base call, and a floor learned earlier is not applied.
3. **The non-upgrade fast path does no body work.**
   Extended: a 200 response is returned as the same object with `bodyUsed === false`, and a non-too-old 400 is returned as the same object with its body still readable.
4. **The streaming path is untouched** (issue's third open question).
   Pinned by invariant 3: the only work on a 200 is one `status` comparison.

Baseline: 119 tests in 12 files, all green (measured at planning time).

## TDD Order

1. **Red:** `test/version-rejection.test.ts`: the verbatim body parses to `requiredVersion: "2.1.280"`; a non-JSON body, a JSON body with another `error_code`, and a body with no `error` object return `undefined`; a too-old body whose message carries no version parses with `requiredVersion: undefined`; `withHint` appends to `error.message` and preserves `type`, `error.type`, `details.error_code`, and `request_id`; each `describeRecoveryHint` variant names the env var and versions it should.
   **Green:** `src/version-rejection.ts`.
   **Commit:** `refactor: parse claude_code_version_too_old rejections` (`refactor:`, since nothing consumes it yet).
2. **Red:** `test/claude-code-version.test.ts`: a fresh floor's `applyTo` returns its input; `learn` raises it; a lower `learn` does not lower it; an unparseable `learn` is ignored.
   **Green:** `createLearnedClaudeCodeFloor`.
   **Commit:** `refactor: add a learned Claude Code version floor`
3. **Refactor (no red):** generalize `upgradedBody` into `rebuildBody(body, from, to)` and make `createBillingVersionSync` take the floor (applied at send time, never learned into yet); update the `oauth-transport.ts` call site and all test call sites in the same commit, since the signature change breaks them at the type level.
   Suite stays at 119 green.
   **Commit:** `refactor: route the billing version sync through a learned floor`
4. **Red:** `test/billing-version-sync.test.ts` `describe("recovery")`: a too-old 400 naming a higher floor triggers exactly one retry whose body carries the rebuilt header at that floor and is otherwise identical; the retry's `Response` is returned; the floor has learned the version (a second sync sharing it sends at that version on its first call); a 200 is returned as the same object with its body unread; a non-too-old 400 is returned as the same object, body readable; override set means one call only; `required <= sent` means one call only; a non-rebuildable body means one call only; a rejected retry means exactly two calls.
   `test/oauth-transport.test.ts`: two wrapped calls share the floor.
   **Green:** recovery in `src/billing-version-sync.ts`, floor ownership in `src/oauth-transport.ts`, and the debug log.
   **Commit:** `feat: retry claude_code_version_too_old rejections at the required version`
5. **Red:** `describe("hints")`: each no-retry path from step 4 returns a 400 whose `error.message` ends with the matching hint, whose `error_code` and `request_id` are intact, and whose `request-id` header survives, with no `content-length` header; a rejected retry returns the second body hinted with `sent` = the retried version.
   Step 4's no-retry tests assert only call counts and status, so none of them flip here.
   **Green:** response rebuilding in `src/billing-version-sync.ts`.
   **Commit:** `feat: explain unrecoverable claude_code_version_too_old rejections`
6. **Live verification (no commit).**
   Negative control, runnable as-is on pi 0.87.1: `PI_ANTHROPIC_AUTH_CLAUDE_CODE_VERSION=2.1.260` against `claude-opus-5-5` must still 400, now with the `override` hint in the printed message.
   Positive: on pi 0.87.1, Pi's user-agent (2.1.280) already meets every current floor, so recovery is unreachable without a patch.
   Temporarily set `CLAUDE_CODE_VERSION` to `"2.1.260"` and make the send-time Pi-version read return `undefined` in the working tree, then run `claude-opus-5-5` with `PI_ANTHROPIC_AUTH_DEBUG=all`; expect `OK` and one `claude-code-version-recovery` log line.
   Revert both edits with `git checkout` afterward.
7. **Docs:** `AGENTS.md`, `README.md`, `docs/architecture.md`, `.pi/skills/anthropic/SKILL.md`, `.pi/skills/upstream-watch/SKILL.md` per Module-Level Changes.
   **Commit:** `docs: record claude_code_version_too_old recovery`

## Risks and Mitigations

1. **The floor format is n=4 across two models.**
   A format change degrades to the `set-override` hint, never to a wrong retry: `requiredVersion` must match `X.Y.Z` and exceed what we sent.
2. **A retry doubles latency on the first gated request.**
   Measured under 0.63 s per rejection, and paid once per floor rise per process, not per request.
3. **The retry corrupts the request body.**
   Same exact-string splice as [#74], guarded by "header found"; invariant 1's new test pins it.
4. **Reading the 400 body starves the SDK.**
   `clone()` on the untouched path, and a fresh `Response` on the owned paths; step 4 asserts the returned body is still readable.
5. **The hint changes an error message someone matches on.**
   The hint is appended, not substituted, and `error_code` is preserved; matching on `error_code` is unaffected.
6. **The live positive requires a temporary patch**, so it verifies Pi's loader and the real Anthropic response, not the unpatched send-time path.
   The unpatched path is already live-verified by [#74] and is unchanged apart from the floor, which defaults to a no-op.

## Open Questions

1. Should `/anthropic-auth:status` show the learned floor?
   Deferred until PR [#71] lands (Non-Goal 2).
2. If a model ever rejects a version *above* some ceiling, a floor learned from another model could break it, and the global floor would need to become per model.
   No such case has been observed; revisit only on a live rejection.

[#60]: https://github.com/gotgenes/pi-anthropic-auth/issues/60
[#67]: https://github.com/gotgenes/pi-anthropic-auth/issues/67
[#71]: https://github.com/gotgenes/pi-anthropic-auth/issues/71
[#73]: https://github.com/gotgenes/pi-anthropic-auth/issues/73
[#74]: https://github.com/gotgenes/pi-anthropic-auth/issues/74
