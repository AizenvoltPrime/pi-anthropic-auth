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
