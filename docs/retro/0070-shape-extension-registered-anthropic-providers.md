---
issue: 70
issue_title: "Anthropic OAuth providers registered by other extensions (pi-multi-pass anthropic-2) are never shaped"
---

# Retro: #70 — Anthropic OAuth providers registered by other extensions (pi-multi-pass anthropic-2) are never shaped

## Stage: Planning (2026-09-24T03:16:59Z)

### Session summary

Planned third-party issue #70 (reporter also opened PR #71, which now conflicts with `main` after #74/#75).
The operator steered away from the proposed env var toward a JSON config file (`extensions/pi-anthropic-auth/config.json`, global plus trusted-project layers, warn-and-ignore on bad input), and the plan registers the shared wrapper on each named provider without unregistering it.
Plan committed as `docs/plans/0070-shape-extension-registered-anthropic-providers.md`.

### Observations

- The operator raised a ToS concern before choosing a direction.
  Anthropic's legal and compliance page says subscription OAuth supports "ordinary use of Claude Code and other native Anthropic applications" and that Pro/Max limits "assume ordinary, individual usage"; the Consumer Terms forbid "bypassing any of our systems or protective measures".
  pi-multi-pass markets automatic rate-limit rotation across accounts, which is the darker part of the grey.
  The operator chose to build it and declined a README policy caveat.
- The issue's premise that pi exposes no provider enumeration is stale at the 0.86.0 floor: `ModelRegistry.getRegisteredProviderIds()` / `getRegisteredProviderConfig()` exist, reachable from event contexts only.
  Auto-detection was rejected for cost (event-time scan, a no-built-in-base check to spare `cloudflare-ai-gateway`, three or four new upstream assumptions) and in favor of explicit naming.
- Verified against pi v0.86.0 source: `streamWith` falls through to `getApiProvider` for an extension-only provider, `registerProvider` merges defined keys (safe in either load order, with a transient composition error when we register first), and `ModelRuntime.streamSimple` looks the provider up per request, so a `session_start` registration takes effect.
- Layers union rather than override because a registered `streamSimple` cannot be cleared by the merge without `unregisterProvider`, which would drop the owner's `oauth`/`models`.
- The first `ask_user` offered only env-var/auto-detect/decline; the operator bounced it with "is there another explicit channel", pointing at `pi-permission-system`/`pi-subagents` configs.
  Surveying sibling packages' configuration conventions before building the option set would have saved a round.
- The tidy-first assessor recommended three preparatory commits (hoist the shared wrapper, reader-based status handler, per-provider fake pi); all three lead the TDD Order.
  It suggested `let diagnostics` for the reader; `const` with a closure suffices.
- PR #71 is to be closed at ship time with credit; commits that adapt its fake-pi and no-unregister tests carry a `Co-authored-by` trailer.
- The live repro of the reporter's 400 needs a second Claude seat and was not re-run; the plan labels those measurements as the reporter's.

## Stage: Implementation — TDD (2026-09-24T04:55:27Z)

### Session summary

Executed all ten TDD Order steps: three preparatory refactors (shared `streamSimple` binding, reader-based status handler, per-provider fake pi), the config parser and `ExtraProviderShaping` collaborator, diagnostics fields, the global layer at load and the trusted-project layer at `session_start`, a live end-to-end check, and docs.
Tests went from 157 to 194 (+37); `check`, `lint`, and `fallow:dead-code` stayed green, and the next version is `v3.3.0`.

### Observations

- The live end-to-end check did not need a second seat after all: a second pi-multi-pass login of the same account gives `anthropic-2` its own `sk-ant-oat` token pair.
  In this repo, `-p "reply with exactly: PONG"` on `anthropic-2` returned the reporter's 400 without the config and `PONG` with it, with debug showing `systemBlockCount` 2 to 3; `anthropic` passed as the control.
  This repo's `AGENTS.md` makes the prompt large enough that a trivial `-p` prompt reproduces the failure.
- Getting there cost several rounds: the operator could not see the explanatory text placed before `ask_user` dialogs, and asked whether multi-pass needed a `settings.json` entry and `/reload` (it does not; `-ne` plus `-e` loads it for one process).
  When a manual step needs instructions, end the turn with plain text instead of following it with a dialog.
- Deviations from the plan: the status report's `config warnings:` block omits the `[pi-anthropic-auth]` prefix (only the `session_start` notifications carry it); `createSessionContext` moved from step 3 to step 8 because biome flagged it unused; step 2 gained a test pinning that the reader runs at call time.
- `ProviderConfig`'s all-optional shape made `merged as unknown as ProviderConfig` in the fake an unnecessary assertion that ESLint rejected; a plain `Record<string, unknown>` is assignable.
- Steps 5 and 8 were written implementation-alongside-test, so mutation probes stood in for the red: removing the dedup guard, accumulating warnings, adding an `oauth` key, dropping the trust check, and forcing the no-UI branch each turned a distinct test red.
- Pre-completion reviewer: PASS (one provenance note: both the reporter's measurement and the live check are n=1 per condition, and both are attributed as such).
- Cleanup left to the operator: the `anthropic-2` multi-pass subscription (`~/.pi/agent/multi-pass.json`, `auth.json` entry) should be removed with `/subs remove`; the extension config file written for the check was already deleted.
