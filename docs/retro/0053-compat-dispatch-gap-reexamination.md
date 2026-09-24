---
issue: 53
issue_title: "Re-examine the compat-dispatch gap now that pi 0.81.0 exposes ModelRegistry.getProvider"
---

# Retro: #53 — Re-examine the compat-dispatch gap now that pi 0.81.0 exposes ModelRegistry.getProvider

## Stage: Planning (2026-09-24T06:16:33Z)

### Session summary

Answered the issue's four questions and the comment's two against pi v0.86.0 and v0.87.1, swept every release through 0.87.1 and unreleased `main` for better APIs at the operator's prompt, and measured the supported path live.
The plan is docs-only (`/build-plan`): record the findings, replace the `agent.streamFunction` workaround with `ctx.modelRegistry.streamSimple()`, narrow the documented residual to explicit `compat.streamSimple` callers and the untyped `setDefaultStreamFn` fallback, and close the issue at ship time.

### Observations

- The direction changed twice.
  The first `ask_user` offered a provider-aware `setDefaultStreamFn` override (found in the release sweep), and the operator picked it.
  A spike then showed `getDefaultStreamFn` is not exported and `streamFn` has been required in the pi-agent-core types since 0.81.0.
  Checking the published `pi-observational-memory@3.1.4` also showed it already routes through `modelRegistry.streamSimple`.
  Re-asking on that evidence moved the operator to docs-only.
  Lesson: check the seam's *export surface* and a real consumer before building an option set around a mechanism read from source.
- The operator's nudge ("Pi has had quite a number of releases") was load-bearing: the issue's four questions alone would have steered toward the api-registry override, which is now constructible but still inexact.
- Live probe (pi 0.87.1, haiku-4-5, `PI_ANTHROPIC_AUTH_DEBUG=all`): `ctx.modelRegistry.streamSimple` produced a `before-provider-request` shaping line and explicit `compat.streamSimple` did not.
  The synthetic payload (`AGENTS.md` as the system prompt) returned 200 even unshaped, so the status code did not discriminate; the debug line is the evidence.
  My first `rg` filter used `^` anchors that matched nothing and briefly read as a failed run; check raw output before interpreting an empty filter.
- The issue's cost section (raise the floor to 0.81.0, major bump) is moot: the floor is already `>=0.86.0`.
- No follow-up issue filed: the operator declined the "docs now, default fn as follow-up" option.
- Tidy-First assessment skipped: `src/` edits are comments only.
