import assert from "node:assert/strict";
import { type Context, Type } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import { test } from "vitest";

import { shapeAnthropicOAuthPayload } from "#src/request-shaping";

const TEST_MODEL = "claude-haiku-4-5";
const USER_TEXT = "Check my home directory for PDFs.";

/**
 * Builds an Anthropic messages payload with one assistant turn under test.
 *
 * Every shaping assertion in this file differs only in that turn's content
 * blocks (and, sometimes, a trailing tool_result message), so the surrounding
 * envelope lives here rather than being restated per test.  This mirrors
 * `createOAuthPayload` in `test/request-shaping.test.ts`.
 */
function createShapingPayload(
  assistantContent: unknown[],
  trailingMessages: unknown[] = [],
) {
  return {
    model: TEST_MODEL,
    stream: true,
    messages: [
      { role: "user", content: [{ type: "text", text: USER_TEXT }] },
      { role: "assistant", content: assistantContent },
      ...trailingMessages,
    ],
    system: [
      {
        type: "text",
        text: "You are Claude Code, Anthropic's official CLI for Claude.",
      },
      {
        type: "text",
        text: "Follow the user's instructions.",
      },
    ],
  };
}

/**
 * Shapes a payload and reports the block types of each assistant message it
 * emits, as one array per assistant message.
 *
 * Returning the nested shape lets a test pin both how many assistant messages
 * shaping produced and what each one carries in a single assertion.
 */
function shapedAssistantBlockTypes(
  assistantContent: unknown[],
  trailingMessages: unknown[] = [],
): string[][] {
  const shaped = shapeAnthropicOAuthPayload(
    createShapingPayload(assistantContent, trailingMessages),
  ) as { messages: Array<{ role: string; content: Array<{ type: string }> }> };

  return shaped.messages
    .filter((message) => message.role === "assistant")
    .map((message) => message.content.map((block) => block.type));
}

function createMockSseResponse(): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          [
            "event: message_start",
            'data: {"type":"message_start","message":{"id":"msg_test","type":"message","role":"assistant","content":[],"model":"claude-haiku-4-5","stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":1}}}',
            "",
            "event: message_delta",
            'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}',
            "",
            "event: message_stop",
            'data: {"type":"message_stop"}',
            "",
          ].join("\n"),
        ),
      );
      controller.close();
    },
  });

  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

test("experiment: Pi serializer preserves trailing assistant text after tool_use blocks", async () => {
  const model = getBuiltinModel("anthropic", TEST_MODEL);

  const context: Context = {
    systemPrompt: "Follow the user's instructions.",
    messages: [
      {
        role: "user",
        content: "Check my home directory for PDFs.",
        timestamp: Date.now(),
      },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "toolu_1",
            name: "read",
            arguments: { filePath: "/root" },
          },
          {
            type: "toolCall",
            id: "toolu_2",
            name: "glob",
            arguments: { pattern: "**/*.pdf" },
          },
          {
            type: "text",
            text: "I checked your home directory and looked for PDF files.",
          },
        ],
        api: "anthropic-messages",
        provider: "anthropic",
        model: TEST_MODEL,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: Date.now(),
      },
      {
        role: "toolResult",
        toolCallId: "toolu_1",
        toolName: "read",
        content: [{ type: "text", text: "ok" }],
        isError: false,
        timestamp: Date.now(),
      },
      {
        role: "toolResult",
        toolCallId: "toolu_2",
        toolName: "glob",
        content: [{ type: "text", text: "No files found" }],
        isError: false,
        timestamp: Date.now(),
      },
    ],
    tools: [
      {
        name: "read",
        description: "Read a file",
        parameters: Type.Object({
          filePath: Type.String(),
        }),
      },
      {
        name: "glob",
        description: "Find files by glob",
        parameters: Type.Object({
          pattern: Type.String(),
        }),
      },
    ],
  };

  let capturedPayload: unknown;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => createMockSseResponse();

  try {
    const s = streamSimple(model, context, {
      apiKey: "sk-ant-oat01-test-token",
      onPayload(payload) {
        capturedPayload = payload;
        return payload;
      },
    });

    await s.result();
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(capturedPayload);
  const payload = capturedPayload as {
    messages: Array<{
      role: string;
      content: Array<{ type: string; text?: string }>;
    }>;
  };

  const assistantMessage = payload.messages.find(
    (message) => message.role === "assistant",
  );

  assert.ok(assistantMessage);
  assert.deepEqual(
    assistantMessage.content.map((block) => block.type),
    ["tool_use", "tool_use", "text"],
  );
});

test("experiment: current hook reshaping splits assistant tool_use blocks from trailing text", () => {
  const blockTypes = shapedAssistantBlockTypes(
    [
      {
        type: "tool_use",
        id: "toolu_1",
        name: "Read",
        input: { filePath: "/root" },
      },
      {
        type: "tool_use",
        id: "toolu_2",
        name: "Glob",
        input: { pattern: "**/*.pdf" },
      },
      {
        type: "text",
        text: "I checked your home directory and looked for PDF files.",
      },
    ],
    [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_1",
            content: "ok",
            is_error: false,
          },
          {
            type: "tool_result",
            tool_use_id: "toolu_2",
            content: "No files found",
            is_error: false,
          },
        ],
      },
    ],
  );

  assert.deepEqual(blockTypes, [["text"], ["tool_use", "tool_use"]]);
});

test("experiment: current hook reshaping leaves already-valid assistant ordering unchanged", () => {
  const blockTypes = shapedAssistantBlockTypes([
    {
      type: "text",
      text: "I checked your home directory and looked for PDF files.",
    },
    {
      type: "tool_use",
      id: "toolu_1",
      name: "Read",
      input: { filePath: "/root" },
    },
    {
      type: "tool_use",
      id: "toolu_2",
      name: "Glob",
      input: { pattern: "**/*.pdf" },
    },
  ]);

  assert.deepEqual(blockTypes, [["text", "tool_use", "tool_use"]]);
});
