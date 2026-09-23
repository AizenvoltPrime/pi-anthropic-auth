import type { FetchFunction } from "@earendil-works/pi-ai";
import type { MessageParam } from "./anthropic-message";
import { buildBillingHeaderValue, getFirstUserText } from "./billing-header";
import {
  hasClaudeCodeVersionOverride,
  higherVersion,
  type LearnedClaudeCodeFloor,
  readClaudeCliVersion,
  resolveClaudeCodeVersion,
} from "./claude-code-version";
import { debugLog } from "./debug";
import {
  type ClaudeCodeVersionRejection,
  readClaudeCodeVersionRejection,
} from "./version-rejection";

/**
 * Per-request reconciliation of our `cc_version` with Pi's reported one.
 *
 * Two independent Claude Code version signals reach Anthropic on an OAuth
 * request: Pi's `user-agent: claude-cli/<version>`, and the `cc_version` in
 * the billing header this extension injects.  Anthropic gates new models on
 * the billing header when it is present, so a stale pin blocks a model even
 * when the host Pi is new enough.
 *
 * The bundled pin is a *floor*: when Pi reports a higher version, the
 * billing header is rebuilt at Pi's version on the way out.  When Pi is at or
 * below the pin — pi-ai 0.86.0 and pi 0.87.0 both report 2.1.251 — the
 * request is sent exactly as shaping produced it.
 *
 * When Anthropic raises a model's floor above both Pi and the pin, it rejects
 * the request as `claude_code_version_too_old` and names the floor (Issue
 * #75).  The sync then retries once with the billing header at that floor,
 * and teaches it to the shared {@link LearnedClaudeCodeFloor} so later
 * requests go out at it directly.  Only a 400 is ever read, and only through
 * a clone, so the streaming success path is untouched.
 */
export interface BillingVersionSync {
  /**
   * Records the payload whose billing header may need rebuilding.
   *
   * Called from the transport's `onPayload`, which runs before `fetch` on the
   * same request, so the two share this object's closure.
   */
  recordRequest(payload: unknown): void;

  /**
   * Drop-in `fetch` that raises `cc_version` to Pi's reported version and
   * recovers from a `claude_code_version_too_old` rejection.
   *
   * Pi's version is only observable here: the `user-agent` header is added by
   * pi-ai's own `createClient`, downstream of every other seam this extension
   * can reach.
   */
  fetch: FetchFunction;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Reads a response as a `claude_code_version_too_old` rejection.
 *
 * Only a 400 is inspected, and only through a clone, so a streaming success
 * response and any other error reach the SDK exactly as received.
 */
async function readVersionRejection(
  response: Response,
): Promise<ClaudeCodeVersionRejection | undefined> {
  if (response.status !== 400) return undefined;
  return readClaudeCodeVersionRejection(await response.clone().text());
}

/** Reads the `user-agent` header off whichever argument carries it. */
function readUserAgent(
  input: Parameters<FetchFunction>[0],
  init: RequestInit | undefined,
): string | undefined {
  const source =
    init?.headers ?? (input instanceof Request ? input.headers : undefined);
  return source
    ? (new Headers(source).get("user-agent") ?? undefined)
    : undefined;
}

export function createBillingVersionSync(
  learnedFloor: LearnedClaudeCodeFloor,
  baseFetch?: FetchFunction,
): BillingVersionSync {
  let firstUserText = "";

  /**
   * Returns `body` with its billing header moved from `fromVersion` to
   * `toVersion`, or `undefined` when the body cannot be rebuilt.
   *
   * Every bail-out is deliberate: we never construct a body we cannot verify
   * against the exact header string shaping emitted moments earlier.
   */
  function rebuildBody(
    body: BodyInit | null | undefined,
    fromVersion: string,
    toVersion: string,
  ): string | undefined {
    if (!firstUserText || typeof body !== "string") return undefined;

    const fromHeader = buildBillingHeaderValue(firstUserText, fromVersion);
    const toHeader = buildBillingHeaderValue(firstUserText, toVersion);
    if (!fromHeader || !toHeader || !body.includes(fromHeader)) {
      return undefined;
    }

    return body.replace(fromHeader, toHeader);
  }

  /**
   * The version this request's billing header should carry: the pin raised
   * to Pi's reported version and to any learned floor.  An explicit user pin
   * is absolute and is never raised.
   */
  function targetVersion(userAgent: string | undefined): string {
    const pinned = resolveClaudeCodeVersion();
    if (hasClaudeCodeVersionOverride()) return pinned;
    return learnedFloor.applyTo(
      higherVersion(pinned, readClaudeCliVersion(userAgent)),
    );
  }

  const syncFetch = (async (input, init) => {
    const dispatch = baseFetch ?? globalThis.fetch;
    const pinned = resolveClaudeCodeVersion();
    const target = targetVersion(readUserAgent(input, init));
    const upgraded =
      target === pinned ? undefined : rebuildBody(init?.body, pinned, target);
    const sentInit =
      upgraded === undefined ? init : { ...init, body: upgraded };
    // When the upgrade could not be verified, the body still carries the pin.
    const sentVersion = upgraded === undefined ? pinned : target;

    const response = await dispatch(input, sentInit);
    const rejection = await readVersionRejection(response);
    if (!rejection) return response;

    const retryBody = recoveryBody(rejection, sentInit?.body, sentVersion);
    if (retryBody === undefined) return response;

    debugLog("claude-code-version-recovery", {
      sentVersion,
      requiredVersion: rejection.requiredVersion,
    });
    await response.body?.cancel();
    return dispatch(input, { ...sentInit, body: retryBody });
  }) as FetchFunction;

  /**
   * Returns the body to retry a rejected request with, or `undefined` when
   * recovery cannot help.
   *
   * A floor Anthropic names is learned even when this request cannot be
   * retried, so the next request goes out at it.  An explicit user pin is
   * absolute, so it is neither retried nor taught to the floor.
   */
  function recoveryBody(
    rejection: ClaudeCodeVersionRejection,
    sentBody: BodyInit | null | undefined,
    sentVersion: string,
  ): string | undefined {
    const required = rejection.requiredVersion;
    if (!required || hasClaudeCodeVersionOverride()) return undefined;

    learnedFloor.learn(required);
    if (higherVersion(sentVersion, required) === sentVersion) return undefined;

    return rebuildBody(sentBody, sentVersion, required);
  }

  return {
    recordRequest(payload) {
      firstUserText =
        isRecord(payload) && Array.isArray(payload.messages)
          ? getFirstUserText(payload.messages as MessageParam[])
          : "";
    },
    fetch: syncFetch,
  };
}
