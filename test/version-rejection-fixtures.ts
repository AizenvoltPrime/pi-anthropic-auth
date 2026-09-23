/** The `request-id` every fixture rejection carries, in body and header. */
export const REJECTION_REQUEST_ID = "req_test_rejection";

/**
 * Builds a `claude_code_version_too_old` 400 shaped like the one Anthropic
 * returned on 2026-09-23.
 *
 * With `requiredVersion` undefined the message names no floor, which is how
 * an Anthropic wording change would look to the parser.
 */
export function claudeCodeVersionTooOldResponse(
  requiredVersion: string | undefined,
  rejectedVersion = "2.1.260",
): Response {
  const message = requiredVersion
    ? `Claude Code ${rejectedVersion} does not support this model; version ${requiredVersion} or newer is required. Run 'claude update', or update the Claude desktop app, then try again.`
    : `Claude Code ${rejectedVersion} does not support this model.`;

  return new Response(
    JSON.stringify({
      type: "error",
      error: {
        type: "invalid_request_error",
        message,
        details: { error_code: "claude_code_version_too_old" },
      },
      request_id: REJECTION_REQUEST_ID,
    }),
    {
      status: 400,
      headers: {
        "content-type": "application/json",
        "content-length": "999",
        "request-id": REJECTION_REQUEST_ID,
      },
    },
  );
}

/** A streaming-shaped success response whose body a test can check is unread. */
export function okResponse(): Response {
  return new Response("event: message_start\n\n", {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}
