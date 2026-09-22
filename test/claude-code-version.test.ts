import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { higherVersion, readClaudeCliVersion } from "#src/claude-code-version";

describe("readClaudeCliVersion", () => {
  test("reads the version out of Pi's claude-cli user-agent", () => {
    assert.equal(readClaudeCliVersion("claude-cli/2.1.280"), "2.1.280");
  });

  test("ignores surrounding user-agent tokens", () => {
    assert.equal(
      readClaudeCliVersion("Mozilla/5.0 claude-cli/2.1.251 extra/1.0"),
      "2.1.251",
    );
  });

  test("returns undefined when no user-agent is present", () => {
    assert.equal(readClaudeCliVersion(undefined), undefined);
    assert.equal(readClaudeCliVersion(null), undefined);
    assert.equal(readClaudeCliVersion(""), undefined);
  });

  test("returns undefined for a non-claude-cli user-agent", () => {
    assert.equal(readClaudeCliVersion("pi/0.87.1"), undefined);
    assert.equal(readClaudeCliVersion("2.1.280"), undefined);
  });

  test("returns undefined for a malformed claude-cli version", () => {
    assert.equal(readClaudeCliVersion("claude-cli/2.1"), undefined);
    assert.equal(readClaudeCliVersion("claude-cli/next"), undefined);
    assert.equal(readClaudeCliVersion("claude-cli/"), undefined);
  });

  test("does not match a user-agent that merely contains the token", () => {
    assert.equal(readClaudeCliVersion("notclaude-cli/2.1.280"), undefined);
  });
});

describe("higherVersion", () => {
  test("returns the candidate when it is higher", () => {
    assert.equal(higherVersion("2.1.260", "2.1.280"), "2.1.280");
    assert.equal(higherVersion("2.1.280", "2.2.0"), "2.2.0");
    assert.equal(higherVersion("2.1.280", "3.0.0"), "3.0.0");
  });

  test("returns the baseline when the candidate is lower", () => {
    assert.equal(higherVersion("2.1.280", "2.1.251"), "2.1.280");
    assert.equal(higherVersion("2.1.280", "2.0.999"), "2.1.280");
    assert.equal(higherVersion("2.1.280", "1.9.9"), "2.1.280");
  });

  test("returns the baseline when the versions are equal", () => {
    assert.equal(higherVersion("2.1.280", "2.1.280"), "2.1.280");
  });

  test("compares components numerically, not lexically", () => {
    // "2.1.9" sorts after "2.1.280" as a string but is a lower version.
    assert.equal(higherVersion("2.1.280", "2.1.9"), "2.1.280");
    assert.equal(higherVersion("2.1.9", "2.1.280"), "2.1.280");
  });

  test("returns the baseline for an absent or unparseable candidate", () => {
    assert.equal(higherVersion("2.1.280", undefined), "2.1.280");
    assert.equal(higherVersion("2.1.280", ""), "2.1.280");
    assert.equal(higherVersion("2.1.280", "2.1"), "2.1.280");
    assert.equal(higherVersion("2.1.280", "latest"), "2.1.280");
    assert.equal(higherVersion("2.1.280", "v2.1.999"), "2.1.280");
  });
});
