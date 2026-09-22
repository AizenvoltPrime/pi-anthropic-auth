---
issue: 74
issue_title: "CLAUDE_CODE_VERSION is a hand-maintained pin that drifts every Claude Code release"
---

# Reconcile the Claude Code version pin with Pi's own `claude-cli` user-agent

## Release Recommendation

**Release:** ship independently

`docs/architecture.md` carries no numbered roadmap and no `Release:` annotations, so this issue is not a batch member.
Ship it promptly rather than batching: `claude-opus-5-5` is unusable on the current 3.0.1 release without an environment-variable workaround, and the pin bump in step 3 is what unblocks it.

## Problem Statement

`CLAUDE_CODE_VERSION` in `src/constants.ts` is a hand-maintained constant with no upstream source.
Anthropic gates newly released models on a minimum Claude Code version and rejects OAuth requests below it with `error_code: claude_code_version_too_old`, and the billing header this extension injects is what Anthropic keys on.
So the constant decides whether a new model works at all, and it goes stale every time Anthropic ships a Claude Code release.

That failure is live today.
pi-ai 0.87.1 added `claude-opus-5-5` to the built-in Anthropic catalog; it requires 2.1.280, and the 2.1.260 pin rejects it outright with a 400 that names our value, not Pi's.
Nothing offline caught it — `tsc` passed and all 90 tests passed while the model was entirely blocked.

Re-pinning alone resets a clock that runs out again in a couple of weeks.
The durable shape has to remove the constant's sole authority and give CI a way to see the drift.

## Goals

1. Make the pin a **floor** rather than the answer: when Pi's own `claude-cli/<version>` user-agent reports a higher Claude Code version, adopt it for the billing header on that request.
2. Bump the pin to 2.1.280 so `claude-opus-5-5` works on the next release with no environment variable, on every supported Pi version.
3. Keep the `PI_ANTHROPIC_AUTH_CLAUDE_CODE_VERSION` override absolute: an explicit user pin wins outright and is never raised.
4. Add an offline CI check that fails when Pi's bundled Claude Code version moves above our pin, and that pins the two upstream mechanisms this design depends on (`options.fetch` reaching the Anthropic SDK client, and the `claude-cli/X.Y.Z` user-agent shape).
5. Extract the version and billing-header concerns out of `src/constants.ts` so the new behavior lands in purpose-specific modules rather than growing a constants grab-bag.

This change is **not** breaking.
It adds no configuration key, removes no public surface, and changes no user-facing default.
Every exported symbol that moves is internal to this package — nothing is re-exported from `package.json` `exports`, and none are named in `README.md`.
It does change the `cc_version` bytes sent when the host Pi is ahead of our pin, which is the fix.

## Non-Goals

1. Recovering from a `claude_code_version_too_old` rejection at runtime — parsing the floor out of the 400 and retrying — is deferred to [#75].
   The premise that the 400 body reliably carries the floor rests on n=2 observations across two models, and the retry machinery is meaningfully larger than this change.
2. A scheduled workflow that compares the pin against `npm view @anthropic-ai/claude-code`.
   It is the only mechanism that catches Anthropic moving ahead of *both* Pi and us, but it costs a workflow and a network dependency; see Open Questions.
3. Rewriting Pi's outgoing `user-agent` header to match our `cc_version` when our pin is *higher*.
   The two signals disagreeing today is an unmeasured fingerprint concern, and this repo does not add unmeasured shaping; see Open Questions.
4. Issue [#70] and PR [#71] (shaping Anthropic OAuth providers registered by other extensions) are untouched by this plan.
   They also edit `src/constants.ts` and `src/index.ts` — see Risks.
5. No change to `src/system-prompt-shaping.ts`, `src/system-prompt-sections.ts`, `src/host-transport.ts`, `src/debug.ts`, or `src/diagnostics.ts`.

## Background

### How the version reaches Anthropic

`src/request-shaping.ts` builds an `x-anthropic-billing-header` system block whose `cc_version=<version>.<suffix>` field carries the pin.
The three-character suffix is `sha256(BILLING_HEADER_SALT + sampledCharacters + version)`, so the version is not a free-standing substring — changing it requires recomputing the suffix from the first user message's text.

Pi sends a second, independent version signal: `user-agent: claude-cli/<claudeCodeVersion>`, hardcoded in pi-ai's `anthropic-messages.ts`.
`AGENTS.md` records — verified live on pi 0.84.4 — that Anthropic gates on the billing header when it is present, which is why bumping only our value fixes a rejection.

### The seam the issue proposed does not exist

The issue's fourth option proposed reading Pi's version through the `transformHeaders` callback.
That mechanism does not reach this extension:

1. `Models.applyAuth` consumes `transformHeaders` and strips it before calling the provider (`packages/ai/src/models.ts:669-673`), so it is never present on the `options` our wrapper receives.
2. Even if it were, it runs on the *auth* headers, upstream of `createClient`, which is where `user-agent: claude-cli/<version>` is added (`packages/ai/src/api/anthropic-messages.ts:952`).

### The seam that does exist

`ProviderRequestOptions.fetch` (`packages/ai/src/types.ts:140`) is forwarded to `createClient` (`packages/ai/src/api/anthropic-messages.ts:570`) and handed to the Anthropic SDK client.
Both are present and unchanged at v0.86.0 (the peer floor) and v0.87.1 (current).
Pi's coding-agent sets `fetch:` nowhere, so the slot is free, and `src/oauth-transport.ts` already spreads `options` into the delegate call.

A spike confirmed the seam offline, with no network: injecting a capturing `fetch` with a fake `sk-ant-oat` key returned `user-agent: claude-cli/2.1.251`, confirmed `onPayload` fires before `fetch`, and confirmed the request body arrives as a string.

### Measured facts

All measured on 2026-09-22, offline except where noted.

| Fact | Value | How |
| --- | --- | --- |
| Current pin | 2.1.260 | `src/constants.ts` |
| pi-ai 0.86.0 (peer floor) `claudeCodeVersion` | 2.1.251 | `node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js:42` |
| pi 0.87.0 `claudeCodeVersion` | 2.1.251 | `git show v0.87.0:packages/ai/src/api/anthropic-messages.ts` |
| pi 0.87.1 `claudeCodeVersion` | 2.1.280 | `git show v0.87.1:packages/ai/src/api/anthropic-messages.ts` |
| `@anthropic-ai/claude-code` `latest` / `stable` | 2.1.280 / 2.1.267 | `npm view` (network) |
| Body rewrite cost, 250,268-byte body | 0.001 ms (median of 5) | spike, `String.replace` with the `cc_version` regex |
| Baseline suite | 90 tests, 9 files, 657 ms | `pnpm test` (single run) |

The 0.86.0 row is why the rule must be `max(pin, pi)` and not "follow Pi".
Pi at the peer floor reports 2.1.251, *below* the current pin — adopting Pi's value unconditionally would regress those users below the `claude-fable-5-1` floor.

### Constraints from `AGENTS.md`

1. Do not source the version from a local `claude --version`; `stable` lags `latest`.
2. Confirm the value rather than trusting a number quoted in an issue — 2.1.280 was re-confirmed against npm during planning.
3. Keep the override thin and preserve built-in behavior by default: the new `fetch` wrapper is injected only for `sk-ant-oat` requests, and does nothing at all unless Pi reports a higher version.

## Design Overview

### Decision model

Per request, at the `fetch` boundary:

```text
explicit env override set?  -> use it verbatim, never upgrade
otherwise:
  pi user-agent parses as claude-cli/X.Y.Z, and X.Y.Z > pin?
    yes -> rebuild the billing header at X.Y.Z, splice it into the body
    no  -> send the body exactly as onPayload produced it
```

The fast path — Pi at or below our pin — performs one header read and no body work.
The upgrade path performs one exact-string replacement, measured at 0.001 ms on a 250 KB body because the billing block is the first `system` entry and the match is found near index 0.

### Why the wire, not a process-wide cache

Pi's version is constant for the process, so caching the first observation would work from the second request onward.
It would not work for the *first* request, which is the whole request for a one-shot `pi -p` run — exactly the shape the `claude-opus-5-5` repro used.

The wrapper closure is created fresh per `streamSimple` invocation, so `onPayload` and `fetch` for the same request can share a local variable.
That correlation removes the first-request gap without a cache, a startup probe, or any module-level mutable state.

### New collaborator

`createBillingVersionSync` owns the whole reconciliation.
It is constructed per request in `src/oauth-transport.ts` and exposes exactly two members:

```typescript
export interface BillingVersionSync {
  /** Records the shaped payload so the fetch step can rebuild its billing header. */
  recordRequest(payload: unknown): void;
  /** Drop-in `fetch` that raises `cc_version` to Pi's when Pi reports a higher one. */
  fetch: FetchFunction;
}

export function createBillingVersionSync(
  baseFetch?: FetchFunction,
): BillingVersionSync;
```

Consumer call site in `src/oauth-transport.ts`:

```typescript
const versionSync = createBillingVersionSync(options?.fetch);
const onPayload = async (payload, payloadModel) => {
  const upstream = await composeCallerOnPayload(payload, payloadModel);
  if (!isAnthropicOAuthToken(options?.apiKey)) return upstream;
  const shaped = shapeAnthropicOAuthPayload(upstream);
  versionSync.recordRequest(upstream);
  return shaped;
};
return delegate(model, context, { ...options, onPayload, fetch: versionSync.fetch });
```

`recordRequest` takes the payload and extracts the first user text itself, so the wrapper never reaches into `payload.messages` — Tell-Don't-Ask holds, and the wrapper's knowledge of payload shape does not widen.
`baseFetch` is the caller's `fetch` when one was supplied, defaulting to `globalThis.fetch`, so the wrapper composes rather than displaces.
For non-OAuth requests the sync object is never constructed and `options.fetch` is forwarded untouched.

### Interface segregation

`readClaudeCliVersion` takes the user-agent string, not a `Headers` object or a payload:

```typescript
export function readClaudeCliVersion(userAgent: string | null | undefined): string | undefined;
export function higherVersion(a: string, b: string | undefined): string;
```

The caller does `new Headers(init?.headers).get("user-agent")`.
That keeps both helpers pure string functions with no fetch-shaped dependency, and makes them testable without building a request.

`higherVersion` compares `X.Y.Z` numerically, component by component.
A second argument that is `undefined` or does not match `^\d+\.\d+\.\d+$` returns the first argument — an unparseable upstream signal never lowers or corrupts our pin.

### Module extraction

Two extractions precede the new behavior, so it lands in cohesive modules:

1. `src/claude-code-version.ts` — the pin, the env key, `resolveClaudeCodeVersion`, `readClaudeCliVersion`, `higherVersion`.
   `resolveClaudeCodeVersion` is already a function sitting in a constants module; the new behavior would make that worse.
2. `src/billing-header.ts` — `BILLING_HEADER_SALT`, `BILLING_HEADER_POSITIONS`, `CLAUDE_CODE_ENTRYPOINT`, plus `getFirstUserText` and `buildBillingHeaderValue` moved out of `src/request-shaping.ts`.
   `buildBillingHeaderValue` gains an explicit `version` parameter instead of calling `resolveClaudeCodeVersion()` internally, which is what lets the fetch step rebuild the same header at a different version.

Without extraction 2, `src/billing-version-sync.ts` would have to import two private helpers newly exported from `src/request-shaping.ts`, whose public surface is deliberately a single function.

Neither extraction carries a Tell-Don't-Ask violation or an output argument out of the original code: `buildBillingHeaderValue` already returned a value and read only `messages`, and `getFirstUserText` is already pure.

### Edge cases

1. **No `user-agent`, or a non-`claude-cli` value** — no upgrade; body passes through.
2. **Env override set** — `resolveClaudeCodeVersion` returns it and the upgrade is skipped entirely, preserving the documented "pin exactly" contract.
3. **Body is not a string** (`ReadableStream`, `Blob`) — skip the upgrade rather than guess.
4. **The recorded header is not found in the body** — skip; never construct a body we cannot verify.
5. **No first user text** (no billing header was emitted) — nothing to rebuild; skip.
6. **SDK retries within one stream call** — the recorded text persists in the closure and the replacement is idempotent.
7. **`content-length`** — the spike's captured header list contains no `content-length`; undici computes it from the body we pass, so a length-changing replacement is safe.
8. **Streaming responses** — the wrapper returns the real `Response` untouched and never consumes the body.

## Module-Level Changes

### Source

1. `src/constants.ts` — remove `CLAUDE_CODE_VERSION`, `CLAUDE_CODE_VERSION_ENV`, `resolveClaudeCodeVersion`, the private `CLAUDE_CODE_VERSION_PATTERN`, `BILLING_HEADER_SALT`, `BILLING_HEADER_POSITIONS`, `CLAUDE_CODE_ENTRYPOINT`, and the "Billing header constants" comment block.
   What remains is the prompt prefixes and section anchors, matching the file's own description.
2. `src/claude-code-version.ts` — **new**; the pin (bumped to 2.1.280), the env key, `resolveClaudeCodeVersion`, `readClaudeCliVersion`, `higherVersion`.
3. `src/billing-header.ts` — **new**; the three billing constants, `getFirstUserText`, and `buildBillingHeaderValue(messageText, version)`.
4. `src/request-shaping.ts` — drop the moved helpers and their `node:crypto` import; import `buildBillingHeaderValue` and call it with `resolveClaudeCodeVersion()`.
   `MessageParam` is currently declared here and is read by `getFirstUserText`; move the type alongside it or re-export it — decide during implementation, but do not duplicate it.
5. `src/billing-version-sync.ts` — **new**; `createBillingVersionSync`, the `BillingVersionSync` interface, and the private body-splice helper.
6. `src/oauth-transport.ts` — construct the sync object for OAuth requests, call `recordRequest` after shaping, pass `fetch` to the delegate.
   Extend the existing doc comment to name the second seam.

### Tests

1. `test/request-shaping.test.ts` — update the `#src/constants` import to `#src/claude-code-version`; raise the "at or above the Fable 5.1 floor" assertion from `patch >= 251` to `patch >= 280` and retitle it for `claude-opus-5-5`.
   Its local `buildExpectedBillingHeader` oracle stays hand-rolled — it is the independent check on `buildBillingHeaderValue` and must not import it.
2. `test/claude-code-version.test.ts` — **new**; `readClaudeCliVersion` and `higherVersion`.
3. `test/billing-version-sync.test.ts` — **new**; the fetch wrapper's pass-through and upgrade paths.
4. `test/claude-code-version-drift.test.ts` — **new**; the offline drift check against the installed pi-ai.
5. `test/oauth-transport.test.ts` — add cases for `fetch` injection on OAuth requests and non-injection otherwise.
6. `test/upstream-prompt-drift.test.ts` — no change.
   It imports only prompt and section constants from `#src/constants`, and its line-39 comment describing that file as holding "strings and section names" becomes more accurate after the extraction, not less.

### Docs

1. `AGENTS.md` — the "Claude Code Version Floors Gate New Models" gotcha.
   Four stale claims, each needing its own grep because they share no vocabulary:
   - the pin's file (`src/constants.ts` → `src/claude-code-version.ts`) and value;
   - "bumped to 2.1.251 on pi `main` in `96317e50b`, still unreleased" — 0.87.1 shipped 2.1.280;
   - "Two different version signals reach Anthropic, and only one is ours" — they are now reconciled, and the higher wins;
   - "this repo can fix a version floor without waiting on a pi release" — still true, and now the converse is too.

   Also update the "Local Files" list, the "Coverage areas" list under Testing Guidance, and the architecture "Extension Surface" description of what the wrapper injects.
2. `README.md` — the `### A new model is rejected as \`claude_code_version_too_old\`` troubleshooting section.
   The sample `export` value (2.1.260 → 2.1.280), and the closing paragraph asserting that Pi's `user-agent` is something "this extension does not control" — it no longer needs to, since a higher Pi value is adopted automatically.
3. `docs/architecture.md` — the "What the wrapper does" section gains the `fetch` seam and the version reconciliation; the "Related files" list gains the three new modules.
   The line-106 mention of `user-agent: claude-cli/<version>` is a record of a 2026-09-20 measurement and stays as written.
4. `.pi/skills/anthropic/SKILL.md` — the "Shape in the `streamSimple` transport wrapper" list gains a reconciliation bullet; the "Confirmed local fixes" list gains the `max(pin, pi)` rule.
   The line-113 note that "5.1 is unreachable on the unwrapped transport because pi's `claude-cli` user-agent trips the version floor" remains correct.
   Widened the grep to the whole `.pi/skills/` tree: no other skill names the pin or the version floor.

## Test Impact Analysis

### New tests the extraction enables

1. `higherVersion` and `readClaudeCliVersion` become directly unit-testable.
   Today the only way to exercise version selection is through `shapeAnthropicOAuthPayload` on a full payload, asserting on a hashed header string.
2. `buildBillingHeaderValue(messageText, version)` becomes callable with an explicit version instead of through `process.env` mutation.
   The existing suite manipulates `process.env` with an `onTestFinished` restore for this; new tests need none of that.
3. The fetch wrapper is testable in isolation with a fake `baseFetch`, with no transport, model, or context.

### Tests that become redundant

None are removed.
`test/request-shaping.test.ts`'s env-override cases still pin the end-to-end contract that the override reaches both `cc_version` and its hashed suffix, which the new lower-level tests do not cover.

### Tests that must stay as-is

1. `test/pi-anthropic-ordering-experiment.test.ts` — pins that assistant turns pass through unmodified (Issue [#66]).
2. `test/system-prompt-sections.test.ts` and `test/system-prompt-shaping.test.ts` — pin the byte-exact section round-trip.
3. `test/index-registration.test.ts` — pins that registering the extension leaves the built-in `anthropic-messages` api-registry entry untouched.
4. `test/upstream-prompt-drift.test.ts` — unrelated surface; the sanctioned Pi-internal import precedent it sets is extended by the new drift test, which is the second and last member of that category.

## Invariants at Risk

This change adds a mutation point *downstream* of every existing shaping test, so the invariants those tests pin are no longer fully covered by them.

1. **Assistant messages pass through unmodified** (Issue [#66] outcome; pinned by `test/pi-anthropic-ordering-experiment.test.ts`).
   Those tests assert on the shaped *payload object*, not on the bytes the new `fetch` step sends.
   Mitigation: `test/billing-version-sync.test.ts` asserts that the only difference between input and output body strings is the `cc_version` field — a full-string comparison with the billing block excised.
2. **System prompt sections are preserved byte-exactly** (Issue [#67] outcome; pinned by `test/system-prompt-sections.test.ts`).
   Same gap, same mitigation — the body splice is an exact-string replacement of one recorded substring, not a JSON round-trip.
   A `JSON.parse`/`JSON.stringify` at the fetch layer is explicitly rejected for this reason.
3. **The billing block carries no `cache_control`** (pinned in `test/request-shaping.test.ts`).
   The rebuilt header is produced by the same `buildBillingHeaderValue` and spliced as a bare string, so no block structure is reconstructed.
4. **An explicit `PI_ANTHROPIC_AUTH_CLAUDE_CODE_VERSION` is used verbatim** (pinned in `test/request-shaping.test.ts`).
   The upgrade path could silently override it.
   Mitigation: a dedicated test in `test/billing-version-sync.test.ts` asserting no rewrite occurs when the env var is set, even with a higher Pi user-agent.
5. **Per-request overhead stays negligible.**
   Measured: 0.001 ms median of 5 on a 250,268-byte body for the `String.replace`, and zero body work on the non-upgrade path.
   Not re-measured at implementation time unless the splice strategy changes from exact-string replacement.

## TDD Order

1. **`refactor: extract Claude Code version resolution into its own module`**
   Move the pin, env key, pattern, and `resolveClaudeCodeVersion` from `src/constants.ts` to `src/claude-code-version.ts`.
   Update `src/request-shaping.ts` and `test/request-shaping.test.ts` imports in the same commit — removing an export breaks every importer at the type level, so extraction and all consumer updates are one step.
   No behavior change; the suite stays at 90 green.
2. **`refactor: extract billing header construction into its own module`**
   Move the three billing constants out of `src/constants.ts` and `getFirstUserText` / `buildBillingHeaderValue` out of `src/request-shaping.ts` into `src/billing-header.ts`, giving `buildBillingHeaderValue` an explicit `version` parameter.
   Update `src/request-shaping.ts` in the same commit.
   No behavior change.
3. **Red:** raise `test/request-shaping.test.ts`'s floor assertion to `patch >= 280`, retitled for `claude-opus-5-5`.
   **Green:** bump `CLAUDE_CODE_VERSION` to `"2.1.280"`.
   **Commit:** `fix: bump the Claude Code version pin to 2.1.280`
   This alone unblocks `claude-opus-5-5`; verify with a live repro against that model before proceeding.
4. **Red:** `test/claude-code-version.test.ts` — `readClaudeCliVersion` on a valid `claude-cli/2.1.280` user-agent, a missing one, a non-`claude-cli` one, and a malformed version; `higherVersion` across patch, minor, and major differences, on equal values, and with an `undefined` or unparseable second argument.
   **Green:** implement both in `src/claude-code-version.ts`.
   **Commit:** `refactor: add claude-cli user-agent parsing and version comparison`
   `refactor:`, not `feat:` — no consumer references these yet, and `cliff.toml` skips `refactor:`, so the changelog carries one entry for this change instead of two.
5. **Red:** `test/billing-version-sync.test.ts` — pass-through when the user-agent is absent, when Pi's version is lower, and when it is equal; the `cc_version` and suffix both rewritten when Pi's is higher; no rewrite when the env override is set; no rewrite on a non-string body or a body missing the recorded header; the caller's `baseFetch` receiving the rewritten request; and the invariant assertion that nothing outside the billing block changes.
   Extend `test/oauth-transport.test.ts` with `fetch` injection on OAuth requests and non-injection otherwise.
   **Green:** `src/billing-version-sync.ts` plus the wiring in `src/oauth-transport.ts`.
   **Commit:** `feat: raise cc_version to Pi's claude-cli version at the wire`
   Verify with the live `pi -p ... -ne -e src/index.ts` repro before treating this as done — the seam depends on Pi's loader and module resolution, which vitest does not exercise.
6. **Red/Green:** `test/claude-code-version-drift.test.ts` — drive the installed pi-ai's built-in `streamSimple` with a fake `sk-ant-oat` key and a throwing capturing `fetch`; assert the transport honored `options.fetch`, that the captured user-agent matches `claude-cli/X.Y.Z`, and that `higherVersion(CLAUDE_CODE_VERSION, piVersion) === CLAUDE_CODE_VERSION`.
   Passes today at 2.1.251 against the 2.1.280 pin; fails when a pi-ai bump moves Pi above us.
   **Commit:** `test: pin the installed pi-ai claude-cli version against our floor`
7. **Docs:** `AGENTS.md`, `README.md`, `docs/architecture.md`, `.pi/skills/anthropic/SKILL.md` per Module-Level Changes.
   **Commit:** `docs: record the Claude Code version reconciliation`

## Risks and Mitigations

1. **The `fetch` seam behaves differently under Pi's loader than under vitest.**
   The spike ran in-process against the devDep pi-ai, not through Pi's jiti/Bun loader.
   Mitigation: step 5 gates on a live `pi -p` repro with `-ne`, per `AGENTS.md`; the drift test in step 6 additionally pins that the transport honors `options.fetch` on every version CI installs.
2. **A future Pi release stops forwarding `options.fetch`, silently disabling the upgrade.**
   Failure would be invisible — requests still succeed, just at the pin.
   Mitigation: the drift test asserts the capturing `fetch` was actually called, so the regression fails CI rather than degrading quietly.
3. **PR [#71] and issue [#70] also edit `src/constants.ts` and `src/index.ts`.**
   Steps 1 and 2 move symbols out of `src/constants.ts`, which will conflict textually.
   Mitigation: this plan does not touch `src/index.ts`, and the conflict is a mechanical import move.
   Land whichever ships first and rebase the other.
4. **Rewriting the request body corrupts a payload.**
   Mitigation: the replacement is an exact-string splice of a substring this extension itself produced moments earlier, guarded by "skip unless found"; the invariant test in step 5 asserts nothing outside the billing block changes.
5. **The drift test becomes a recurring CI failure on every pi-ai bump.**
   That is the intended signal, not a defect — but it must be actionable.
   Mitigation: the assertion message names the observed Pi version and the command to confirm the current Claude Code release, so the fix is a one-line pin bump.
6. **2.1.280 is stale by the time this ships.**
   Mitigation: the whole point of the design is that Pi's user-agent raises it; and re-confirm against `npm view @anthropic-ai/claude-code dist-tags` at step 3 rather than trusting the number written here.

## Open Questions

1. Should a scheduled workflow compare the pin against `npm view @anthropic-ai/claude-code`?
   It is the only mechanism that catches Anthropic moving ahead of both Pi and us.
   Deferred: [#75]'s runtime recovery would cover the same case without a network dependency, so decide after [#75] is resolved.
2. Should the outgoing `user-agent` be raised to our pin when our pin is higher, so both signals agree?
   Real Claude Code always agrees with itself, so the current disagreement is a potential fingerprint.
   Deferred until a measurement shows it matters — this repo does not add unmeasured shaping (Issue [#66]).
3. Should `/anthropic-auth:status` report the resolved Claude Code version and Pi's observed one?
   It would make a version rejection self-diagnosing.
   Held back because `src/diagnostics.ts` is in PR [#71]'s diff; revisit once that lands.

[#66]: https://github.com/gotgenes/pi-anthropic-auth/issues/66
[#67]: https://github.com/gotgenes/pi-anthropic-auth/issues/67
[#70]: https://github.com/gotgenes/pi-anthropic-auth/issues/70
[#71]: https://github.com/gotgenes/pi-anthropic-auth/issues/71
[#75]: https://github.com/gotgenes/pi-anthropic-auth/issues/75
