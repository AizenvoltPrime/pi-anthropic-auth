import assert from "node:assert/strict";
import { normalizeContext } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/compat";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import { test } from "vitest";

import {
  CLAUDE_CODE_VERSION,
  higherVersion,
  readClaudeCliVersion,
} from "#src/claude-code-version";

// This suite drives the installed Pi's own Anthropic transport, the way
// `test/upstream-prompt-drift.test.ts` drives its `buildSystemPrompt`.
// Depending on the internal *is* what it verifies; it is not a precedent for
// other suites.
//
// Nothing offline caught Issue #74: `tsc` passed and the whole suite passed
// while `claude-opus-5-5` was entirely blocked by a stale pin.  The checks
// below close that gap without a network call.

const OAUTH_TOKEN_STUB = "sk-ant-oat01-stub-token-for-drift-check";

/**
 * Captures the headers Pi's built-in Anthropic transport would send.
 *
 * The request is aborted inside the injected `fetch`, so nothing leaves the
 * process.  The thrown error surfaces through the stream and is swallowed.
 */
async function captureOutboundHeaders(): Promise<{
  headers: Record<string, string> | undefined;
  fetchWasCalled: boolean;
}> {
  let headers: Record<string, string> | undefined;
  let fetchWasCalled = false;

  const capturingFetch = ((_input: unknown, init?: RequestInit) => {
    fetchWasCalled = true;
    headers = Object.fromEntries(new Headers(init?.headers).entries());
    return Promise.reject(new Error("drift check: aborted before network"));
  }) as typeof fetch;

  const stream = anthropicMessagesApi().streamSimple(
    getBuiltinModel("anthropic", "claude-haiku-4-5"),
    normalizeContext({
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "ping" }],
          timestamp: Date.now(),
        },
      ],
    }),
    { apiKey: OAUTH_TOKEN_STUB, fetch: capturingFetch, maxRetries: 0 },
  );

  try {
    await stream.result();
  } catch {
    // Expected: the capturing fetch rejects instead of reaching the network.
  }

  return { headers, fetchWasCalled };
}

// `src/billing-version-sync.ts` reconciles our pin with Pi's reported version
// by injecting `options.fetch`.  If Pi ever stops forwarding it, the upgrade
// silently stops happening and every request quietly falls back to the pin --
// a regression no other test could see.
test("Pi's built-in Anthropic transport forwards options.fetch", async () => {
  const { fetchWasCalled } = await captureOutboundHeaders();

  assert.equal(fetchWasCalled, true);
});

test("Pi sends a parseable claude-cli user-agent on OAuth requests", async () => {
  const { headers } = await captureOutboundHeaders();
  const userAgent = headers?.["user-agent"];

  assert.match(String(userAgent), /^claude-cli\/\d+\.\d+\.\d+$/);
  assert.ok(
    readClaudeCliVersion(userAgent),
    `readClaudeCliVersion did not parse ${JSON.stringify(userAgent)}`,
  );
});

// Pi tracks Claude Code releases closely (0.87.1 moved its own pin to
// 2.1.280), so Pi moving above us is the earliest offline signal that
// Anthropic's floor has risen.  Requests still succeed when this fails --
// the wire-level upgrade covers it -- but users on an older Pi are left
// behind, so the pin should be raised.
test("our Claude Code pin is not below the installed Pi's", async () => {
  const { headers } = await captureOutboundHeaders();
  const piVersion = readClaudeCliVersion(headers?.["user-agent"]);

  assert.equal(
    higherVersion(CLAUDE_CODE_VERSION, piVersion),
    CLAUDE_CODE_VERSION,
    `CLAUDE_CODE_VERSION ${CLAUDE_CODE_VERSION} is below the installed Pi's ${piVersion}. ` +
      "Confirm the current release with `npm view @anthropic-ai/claude-code dist-tags` and raise the pin.",
  );
});
