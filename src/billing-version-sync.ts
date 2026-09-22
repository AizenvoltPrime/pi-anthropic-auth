import type { FetchFunction } from "@earendil-works/pi-ai";
import type { MessageParam } from "./anthropic-message";
import { buildBillingHeaderValue, getFirstUserText } from "./billing-header";
import {
  hasClaudeCodeVersionOverride,
  higherVersion,
  readClaudeCliVersion,
  resolveClaudeCodeVersion,
} from "./claude-code-version";

/**
 * Per-request reconciliation of our `cc_version` with Pi's reported one.
 *
 * Two independent Claude Code version signals reach Anthropic on an OAuth
 * request: Pi's `user-agent: claude-cli/<version>`, and the `cc_version` in
 * the billing header this extension injects.  Anthropic gates new models on
 * the billing header when it is present, so a stale pin blocks a model even
 * when the host Pi is new enough.
 *
 * This collaborator closes that gap without a network call, a cache, or a
 * startup probe.  The bundled pin is a *floor*: when Pi reports a higher
 * version, the billing header is rebuilt at Pi's version on the way out.
 * When Pi is at or below the pin — pi-ai 0.86.0 and pi 0.87.0 both report
 * 2.1.251 — the request is sent exactly as shaping produced it.
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
   * Drop-in `fetch` that raises `cc_version` to Pi's reported version.
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
  baseFetch?: FetchFunction,
): BillingVersionSync {
  let firstUserText = "";

  /**
   * Returns the body to send when the billing header needs raising, or
   * `undefined` to send the original untouched.
   *
   * Every bail-out is deliberate: we never construct a body we cannot verify
   * against the exact header string shaping emitted moments earlier.
   */
  function upgradedBody(
    userAgent: string | undefined,
    body: BodyInit | null | undefined,
  ): string | undefined {
    // An explicit user pin is absolute and is never raised.
    if (!firstUserText || typeof body !== "string") return undefined;
    if (hasClaudeCodeVersionOverride()) return undefined;

    const current = resolveClaudeCodeVersion();
    const target = higherVersion(current, readClaudeCliVersion(userAgent));
    if (target === current) return undefined;

    const currentHeader = buildBillingHeaderValue(firstUserText, current);
    const targetHeader = buildBillingHeaderValue(firstUserText, target);
    if (!currentHeader || !targetHeader || !body.includes(currentHeader)) {
      return undefined;
    }

    return body.replace(currentHeader, targetHeader);
  }

  const syncFetch = ((input, init) => {
    const dispatch = baseFetch ?? globalThis.fetch;
    const body = upgradedBody(readUserAgent(input, init), init?.body);
    return dispatch(input, body === undefined ? init : { ...init, body });
  }) as FetchFunction;

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
