---
name: upstream-watch
description: |
  Load-bearing assumptions this extension makes about upstream Pi, mapped to the
  upstream files that would falsify each one, plus the impact-class taxonomy for
  triaging a new Pi release.
  Load when assessing a new Pi/pi-ai release, diagnosing a version regression, or
  changing code that depends on upstream internals.
compatibility: Assumes the upstream reference clone at ~/development/pi/pi with release tags fetched.
---

# Upstream Watch

This extension is a thin wrapper around upstream internals.
Every wrapper has assumptions, and upstream does not know it is holding them.
This skill lists those assumptions, names the file that would break each one, and classifies how the breakage shows up.

## Impact classes

Triage every candidate finding into one of three classes.
The classes differ in what detects them, and two of the three are not detected by the changelog.

| Class | Shows up as | Detected by |
| --- | --- | --- |
| Compile-time | `tsc` error against the new types | Scratch-tree typecheck. Free and deterministic. |
| Behavioral-silent | Shaping still runs but emits wrong output; requests still succeed | A canary test, or nothing |
| Coverage-gap | New upstream code path routes around our seam entirely | Reading the watchlist diff. Nothing else. |

Behavioral-silent is the most dangerous class for this package.
An OAuth request that is shaped incorrectly still returns 200, so no user reports it and no test fails unless a canary exists for that specific assumption.

Coverage-gap findings are invisible to both the changelog and the test suite, because from our side nothing changed.
This is the reason the watchlist below is diffed unconditionally rather than only when a changelog entry points at it.

## The watchlist

Diff each of these between the installed tag and the new tag, regardless of what the changelogs say.
Paths are relative to `~/development/pi/pi`.

| Our assumption | Upstream file | Breaks as |
| --- | --- | --- |
| `anthropicMessagesApi().streamSimple` is exported from the compat entrypoint | `packages/ai/src/compat.ts`, `packages/ai/src/api/anthropic-messages.lazy.ts` | Coverage-gap (our resolver throws at load) |
| `registerProvider` merges over prior registrations; `unregisterProvider` exists | `packages/coding-agent/src/core/model-runtime.ts`, `core/extensions/runner.ts` | Compile-time or coverage-gap |
| `provider-composer` routes the main loop and compaction through our wrapper | `packages/coding-agent/src/core/provider-composer.ts` (`streamWith`) | Coverage-gap |
| OAuth `params.system` is `[identity, prompt]` text blocks | `packages/ai/src/api/anthropic-messages.ts` (`params.system`) | Behavioral-silent |
| `messages[]` carries only `user`/`assistant` roles | `packages/ai/src/api/anthropic-messages.ts` (`convertMessages`) | Coverage-gap |
| Pi's default prompt is an untagged preamble plus `<name>` sections matching `PI_OWNED_SECTIONS` and our anchors | `packages/coding-agent/src/core/system-prompt.ts` (`buildSystemPromptSections`), `packages/ai/src/utils/text.ts` (`getSystemMessageText`) | Behavioral-silent |
| Mid-conversation section updates keep the `Updated/Removed system prompt section "<name>"` framing | `packages/ai/src/utils/text.ts` (`renderSystemMessageUpdate`) | Behavioral-silent |
| Login and refresh stay delegated to the built-in `anthropicOAuth` | `packages/ai/src/oauth*`, coding-agent auth wiring | Compile-time or runtime throw |
| `claudeCodeVersion` in pi's user-agent vs. our `cc_version` pin | `packages/ai/src/api/anthropic-messages.ts` (`claudeCodeVersion`) | Hard failure (`claude_code_version_too_old`) |
| New auxiliary request paths still reach `ModelRuntime` | any new caller (cache warmer, background agents, extension model APIs) | Coverage-gap (unshaped OAuth request) |

The last row has no fixed path on purpose.
Each release may add a new component that issues provider requests.
Check what transport it calls: `ModelRuntime.streamSimple` reaches our wrapper, pi-ai's bare `compat.streamSimple` does not.

## Read both changelogs

This package peers on two upstream packages, and the interesting entries are not reliably in the one you were handed.

1. `packages/ai/CHANGELOG.md`
2. `packages/coding-agent/CHANGELOG.md`

For pi 0.86.0 the coding-agent changelog was the higher-signal one: it announced `ctx.modelRegistry.stream()`/`streamSimple()` for extension model calls (relevant to Issue #46 and Issue #53) and prompt cache warming (a new recurring provider request path).
Neither changelog mentioned that the default system prompt had been restructured into XML-tagged sections, which was the change that actually broke shaping.

Read the Breaking Changes section of every intervening version, not only the newest.

## Verification gotchas

Two snags reliably cost time in the scratch tree.

1. Fresh upstream releases trip the lockfile age gate.
   Clear it with `pnpm clean --lockfile && pnpm install`, then expect other devDeps to move within their caret ranges.
2. `pnpm run check` and `pnpm test` re-run `pnpm install` through pnpm's deps-status gate, which fails on `ERR_PNPM_IGNORED_BUILDS` (esbuild) in a fresh tree.
   Call the binaries directly instead: `./node_modules/.bin/tsc --noEmit` and `./node_modules/.bin/vitest run`.

Typecheck cannot see the runtime resolution surface, because our delegate is resolved through a dynamic import the compiler does not follow.
Probe it directly against the new `dist/`:

```bash
node --input-type=module -e "
import * as ns from './node_modules/@earendil-works/pi-ai/dist/compat.js';
console.log(typeof ns.anthropicMessagesApi?.().streamSimple);
"
```

## Scoping blast radius

When a finding depends on a model capability flag, enumerate the catalog rather than assuming it applies everywhere.

```bash
node --input-type=module -e "
import {getBuiltinModels} from './node_modules/@earendil-works/pi-ai/dist/providers/all.js';
for (const m of getBuiltinModels('anthropic')) console.log(m.id, JSON.stringify(m.compat ?? {}));
"
```

Pi 0.86.0's mid-conversation system messages, for example, are gated on `compat.supportsMidConvoSystemMessages`, which only four flagship models set.
A finding that affects four models is a different priority from one that affects all of them.

## Version-agnostic typing

When upstream narrows a type we pass straight through, prefer deriving our signature from the delegate over importing the new type name.

```typescript
context: Parameters<AnthropicStreamSimpleDelegate>[1]
```

This typechecks against every version in the supported peer range, so it fixes the build without forcing a peer-floor bump.
Import the new type name only when we actually need to construct or inspect the value.
