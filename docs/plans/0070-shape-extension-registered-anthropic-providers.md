---
issue: 70
issue_title: "Anthropic OAuth providers registered by other extensions (pi-multi-pass anthropic-2) are never shaped"
---

# Shape extension-registered Anthropic OAuth providers named in a config file

## Release Recommendation

**Release:** ship independently

`docs/architecture.md` carries no numbered roadmap and no `Release:` annotations, so this issue is not a batch member.

## Problem Statement

Pi applies an extension's `streamSimple` per provider **name**, and this extension only registers `anthropic`.
An Anthropic OAuth subscription that another extension registers under its own name (pi-multi-pass registers `anthropic-2`, `anthropic-3`, …) therefore runs on Pi's bare built-in transport.
That transport sends the Claude Code user-agent, `x-app: cli`, the OAuth betas and the identity block, but no `x-anthropic-billing-header` block, and Anthropic answers a real agent prompt with the misleading `400 You're out of extra usage.`

The reporter measured the deciding factor on 2026-09-21 (pi 0.86.1, `claude-opus-5`, a 28 KB pi prompt lifted from a failing session): without the billing header the request fails whether or not the preamble is sanitized, and with it the request succeeds.
Short prompts pass either way, so a trivial repro is a false green.
Those measurements are the reporter's; they were not re-run for this plan, because reproducing them needs a second Claude seat.

## Goals

- Let the user explicitly name extra provider ids to shape, through a JSON config file following the `pi-permission-system` layout:
  - global: `<agentDir>/extensions/pi-anthropic-auth/config.json`
  - project: `<cwd>/.pi/extensions/pi-anthropic-auth/config.json`, read only when the project is trusted
- Register the **same** wrapper instance used for `anthropic` on each named provider, so the learned Claude Code floor (Issue [#75]) is shared across every Anthropic OAuth provider.
- Never `unregisterProvider` a named provider: it belongs to another extension, and unregistering would drop that extension's `models` and `oauth`.
- Treat a malformed file or an invalid entry as a warning: ignore it, keep `anthropic` shaping working, report it through a notification and in `/anthropic-auth:status`.
- List the shaped providers (with the layer that named each one) and any config warnings in `/anthropic-auth:status`.
- Non-breaking: with no config file, behavior is byte-identical to today (only `anthropic` is registered).
  Ships as `feat:` (minor bump).

## Non-Goals

- **An env-var channel** (PR [#71]'s `PI_ANTHROPIC_AUTH_PROVIDERS`).
  The operator chose the config file over the env var and over both.
  PR [#71] is closed at ship time with a comment crediting its diagnosis; the commits that adapt its test ideas carry a `Co-authored-by: Kaan Karaca <kaan94karaca@gmail.com>` trailer.
- **Auto-detection** through `ctx.modelRegistry.getRegisteredProviderIds()`.
  It exists at the 0.86.0 floor (the issue's "no enumeration API" claim is stale), but it needs an event-time scan, a no-built-in-base check to avoid breaking `cloudflare-ai-gateway`, and three or four new upstream assumptions.
  Explicit naming was preferred.
- **An owner-declared channel** (the owning extension emitting on `pi.events`).
  Requires a change in pi-multi-pass and a published contract.
- **A policy caveat in the README.**
  The planning session drafted one citing Anthropic's "ordinary, individual usage" wording; the operator declined it.
- **Un-wrapping a provider** when it leaves the config mid-process.
  Pi's `registerProvider` merge ignores `undefined`, so a registered `streamSimple` cannot be cleared without `unregisterProvider`, which is ruled out above.
  A `/reload` re-runs the factory and starts clean.
- **Validating that a named provider exists** or is Anthropic-OAuth.
  The token gate already leaves non-`sk-ant-oat` requests untouched, and pi itself surfaces an ownerless name through `modelRegistry.getError()` (see Risks).
- **The `agentLoop` / `compat.streamSimple` gap** (Issue [#46], Issue [#53]).
  Unchanged: extra providers are covered on exactly the lanes `anthropic` is.
- `src/oauth-transport.ts` is not modified.

## Background

### Why a named provider falls through to the bare transport

`provider-composer.ts` `streamWith` (pi v0.86.0, unchanged in v0.87.1) picks the transport per request:

1. `extension?.streamSimple && model.api === extension.api` → the extension's wrapper
2. otherwise, a built-in base provider that supports the api
3. otherwise, `getApiProvider(model.api)`, the bare `anthropic-messages` transport

pi-multi-pass's `registerSub` registers `{ baseUrl, api, apiKey, oauth, models, refreshModels }` and no `streamSimple`, and `anthropic-2` has no built-in base, so it lands on branch 3.
Our wrapper delegates to `anthropicMessagesApi().streamSimple`, the same bare transport, so wrapping `anthropic-2` changes only what the `sk-ant-oat` gate adds.
`ModelRuntime.streamSimple` looks the provider up per request (`this.models.getProvider(model.provider)`), so a registration made at `session_start` applies to the next request.

### Why a bare registration is safe in either order

`ModelRuntime.registerProvider` merges each registration's defined keys over the previous one and preserves the rest.

- **Owner first**: our `{ api, streamSimple }` overlays two keys; the owner's `oauth`, `models`, `baseUrl` survive.
- **Us first**: `validateExtensionProvider` passes (no models, no throw), then `recomposeProvider` records a composition error (`no authentication method configured`) until the owner's registration merges `oauth` in and the recompose succeeds.
  During initial load both land in the runner's pending queue and flush in order at bind, so the error is transient.
- **Owner removes the subscription** (`/subs remove` → `unregisterProvider`): our key goes with it, which is correct.

### Configuration conventions in the operator's packages

- `pi-permission-system`: `<agentDir>/extensions/pi-permission-system/config.json` and `<cwd>/.pi/extensions/pi-permission-system/config.json`; the project layer is withheld until `session_start` supplies a cwd and a trust decision.
- `pi-subagents`: layered `subagents.json`; a missing file is silent, a malformed one warns and is treated as absent.
- This repo so far: env vars only (`PI_ANTHROPIC_AUTH_DEBUG`, `PI_ANTHROPIC_AUTH_CLAUDE_CODE_VERSION`).

`getAgentDir()` is exported from the `@earendil-works/pi-coding-agent` root at 0.86.0 and honors `PI_CODING_AGENT_DIR` at call time.
`ExtensionContext` carries `cwd`, `hasUI`, `ui.notify`, and `isProjectTrusted()`.

### Constraints from `AGENTS.md`

- Keep the override thin; gate all shaping on the `sk-ant-oat` token.
- A change to import specifiers or registration needs a live `pi -ne … -e` repro before it is done, because jiti resolves differently from vitest (Refs #28).
  `src/index.ts` gains its first runtime import from `@earendil-works/pi-coding-agent`.
- Do not read `process.env`/`process.cwd()` inside library helpers; accept values as parameters.

## Design Overview

### Decisions taken with the operator

1. Build it, via an explicit channel rather than auto-detection.
2. Channel: a JSON config file, not an env var.
3. Location: `extensions/pi-anthropic-auth/config.json` (pi-permission-system style).
4. Layers: global + project.
5. Malformed file or entry: warn, ignore, show in status.
6. No README policy caveat.

### Config shape

```jsonc
// ~/.pi/agent/extensions/pi-anthropic-auth/config.json
{
  "providers": ["anthropic-2", "anthropic-3"]
}
```

Parsing rules, in `parseExtensionConfig(text, path)`:

| Input | Result |
| --- | --- |
| file missing (`ENOENT`) | no providers, no warning |
| unreadable (other read error) | no providers, one warning |
| not valid JSON, or top level not an object | no providers, one warning |
| `providers` absent | no providers, no warning |
| `providers` not an array | no providers, one warning |
| entry not a string, or not matching `/^[a-z0-9][a-z0-9._-]*$/i` | entry dropped, one warning per entry |
| entry `anthropic` | dropped silently (always shaped) |
| duplicate entry | dropped silently |
| unknown top-level keys | ignored silently |

Every warning names the file path, so the user knows which layer to fix.

### Layer merge

Layers **union**: global names register at load, project names register at `session_start`.
Union is forced by the mechanism rather than chosen — once registered, a wrapper cannot be removed (see Non-Goals), so a project file cannot subtract a global name.
Each name records the first layer that named it.

### New collaborators

`src/extension-config.ts` (IO edge plus a pure parser):

```typescript
export interface LoadedExtensionConfig {
  providers: readonly string[];
  warnings: readonly string[];
}

export function globalConfigPath(agentDir: string): string;
export function projectConfigPath(cwd: string): string;
export function parseExtensionConfig(text: string, path: string): LoadedExtensionConfig;
export function loadExtensionConfig(
  path: string,
  readFile: (path: string) => string = (p) => readFileSync(p, "utf8"),
): LoadedExtensionConfig;
```

`src/extra-provider-shaping.ts` (owns the extra registrations and what the status reports about them):

```typescript
export type ConfigLayer = "global" | "project";

export interface ShapedProvider {
  name: string;
  layer: ConfigLayer;
}

/** The one `ExtensionAPI` method this collaborator needs. */
export interface ProviderRegistrar {
  registerProvider(
    name: string,
    config: { api: "anthropic-messages"; streamSimple: AnthropicStreamSimple },
  ): void;
}

export class ExtraProviderShaping {
  constructor(registrar: ProviderRegistrar, streamSimple: AnthropicStreamSimple);
  /** Registers each not-yet-shaped name; replaces this layer's warnings. */
  apply(config: LoadedExtensionConfig, layer: ConfigLayer): void;
  shapedProviders(): readonly ShapedProvider[];
  warnings(): readonly string[];
}
```

ISP check: `apply` reads `providers` and `warnings` and nothing else, and `LoadedExtensionConfig` carries only those two fields.
`ProviderRegistrar` is one method, so the collaborator stays SDK-free and the test fake is a one-liner.
Warnings are stored per layer and replaced on each `apply`, so re-reading the project file at a later `session_start` does not accumulate duplicates.

### Wiring in `src/index.ts`

```typescript
const streamSimple = createAnthropicOAuthStreamSimple(builtinAnthropicStreamSimple);
pi.unregisterProvider("anthropic");
pi.registerProvider("anthropic", { api: "anthropic-messages", streamSimple });

const extraProviders = new ExtraProviderShaping(pi, streamSimple);
extraProviders.apply(loadExtensionConfig(globalConfigPath(getAgentDir())), "global");

pi.on("session_start", (_event, ctx) => {
  if (ctx.isProjectTrusted()) {
    extraProviders.apply(loadExtensionConfig(projectConfigPath(ctx.cwd)), "project");
  }
  reportConfigWarnings(extraProviders.warnings(), ctx);
});
```

`reportConfigWarnings` prefixes each line with `[pi-anthropic-auth]` (the attribution #75's hint established) and routes to `ctx.ui.notify(…, "warning")` when `ctx.hasUI`, else `console.warn`.
Global warnings are reported at `session_start` rather than at load, so there is a single reporting path with a UI in hand.
Reporting runs on every `session_start`, which repeats an unfixed warning on `/new` or `/resume`; the warning describes a still-broken file, so the repetition is accepted.

The global layer registers in the factory, not at `session_start`, so a global name is shaped before any request can reach it, matching `anthropic`.

### Diagnostics

`/anthropic-auth:status` must read state that changes after the command is registered, so `createStatusCommandHandler` takes a reader, `() => ExtensionDiagnostics`, instead of a snapshot.
`ExtensionDiagnostics` gains `shapedProviders: readonly ShapedProvider[]` and `configWarnings: readonly string[]`.
The reader in `src/index.ts` is `() => ({ ...loadDiagnostics, shapedProviders: extraProviders.shapedProviders(), configWarnings: extraProviders.warnings() })`.

Rendered:

```text
pi-anthropic-auth diagnostics
  version: 3.3.0
  module:  /Users/me/.pi/agent/.../src/index.ts
  built-in Anthropic transport: resolved
  shaped providers: anthropic, anthropic-2 (global), anthropic-3 (project)
  config warnings:
    [pi-anthropic-auth] /Users/me/.pi/agent/extensions/pi-anthropic-auth/config.json: providers[1] must be a provider name, received "anthropic 3"
```

The `config warnings:` block is omitted when there are none.

### Edge cases

- **Project untrusted**: the project file is never opened; its providers are not shaped.
- **Named provider never registered by any owner**: our bare registration leaves a persistent composition error, which pi surfaces through `modelRegistry.getError()` as `Provider "<name>": no authentication method configured.` — a visible signal of a typo or an uninstalled owner, with no effect on `anthropic`.
- **API-key request on a named provider**: the token gate passes it through untouched; the delegate is the same bare transport the provider used before.
- **`anthropic` in the file**: dropped; never unregistered or re-registered a second time.
- **Name listed in both layers**: registered once, reported with the global layer.

## Module-Level Changes

### Source

- `src/extension-config.ts` (new): paths, `parseExtensionConfig`, `loadExtensionConfig`, the provider-name pattern.
- `src/extra-provider-shaping.ts` (new): `ExtraProviderShaping`, `ProviderRegistrar`, `ShapedProvider`, `ConfigLayer`.
- `src/index.ts`: hoist the shared `streamSimple`; construct `ExtraProviderShaping`; apply the global layer at load; register the `session_start` handler (project layer + warning report); pass a diagnostics reader; add the runtime `getAgentDir` import; extend the header comment with the provider-name scope rationale.
- `src/diagnostics.ts`: `createStatusCommandHandler` takes `() => ExtensionDiagnostics`; `ExtensionDiagnostics` gains `shapedProviders` and `configWarnings`; `formatDiagnosticsReport` renders both.

### Tests

- `test/extension-config.test.ts` (new): the parsing table above, path helpers, `loadExtensionConfig` with an injected reader (`ENOENT` silent, other errors warned).
- `test/extra-provider-shaping.test.ts` (new): registers each name once with `{ api, streamSimple }` and the shared instance; never unregisters; idempotent across layers (first layer wins); per-layer warning replacement.
- `test/index-registration.test.ts`: `createFakePi` keyed by provider name with merge semantics, dispatch by `model.provider`, captured `on()` handlers and a fake `session_start` ctx; `PI_CODING_AGENT_DIR` stubbed to an empty temp dir in every suite so the real `~/.pi/agent` is never read; new tests for global-layer shaping of `anthropic-2`, owner `models`/`oauth` surviving in both load orders, trusted vs untrusted project layer, warning routing (UI vs `console.warn`), and the status report listing shaped providers.
- `test/diagnostics.test.ts`: reader-based handler; `SAMPLE` gains the two new fields; rendering of layers and the warnings block.

### Docs

- `README.md`: new `## Usage` subsection "Additional Anthropic subscriptions" (config file, both paths, trust note, status check); the "Verify the extension is loaded" sample gains the `shaped providers` line; new troubleshooting entry "Another Anthropic provider fails with "You're out of extra usage"" pointing at the config.
- `docs/architecture.md`: new `## Provider-name scope` section (the `streamWith` branches, merge contract in both orders, no-unregister, union-only layers, trust gating, the reporter's measurement table labelled as theirs); `## Related files` gains the two new modules and the updated `src/index.ts` description.
- `AGENTS.md`: Current Status list gains an item; Extension Surface names the `session_start` handler alongside `registerProvider`; Local Files gains the two new modules; Testing Guidance coverage list gains the two new suites; new Gotcha "Shaping Is Scoped By Provider Name" (short prompts are a false green; never unregister a foreign provider; config layers union).
- `.pi/skills/anthropic/SKILL.md`: a Confirmed-local-fixes bullet for extra providers; Useful References gains the two modules.
- `.pi/skills/upstream-watch/SKILL.md`: watchlist rows for (a) `streamWith` falling through to `getApiProvider` for an extension-only provider, (b) `getAgentDir` export and `PI_CODING_AGENT_DIR`, (c) `session_start` firing before the first request with `isProjectTrusted()` on the ctx.
  The existing merge-contract row gains "including over another extension's registration".

## Test Impact Analysis

1. **New tests enabled**: `ExtraProviderShaping` and `parseExtensionConfig` are testable without the Pi runtime or the filesystem, so the parsing table and the registration rules get direct unit tests instead of routing through the composition root.
2. **Redundant tests**: none; no existing test covers extra providers.
3. **Tests that must stay as-is**: the #28 shaping guard, the #43 `unregister:anthropic` ordering test (its expected `calls` stays `["unregister:anthropic", "register:anthropic"]` because the stubbed agent dir is empty), and the #46 api-registry isolation test.
   They exercise the composition root and keep passing against the rewritten fake.

## Invariants at Risk

| Invariant (origin) | Pinned by |
| --- | --- |
| `anthropic` is unregistered before it is registered (Issue [#43]) | `unregisters anthropic before re-registering…` in `test/index-registration.test.ts` — unchanged assertion |
| The extension never writes the pi-ai api registry (Issue [#46]) | `leaves the built-in anthropic-messages registry entry untouched` — unchanged |
| Every OAuth call on the composer lane is shaped (Issue [#28]) | the #28 regression guard — unchanged |
| One learned floor per wrapper instance (Issue [#75]) | new test: the extra provider's registered `streamSimple` is the same function object as `anthropic`'s |
| No config ⇒ only `anthropic` registered | new test: empty agent dir, trusted empty project ⇒ `calls` equals the #43 sequence |

## TDD Order

1. **Preparatory — hoist the shared wrapper.**
   `src/index.ts`: bind `createAnthropicOAuthStreamSimple(…)` to `const streamSimple` and pass it to the `anthropic` registration.
   Prepares step 7, which registers the same instance on extra providers; keeps that commit additive.
   Verify: existing suite green, no test edits.
   Commit: `refactor: hoist the anthropic streamSimple wrapper into a shared binding`
2. **Preparatory — reader-based status handler.**
   `src/diagnostics.ts`: `createStatusCommandHandler(read: () => ExtensionDiagnostics)`; `src/index.ts` passes `() => diagnostics`; `test/diagnostics.test.ts` call sites become `createStatusCommandHandler(() => SAMPLE)`.
   Prepares step 8, whose status data changes after registration.
   Verify: existing assertions unchanged and green.
   Commit: `refactor: let the status command read diagnostics at call time`
3. **Preparatory — per-provider fake pi.**
   `test/index-registration.test.ts`: `createFakePi` stores a `registrations` map keyed by name with `{ ...previous, ...config }` merge, dispatches by `model.provider`, captures `on()` handlers, and exposes a `fireSessionStart(ctx)` helper with a fake ctx builder (`cwd`, `isProjectTrusted`, `hasUI`, `ui.notify`).
   Prepares steps 7–8; this shared fixture is used by every test in the file, so it lands alone and green with no assertion changes.
   Commit: `test: key the fake pi's provider registrations by name with merge semantics` with a `Co-authored-by: Kaan Karaca <kaan94karaca@gmail.com>` trailer (the map-keyed fake is PR #71's).
4. **Red → green: config parsing.**
   `test/extension-config.test.ts` covers the parsing table, both path helpers, and `loadExtensionConfig` with an injected reader.
   Implement `src/extension-config.ts`.
   Commit: `refactor: add the extension config parser` (no consumer yet; `refactor:` keeps the changelog to one entry).
5. **Red → green: extra-provider registration.**
   `test/extra-provider-shaping.test.ts`: one `registerProvider` per new name with the shared instance, no unregister, first layer wins, per-layer warning replacement, `shapedProviders()` order.
   Implement `src/extra-provider-shaping.ts`.
   Commit: `refactor: add the extra-provider shaping collaborator` with the `Co-authored-by` trailer (the no-unregister and owner-survives assertions are PR #71's).
6. **Red → green: diagnostics fields.**
   `test/diagnostics.test.ts`: the report lists `anthropic` then each extra provider with its layer, and renders the warnings block only when non-empty.
   Implement the two `ExtensionDiagnostics` fields and the rendering; `src/index.ts` supplies empty values for now.
   Commit: `refactor: render shaped providers and config warnings in diagnostics`
7. **Red → green: global layer wired at load.**
   `test/index-registration.test.ts`, every suite stubbing `PI_CODING_AGENT_DIR` to a temp dir: with `{"providers":["anthropic-2"]}` in the global file, an OAuth dispatch on `anthropic-2` is shaped; the owner's `models`/`oauth` survive with the owner registering before and after; no `unregister:anthropic-2`; `anthropic-2`'s `streamSimple` is `anthropic`'s; with no file, `calls` is exactly the #43 sequence.
   Wire `ExtraProviderShaping` and the global layer in `src/index.ts`, with the diagnostics reader drawing from it.
   Commit: `feat: shape Anthropic OAuth providers named in the extension config (#70)` with the `Co-authored-by` trailer.
8. **Red → green: project layer and warning report at `session_start`.**
   Tests: a trusted project file adds `anthropic-3` (reported as `project`); an untrusted one is never read (injected reader or temp dir with a file that would otherwise register); warnings go to `ui.notify(…, "warning")` with a UI and `console.warn` without; the status command lists both layers.
   Add the `session_start` handler and `reportConfigWarnings`.
   Commit: `feat: read the project extension config on trusted sessions (#70)`
9. **Live verification (manual, gated).**
   Run `pi -ne --no-session -e src/index.ts --model anthropic/claude-haiku-4-5 -p "reply with exactly: PONG"` to confirm the runtime `getAgentDir` import loads under jiti, then `/anthropic-auth:status` with a global config naming `anthropic-2`.
   If the operator has a pi-multi-pass `anthropic-2` subscription (a second login of the same account is enough to prove shaping), load it with a second `-e`, set `PI_ANTHROPIC_AUTH_DEBUG=all`, and confirm the `anthropic-2` request logs shaping and succeeds on a real-project prompt.
   Gate this on `ask_user` (`Done` / `Need help` / `Something went wrong`).
10. **Docs.**
    `README.md`, `docs/architecture.md`, `AGENTS.md`, `.pi/skills/anthropic/SKILL.md`, `.pi/skills/upstream-watch/SKILL.md` per Module-Level Changes.
    Commit: `docs: document shaping extra Anthropic providers via the extension config (#70)`

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Tests read the developer's real `~/.pi/agent` config and pass or fail by machine | Step 7 stubs `PI_CODING_AGENT_DIR` to a temp dir in every suite of `test/index-registration.test.ts`; `getAgentDir()` reads the env at call time |
| Runtime import of `getAgentDir` fails under a loader mode | Step 9 live repro under jiti; the bare `@earendil-works/pi-coding-agent` specifier is aliased in all three modes and pi-subagents already imports it at runtime |
| A typo'd name leaves the intended provider unshaped | The name pattern warns on malformed names; a well-formed but wrong name leaves pi's own `Provider "<name>": no authentication method configured.` error, and the status line shows exactly which names are shaped |
| A project file in an untrusted repo opts providers into shaping | Gated on `ctx.isProjectTrusted()`; and shaping only ever adds the billing header to `sk-ant-oat` requests on the named provider |
| Upstream stops falling through to the bare transport for extension-only providers | New `upstream-watch` row; the wrapper would still delegate to the bare transport, which is what the provider used before |
| A registration at `session_start` lands after the first request | `session_start` is awaited in `bindExtensions` before any prompt runs, and `ModelRuntime.streamSimple` looks the provider up per request |

## Open Questions

1. Should an untrusted project that *has* a config file produce a one-line notice ("project config ignored: project not trusted")?
   Deferred until a user is confused by it.
2. If pi-multi-pass later registers its own `streamSimple`, our merge would override it for the `anthropic-messages` api.
   Revisit only if that happens; the status line makes the overlap visible.

[#28]: https://github.com/gotgenes/pi-anthropic-auth/issues/28
[#43]: https://github.com/gotgenes/pi-anthropic-auth/issues/43
[#46]: https://github.com/gotgenes/pi-anthropic-auth/issues/46
[#53]: https://github.com/gotgenes/pi-anthropic-auth/issues/53
[#71]: https://github.com/gotgenes/pi-anthropic-auth/pull/71
[#75]: https://github.com/gotgenes/pi-anthropic-auth/issues/75
