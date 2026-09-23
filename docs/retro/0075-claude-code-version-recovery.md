---
issue: 75
issue_title: "Recover from claude_code_version_too_old instead of surfacing the raw 400"
---

# Retro: #75 — Recover from claude_code_version_too_old instead of surfacing the raw 400

## Stage: Planning (2026-09-23T00:32:03Z)

### Session summary

Measured the issue's unverified premise live (12 `pi -p` probes with the env override forcing low versions) and read the Anthropic SDK 0.124.0 `fetch` call path to answer the stream-interference question.
Wrote `docs/plans/0075-claude-code-version-recovery.md`: a 7-step plan adding a rejection parser, a learned floor, a one-shot retry inside the existing `billing-version-sync` `fetch`, and an appended hint for unrecoverable rejections.

### Observations

- Premise measured: every rejection (n=4, `claude-opus-5-5` and `claude-fable-5-1`) named the floor as `version X.Y.Z or newer is required`; the floor is inclusive (2.1.251 succeeds on fable-5-1); a rejected run is under 0.63 s of whole-process wall time; six other models accept 1.0.0.
- Operator decisions: one global learned floor, not per model and not per request (operator invited pushback; agreed, because a named floor is always a released Claude Code version that real Claude Code sends to every model); env override stays absolute; unrecoverable rejections get a hint.
  The hint was first answered as "raw 400", then reversed by the operator mid-session.
- SDK facts that shaped the design: our `fetch` sits below the SDK middleware, 400 is never SDK-retried, and `APIError.makeMessage` prints the whole JSON body, so a hint appended to `error.message` is visible to the user.
  `response.clone()` keeps the non-matching 400 path untouched; a 200 is only `status`-checked.
- The floor is owned by the `createAnthropicOAuthStreamSimple` factory closure (optional second parameter for tests), keeping module-level state out, as [#74] did.
- Live-verification catch: on pi 0.87.1, Pi's own `claude-cli/2.1.280` already meets every current floor, so the recovery path is unreachable live without temporarily patching out the send-time Pi-version read.
  The devDep `pnpm exec pi` (0.86.0, user-agent 2.1.251) does not help either, because its catalog lacks `claude-opus-5-5`.
- The [#74] plan's deferred scheduled-workflow question is dropped rather than deferred: runtime recovery covers the case it was meant to catch.
- No follow-up issues filed; the status-command idea stays held on PR #71.

[#74]: https://github.com/gotgenes/pi-anthropic-auth/issues/74
