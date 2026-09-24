---
issue: 53
issue_title: "Re-examine the compat-dispatch gap now that pi 0.81.0 exposes ModelRegistry.getProvider"
---

# Re-examine the compat-dispatch gap for pi 0.81 through 0.87

## Release Recommendation

**Release:** ship independently

Issue #53 is not part of any roadmap batch in `docs/architecture.md`.
The change is documentation plus source comments, so `next-version.sh` should report a patch: `README.md`, `docs/*.md`, and `src/` are all in the release scope.

## Problem Statement

Issue [#46] documented, rather than closed, the gap where Anthropic OAuth requests dispatched through pi-ai's own `compat.streamSimple` never reach this extension's shaping wrapper.
Its blocking argument was that an api-registry override would break `cloudflare-ai-gateway`, whose provider-layer wrapping "cannot be reconstructed from the public surface".
pi 0.81.0 added `ModelRegistry.getProvider()`, which falsifies that last clause, so the issue asks whether a provider-aware override is now constructible and whether the documented gap should change.
A follow-up comment adds pi 0.86.0's `ctx.modelRegistry.streamSimple()` as a possible supported path for background agents.

Pi has shipped eleven releases since 0.80.8 (latest 0.87.1), so this plan answers the issue's four questions and also sweeps every release through 0.87.1 (plus unreleased `main`) for better APIs.

## Goals

- Record the answers to the issue's four questions and the comment's two, verified at the peer floor (v0.86.0) and at v0.87.1.
- Replace the `agent.streamFunction` workaround in `docs/architecture.md` with the supported `ctx.modelRegistry.streamSimple()` path, backed by the live measurement below.
- Correct every doc and comment that says background agents cannot be covered: they are covered when they use the supported API, which the extension that motivated Issue #18 now does.
- Narrow the documented residual to what is actually still uncovered: explicit `compat.streamSimple` callers and untyped callers that omit `streamFn`.
- Record the rejected alternatives (the provider-aware api-registry override, and a provider-aware default stream function) with the evidence that rejected them.
- Close Issue #53 at ship time with the findings.

Not a breaking change: no code path, default, or output changes.

## Non-Goals

- No `src/` behavior change and no new `src/`/`test/` code.
  The only `src/` edits are comments.
- No `registerApiProvider` override, provider-aware or otherwise; the Issue [#46] pin in `test/index-registration.test.ts` stays as is.
- No `setDefaultStreamFn` override and no `@earendil-works/pi-agent-core` peer dependency (see Design Overview, "Rejected: a provider-aware default stream function").
  The operator chose docs-only over filing it as a follow-up, so no follow-up issue is filed.
- No peer-floor change: the issue's cost section assumed a `>=0.80.8` floor, but the floor is already `>=0.86.0`, which covers both `getProvider` (0.81.0) and `ctx.modelRegistry.streamSimple` (0.86.0).
- Issue #56 (CI never exercises the peer floor) is tangential and stays open.

## Background

- `src/index.ts` registers `createAnthropicOAuthStreamSimple(...)` on `anthropic` and on config-named providers; `provider-composer`'s `streamWith` applies it to every request routed through `ModelRuntime`.
- `docs/architecture.md` carries the decision record: "The seam", the Mermaid call-path diagram, "Call paths covered", "The remaining gap: pi-ai compat dispatch", "Why this extension does not close it", and "Workaround for background-agent authors".
- `test/index-registration.test.ts` pins that registration leaves the built-in `anthropic-messages` api-registry entry untouched (Issue [#46]); that remains true and is not edited.
- The `AGENTS.md` principle "This extension exists to interface with an Anthropic subscription; Anthropic API-key traffic and every other provider must be unaffected" (recorded in `docs/retro/0046-*.md`) is the constraint that rejected both code alternatives.

## Design Overview

### Findings: the issue's four questions

Verified by reading `~/development/pi/pi` at tags v0.86.0 and v0.87.1, and the installed 0.86.0 `dist/`.

1. `modelRegistry.getProvider("cloudflare-ai-gateway")` returns the effective provider.
   `ModelRuntime.recomposeProvider` stores the untouched built-in (with `cloudflareStreams` applied) when no overlay exists, or the `composeModelProvider` result otherwise.
   So the reconstruction blocker from Issue [#46] is gone.
2. `modelRegistry` is reachable only through a handler `ctx` (`ExtensionContext.modelRegistry`), not from `ExtensionAPI` at load time.
   An api-registry entry would have to capture it at `session_start`, leaving earlier requests uncovered.
3. The compat lane passes the whole `model`, so an api-registry callee can read `model.provider`.
4. A native `Provider` registration (`ModelRuntime.registerNativeProvider`) only writes `nativeExtensionProviders` and recomposes into `ModelRuntime`.
   Nothing in `coding-agent/src` calls `registerApiProvider`, so a native registration does not reach the compat lane.

### Findings: the comment's two questions

1. `ModelRegistry.streamSimple()` delegates to `ModelRuntime.streamSimple()`, which calls `prepared.provider.streamSimple`: the composed provider, whose `streamWith` applies our wrapper.
   Measured live (below).
2. `agentLoop` and `Agent` accept a stream function, and `ctx.modelRegistry.streamSimple` fits `StreamFn`.
   `setDefaultStreamFn` is the only other seam, and it is covered in the next section.

### Findings: what newer Pi changed (sweep through 0.87.1 and `main`)

- **pi-agent-core 0.81.0** made `streamFn` required on `Agent` and on the loop functions; **0.81.1** restored a runtime-only fallback (`streamFn ?? getDefaultStreamFn()`) for legacy extensions, installed once by `sdk.ts` as `setDefaultStreamFn(compat.streamSimple)`.
  The public typings still require `streamFn` (0.86.0 `agent-loop.d.ts`, `agent.d.ts`), so only untyped or pre-0.81 callers reach the fallback.
- **`getDefaultStreamFn` is not exported** from `@earendil-works/pi-agent-core` (0.86.0 `dist/index.js` and `main` `src/index.ts` export `setDefaultStreamFn` only).
- **pi 0.86.0** added `ctx.modelRegistry.stream()`/`streamSimple()` for extension model calls through configured providers with resolved auth (Pi #8964).
- **`pi-observational-memory@3.1.4`** (2026-09-20), the extension named in Issue #18, now resolves its observer, reflector, and dropper stream through `modelRegistry.streamSimple` (`src/agents/worker-stream.ts`, `resolveWorkerStreamSimple`).
  It falls back to an explicit `compat.streamSimple` only when the host lacks that API, which is below this package's `>=0.86.0` floor.
- No release between 0.81.0 and 0.87.1, nor unreleased `main`, adds a provider-scoped transform at pi-ai's dispatch layer or makes `registerProvider` reach the api registry.

### Live measurement

Produced on 2026-09-24 with pi 0.87.1 and `anthropic/claude-haiku-4-5` over a real Claude OAuth login, via a disposable extension that issued one request from `session_start`.
The payload was synthetic: `AGENTS.md` as the system prompt plus `reply with exactly: PONG`.
It ran with `-ne -e ./src/index.ts -e <probe>`, `PI_ANTHROPIC_AUTH_DEBUG=all`.

| probe call | shaping debug lines before the probe's result | total `before-provider-request` lines (probe + main prompt) |
| --- | --- | --- |
| `ctx.modelRegistry.streamSimple(model, context)` | 1 | 2 |
| `compat.streamSimple(model, context, { apiKey, headers })` from `getApiKeyAndHeaders` | 0 | 1 |

n=1 per row; the signal is routing, which is deterministic.
Both probe requests returned 200, and so did the registry call with this extension absent: this synthetic payload does not trigger the extra-usage 400, so the status code did not discriminate and the shaping debug line is the evidence.
The build step re-runs this probe (see TDD Order step 1) so the committed docs cite a measurement taken from the tree being shipped.

### Rejected: a provider-aware api-registry override (the issue's hypothesis)

Now constructible via `getProvider`, but still rejected:

- It is still a global write to the one `anthropic-messages` slot shared by ten providers, disabling compat's built-in fast path for all of them.
- To stay exact it must re-implement compat's own branches (`withEnvApiKey`, the `cloudflare-*` unresolved-auth branch that routes through pi-ai's private `compatModels`), and `getProvider` returns pi's *composed* provider, which differs from compat's pure built-in when `models.json` overlays exist.
- It needs `ctx.modelRegistry`, available only from `session_start` on.
- Its remaining beneficiaries are callers that chose `compat.streamSimple` explicitly, and they have a supported alternative.

### Rejected: a provider-aware default stream function

Considered after the release sweep and briefly chosen by the operator, then rejected on evidence gathered before planning:

- Without `getDefaultStreamFn`, the override cannot chain to the previous default; it would hard-code `compat.streamSimple` as its base and silently clobber any other installer.
- It would reach only callers that omit a `streamFn` the types require, a legacy-only lane.
- It would add a `@earendil-works/pi-agent-core` peer dependency for that small reach.

### What the docs will say

The covered/uncovered split becomes:

| Call path | Issued by | Reaches `before_provider_request` | Reaches the wrapper |
| --- | --- | --- | --- |
| Interactive turn | agent loop `streamFn`, into `modelRuntime` | yes | yes |
| Compaction / summarization | `agent.streamFunction`, into `modelRuntime` | no | yes |
| Extension model calls and background agents using `ctx.modelRegistry.streamSimple()` | a third-party extension (pi >=0.86.0), into `modelRuntime` | no | yes |
| Explicit `compat.streamSimple` callers | a third-party extension | no | no |
| Background agents omitting `streamFn` | untyped or pre-0.81 extensions, into the `setDefaultStreamFn` fallback (`compat.streamSimple`) | no | no |
| Fork children | a separate `pi` process | per-process | for that process's own `modelRuntime` traffic |

The workaround section becomes guidance for extension authors:

```ts
// Covered: ModelRegistry -> ModelRuntime -> provider-composer -> the wrapper.
const streamFn: StreamFn = (model, context, options) =>
  ctx.modelRegistry.streamSimple(model, context, options);
await agentLoop(prompts, context, config, signal, streamFn);

// Uncovered: pi-ai's compat dispatch never reaches provider-composer.
await agentLoop(prompts, context, config, signal, compat.streamSimple);
```

The heading "The remaining gap: pi-ai compat dispatch" is kept (it is linked from "The problem" section), but its body now describes a residual reached only by explicit `compat` callers and untyped fallback users.

## Module-Level Changes

Grepped once per stale claim (`agent.streamFunction` workaround; `compat.streamSimple`/"compat dispatch"; `setDefaultStreamFn`/`agentLoop`; the reconstruction claim `builtinModels`/`getProviders()`; "cannot be covered"/"uncovered"/"out of reach"; "background agent") across the repo, excluding plans and retros.

1. `docs/architecture.md`
   - "The problem" (lines ~21 and ~26-27): the pi-observational-memory bullet becomes historical ("ran via `agentLoop` on pi-ai's bare `streamSimple`"), and "pi 0.80.8 reopened the background-agent half" gains the 0.86.0 supported path.
   - Mermaid diagram: add an `Extension model calls (ctx.modelRegistry.streamSimple)` node into `MR`; relabel `C` to `Background agents omitting streamFn (legacy fallback)`; keep `X` (explicit compat callers) and the dashed `gap` class on `C, X, CD, R`.
   - "Call paths covered": replace with the table in Design Overview.
   - "The remaining gap": reword the opening to scope the lane to explicit `compat` callers and the untyped fallback; note `getDefaultStreamFn` is unexported and `streamFn` is required in types since pi-agent-core 0.81.0.
   - "Why this extension does not close it": correct the "cannot be reconstructed" clause (`ModelRegistry.getProvider` exists since 0.81.0) and add the remaining reasons from "Rejected: a provider-aware api-registry override".
   - New subsection "Re-examined for pi 0.81 through 0.87 (Issue #53)" recording the four answers, the default-stream-fn rejection, and the live measurement table.
   - "Workaround for background-agent authors" becomes "Supported path for extension authors": the `ctx.modelRegistry.streamSimple` example, pi-observational-memory 3.1.x as the worked example, and the explicit-compat counterexample.
     Drop the `hostAgent.streamFunction` example and the `agent-session.ts` `=== streamSimple` sentence, which described the old workaround.
   - Add `[#53]` to the file's link reference definitions.
2. `AGENTS.md`
   - Current Status item 2: "not `agentLoop` background agents — see Issue #46" becomes "not explicit `compat.streamSimple` callers — see Issue #46 and Issue #53".
   - "Important upstream behavior" item 3: scope "confirmed uncovered" to explicit `compat` callers and the untyped fallback; note `ctx.modelRegistry.streamSimple` reaches the wrapper.
   - "Gap Identified So Far", second paragraph (lines ~228-234): replace the `agent.streamFunction` workaround pointer with the `ctx.modelRegistry.streamSimple` recommendation and the measured coverage.
   - Gotcha "`before_provider_request` Only Covers the Interactive Loop": "Third-party background agents calling pi-ai's bare `streamSimple` … cannot be covered" becomes the narrowed residual, with background agents using `ctx.modelRegistry.streamSimple` covered.
3. `.pi/skills/anthropic/SKILL.md`: the Repo-Specific Findings bullet (line ~51) and the Implementation Guidance sentence (line ~146) get the same narrowing, and name `ctx.modelRegistry.streamSimple` as the covered path.
4. `.pi/skills/upstream-watch/SKILL.md`: add two rows to the assumptions table.
   - "`ModelRegistry.streamSimple` delegates to `ModelRuntime.streamSimple`" → `packages/coding-agent/src/core/model-registry.ts`, `core/model-runtime.ts` → Coverage-gap (background agents using the supported path go unshaped).
   - "The agent-core default-stream fallback stays legacy-only: `getDefaultStreamFn` unexported, `streamFn` required in types" → `packages/agent/src/index.ts`, `src/types.ts`, `src/agent-loop.ts` → Coverage-gap (if upstream makes the fallback a first-class path, the rejected default-stream-fn option needs re-evaluation).
5. `README.md`: the "known exception" sentences (line ~22 and line ~109) become "background agents that issue requests through `ctx.modelRegistry.streamSimple()` are shaped; those calling pi-ai's `compat.streamSimple` directly are not".
6. `src/index.ts`: the coverage comment (lines ~38-51) names `ctx.modelRegistry.streamSimple` as covered and scopes the uncovered lane to explicit `compat` callers and the untyped `setDefaultStreamFn` fallback; the rationale for not writing the api registry stays, with "cannot be reconstructed" dropped.
7. `src/oauth-transport.ts`: the JSDoc paragraph (lines ~76-80) gets the same narrowing.
8. `docs/builtin-transport-seam-gap.md` (line ~124) and `docs/builtin-transport-seam-upstream-request.md` (line ~23): these are dated decision records, so append one sentence each rather than rewriting.
   pi 0.86.0's `ctx.modelRegistry.streamSimple()` gives foreign callers a supported path that reaches the wrapper (Issue #53); explicit `compat` callers remain unreachable.
   Add `[#53]` link definitions.

Unchanged, verified still accurate: `test/index-registration.test.ts` comments at lines ~179 and ~639 (both describe the api-registry non-participation, which holds), and the `.pi/prompts/upstream-impact.md` compat references.

## Test Impact Analysis

No test changes.
The Issue [#46] api-registry pin still describes current behavior.
No new code means no new unit tests; the live probe is a verification step, not a committed test.

## Invariants at risk

- Issue [#46]'s invariant (the extension never writes the pi-ai api registry) is pinned by `test/index-registration.test.ts`, "the extension does not write to the pi-ai api registry".
  Nothing in this plan touches it; `pnpm test` at the end confirms it.

## TDD Order

This is a build plan (`/build-plan`): documentation and comments only.
Tidy-First assessment skipped: the only `src/` edits are comments, with no structure to prepare.

1. **Re-run the live probe against the working tree** (no commit).
   Recreate the disposable probe extension (see Live measurement), run both modes with `-ne -e ./src/index.ts -e <probe>` and `PI_ANTHROPIC_AUTH_DEBUG=all`, confirm the 2-vs-1 `before-provider-request` counts, then delete the probe.
   If the counts differ, stop and revisit the plan.
2. **`docs/architecture.md`**: all changes listed in Module-Level Changes item 1, including the Mermaid edit.
   Verify the diagram renders (`mermaid` skill), and that the `gap` class still applies to the dashed lane.
   Commit: `docs: record the compat-dispatch re-examination for pi 0.81-0.87 (#53)`.
3. **User-facing and code-comment narrowing**: `README.md`, `src/index.ts`, `src/oauth-transport.ts`.
   Run `pnpm run check` and `pnpm run lint`.
   Commit: `docs: recommend ctx.modelRegistry.streamSimple for background agents (#53)`.
4. **Agent-facing docs**: `AGENTS.md`, `.pi/skills/anthropic/SKILL.md`, `.pi/skills/upstream-watch/SKILL.md`, and the two seam decision records.
   Re-run the per-claim greps from Module-Level Changes and confirm no remaining "cannot be covered" or `agent.streamFunction`-workaround wording outside plans, retros, and `CHANGELOG.md`.
   Run `pnpm exec rumdl check .pi` and `pnpm run lint:md`.
   Commit: `docs: narrow the documented compat-dispatch gap in agent docs (#53)`.
5. **Pre-completion**: `pnpm test`, then the `pre-completion` skill.

## Risks and Mitigations

- **The live measurement uses a synthetic payload that did not trigger the 400.**
  Mitigation: the docs cite the shaping debug line (a routing fact) rather than a 200, and state the payload was synthetic.
- **Missed stale passage** (the Issue [#46] implementation missed five).
  Mitigation: step 4 re-runs every per-claim grep after editing.
- **The recommendation depends on an upstream delegation.**
  Mitigation: the new upstream-watch row puts `ModelRegistry.streamSimple` → `ModelRuntime` under release review.
- **Third-party claim drift**: pi-observational-memory could change its resolver.
  Mitigation: cite the version (3.1.4) and file (`src/agents/worker-stream.ts`) so the claim is dated.

## Open Questions

- Should upstream be asked to export `getDefaultStreamFn`, or to install a `ModelRuntime`-backed default in `sdk.ts`?
  The latter would close the legacy-fallback lane for every provider at the host.
  Deferred: no concrete failure is reported on that lane, and pi's new-contributor bot auto-closed the last ask ([pi#6089]).

[#46]: https://github.com/gotgenes/pi-anthropic-auth/issues/46
[pi#6089]: https://github.com/earendil-works/pi/issues/6089
