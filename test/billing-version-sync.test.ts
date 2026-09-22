import assert from "node:assert/strict";
import type { FetchFunction } from "@earendil-works/pi-ai";
import { describe, test } from "vitest";
import { createBillingVersionSync } from "#src/billing-version-sync";
import { CLAUDE_CODE_VERSION } from "#src/claude-code-version";
import {
  buildExpectedBillingHeader,
  withVersionOverride,
} from "#test/billing-header-fixtures";

const USER_TEXT = "Summarize the repository status.";
const PI_AHEAD = "2.9.9";
const PI_BEHIND = "1.0.0";

const RESPONSE_STUB = { __stub: true } as unknown as Response;

type CapturingFetch = {
  fetch: FetchFunction;
  calls: Array<{ input: unknown; init: RequestInit | undefined }>;
};

function createCapturingFetch(): CapturingFetch {
  const calls: CapturingFetch["calls"] = [];
  const fetch = ((input: unknown, init?: RequestInit) => {
    calls.push({ input, init });
    return Promise.resolve(RESPONSE_STUB);
  }) as unknown as FetchFunction;
  return { fetch, calls };
}

/**
 * Builds the payload our shaping produces, with the billing header already
 * prepended at `version`.
 */
function shapedPayload(version: string = CLAUDE_CODE_VERSION) {
  return {
    model: "claude-haiku-4-5",
    stream: true,
    system: [
      { type: "text", text: buildExpectedBillingHeader(USER_TEXT, version) },
      { type: "text", text: "You are an expert coding assistant." },
    ],
    messages: [{ role: "user", content: [{ type: "text", text: USER_TEXT }] }],
  };
}

function requestInit(
  userAgent: string | undefined,
  body: BodyInit | undefined = JSON.stringify(shapedPayload()),
): RequestInit {
  return {
    method: "POST",
    headers: userAgent
      ? { "content-type": "application/json", "user-agent": userAgent }
      : { "content-type": "application/json" },
    body,
  };
}

/** Returns the single string body the capturing fetch received. */
function sentBody(base: CapturingFetch): string {
  assert.equal(base.calls.length, 1);
  const body = base.calls[0].init?.body;
  assert.ok(typeof body === "string");
  return body;
}

/** Runs one request through the sync and returns the body the delegate saw. */
async function dispatch(
  init: RequestInit,
  { record = true }: { record?: boolean } = {},
): Promise<string> {
  const base = createCapturingFetch();
  const sync = createBillingVersionSync(base.fetch);
  if (record) {
    sync.recordRequest(shapedPayload());
  }
  await sync.fetch("https://api.anthropic.com/v1/messages", init);

  return sentBody(base);
}

describe("createBillingVersionSync", () => {
  test("leaves the body untouched when Pi reports no claude-cli version", async () => {
    const original = JSON.stringify(shapedPayload());
    assert.equal(await dispatch(requestInit(undefined, original)), original);
  });

  test("leaves the body untouched when Pi's version is lower", async () => {
    const original = JSON.stringify(shapedPayload());
    assert.equal(
      await dispatch(requestInit(`claude-cli/${PI_BEHIND}`, original)),
      original,
    );
  });

  test("leaves the body untouched when Pi's version matches the pin", async () => {
    const original = JSON.stringify(shapedPayload());
    assert.equal(
      await dispatch(
        requestInit(`claude-cli/${CLAUDE_CODE_VERSION}`, original),
      ),
      original,
    );
  });

  test("rewrites cc_version and its suffix when Pi's version is higher", async () => {
    const sent = await dispatch(requestInit(`claude-cli/${PI_AHEAD}`));

    assert.equal(sent, JSON.stringify(shapedPayload(PI_AHEAD)));
    assert.ok(sent.includes(buildExpectedBillingHeader(USER_TEXT, PI_AHEAD)));
    assert.ok(
      !sent.includes(
        buildExpectedBillingHeader(USER_TEXT, CLAUDE_CODE_VERSION),
      ),
    );
  });

  test("changes nothing outside the billing header block", async () => {
    const original = JSON.stringify(shapedPayload());
    const sent = await dispatch(
      requestInit(`claude-cli/${PI_AHEAD}`, original),
    );

    const excise = (body: string) =>
      body.replace(/x-anthropic-billing-header:[^"]*/, "<billing>");

    assert.equal(excise(sent), excise(original));
    assert.notEqual(sent, original);
  });

  test("honors an explicit version override instead of raising it", async () => {
    withVersionOverride("2.1.300");

    const base = createCapturingFetch();
    const sync = createBillingVersionSync(base.fetch);
    sync.recordRequest(shapedPayload());
    const original = JSON.stringify(shapedPayload("2.1.300"));
    await sync.fetch(
      "https://api.anthropic.com/v1/messages",
      requestInit(`claude-cli/${PI_AHEAD}`, original),
    );

    assert.equal(sentBody(base), original);
  });

  test("leaves a non-string body untouched", async () => {
    const base = createCapturingFetch();
    const sync = createBillingVersionSync(base.fetch);
    sync.recordRequest(shapedPayload());
    const body = new Uint8Array([1, 2, 3]);
    await sync.fetch(
      "https://api.anthropic.com/v1/messages",
      requestInit(`claude-cli/${PI_AHEAD}`, body),
    );

    assert.equal(base.calls[0].init?.body, body);
  });

  test("leaves the body untouched when no request was recorded", async () => {
    const original = JSON.stringify(shapedPayload());
    assert.equal(
      await dispatch(requestInit(`claude-cli/${PI_AHEAD}`, original), {
        record: false,
      }),
      original,
    );
  });

  test("leaves the body untouched when it carries no billing header", async () => {
    const original = JSON.stringify({
      model: "claude-haiku-4-5",
      stream: true,
    });
    assert.equal(
      await dispatch(requestInit(`claude-cli/${PI_AHEAD}`, original)),
      original,
    );
  });

  test("forwards the request URL and other init fields to the base fetch", async () => {
    const base = createCapturingFetch();
    const sync = createBillingVersionSync(base.fetch);
    sync.recordRequest(shapedPayload());
    await sync.fetch(
      "https://api.anthropic.com/v1/messages",
      requestInit(`claude-cli/${PI_AHEAD}`),
    );

    const call = base.calls[0];
    assert.equal(call.input, "https://api.anthropic.com/v1/messages");
    assert.equal(call.init?.method, "POST");
  });

  test("returns the base fetch's response", async () => {
    const base = createCapturingFetch();
    const sync = createBillingVersionSync(base.fetch);
    sync.recordRequest(shapedPayload());
    const response = await sync.fetch(
      "https://api.anthropic.com/v1/messages",
      requestInit(`claude-cli/${PI_AHEAD}`),
    );

    assert.equal(response, RESPONSE_STUB);
  });
});
