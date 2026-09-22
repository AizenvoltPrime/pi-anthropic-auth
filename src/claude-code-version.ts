// ---------------------------------------------------------------------------
// Claude Code version
//
// Anthropic gates newly released models on a minimum Claude Code version and
// rejects OAuth requests below it with `error_code: claude_code_version_too_old`.
// The version this extension reports in its billing header is what Anthropic
// keys on, so this module decides whether a new model works at all.
//
// There is no upstream source to import the pin from -- pi-ai's own
// `claudeCodeVersion` is module-private.  Check the current release with
// `npm view @anthropic-ai/claude-code version`, and confirm it even when a
// value is handed to you.  Do not read it from a local `claude --version`:
// the `stable` dist-tag lags `latest` (2.1.267 vs 2.1.280 on 2026-09-22), so
// a local install is frequently *below* the floor Anthropic requires for new
// models.
// ---------------------------------------------------------------------------

/**
 * Claude Code version string embedded in the billing header.
 *
 * **Must be kept in sync with the current Claude Code release.**
 * Update this value when a new Claude Code version ships.  If it drifts
 * too far from what Anthropic expects, OAuth requests may be rejected or
 * counted incorrectly.
 */
export const CLAUDE_CODE_VERSION = "2.1.260";

/**
 * Environment variable that overrides {@link CLAUDE_CODE_VERSION}.
 *
 * Anthropic gates new models on a minimum Claude Code version (for example,
 * `claude-opus-5-5` requires >= 2.1.280).  When Anthropic raises that floor
 * faster than this package publishes a release, this override unblocks users
 * without editing `claude-code-version.ts` inside `node_modules`.
 */
export const CLAUDE_CODE_VERSION_ENV = "PI_ANTHROPIC_AUTH_CLAUDE_CODE_VERSION";

const CLAUDE_CODE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * Resolves the Claude Code version used in the billing header.
 *
 * Returns {@link CLAUDE_CODE_VERSION} unless {@link CLAUDE_CODE_VERSION_ENV} is
 * set to a non-empty value.  The override must be a bare `X.Y.Z` version: it is
 * embedded in a salted hash suffix, so a value Claude Code would never emit
 * produces a billing header that does not match any real client.  A malformed
 * value throws rather than falling back, so a typo surfaces loudly instead of
 * silently sending the bundled version the user was trying to replace.
 */
export function resolveClaudeCodeVersion(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const configuredVersion = environment[CLAUDE_CODE_VERSION_ENV]?.trim();
  if (!configuredVersion) {
    return CLAUDE_CODE_VERSION;
  }
  if (!CLAUDE_CODE_VERSION_PATTERN.test(configuredVersion)) {
    throw new Error(
      `${CLAUDE_CODE_VERSION_ENV} must be a bare X.Y.Z version, received ${JSON.stringify(configuredVersion)}`,
    );
  }
  return configuredVersion;
}
