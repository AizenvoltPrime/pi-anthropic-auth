import assert from "node:assert/strict";
import {
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { beforeEach, describe, test } from "vitest";
import {
  ExtraProviderShaping,
  type ProviderRegistrar,
} from "#src/extra-provider-shaping";
import type { AnthropicStreamSimple } from "#src/oauth-transport";

const streamSimple: AnthropicStreamSimple = (): AssistantMessageEventStream =>
  createAssistantMessageEventStream();

type Registration = Parameters<ProviderRegistrar["registerProvider"]>;

describe("ExtraProviderShaping", () => {
  let registrations: Registration[];
  let shaping: ExtraProviderShaping;

  beforeEach(() => {
    registrations = [];
    shaping = new ExtraProviderShaping(
      { registerProvider: (...args) => registrations.push(args) },
      streamSimple,
    );
  });

  describe("registration", () => {
    test("registers each named provider with the shared wrapper and nothing else", () => {
      shaping.apply(
        { providers: ["anthropic-2", "anthropic-3"], warnings: [] },
        "global",
      );

      // Only `api` and `streamSimple`: pi merges defined keys, so any other
      // key would overwrite the owning extension's registration.
      assert.deepEqual(registrations, [
        ["anthropic-2", { api: "anthropic-messages", streamSimple }],
        ["anthropic-3", { api: "anthropic-messages", streamSimple }],
      ]);
    });

    test("registers a provider only once across layers", () => {
      shaping.apply({ providers: ["anthropic-2"], warnings: [] }, "global");
      shaping.apply(
        { providers: ["anthropic-2", "anthropic-3"], warnings: [] },
        "project",
      );
      shaping.apply({ providers: ["anthropic-3"], warnings: [] }, "project");

      assert.deepEqual(
        registrations.map(([name]) => name),
        ["anthropic-2", "anthropic-3"],
      );
    });
  });

  describe("shaped providers", () => {
    test("reports nothing before any config is applied", () => {
      assert.deepEqual(shaping.shapedProviders(), []);
    });

    test("reports each provider with the first layer that named it, in registration order", () => {
      shaping.apply({ providers: ["anthropic-2"], warnings: [] }, "global");
      shaping.apply(
        { providers: ["anthropic-3", "anthropic-2"], warnings: [] },
        "project",
      );

      assert.deepEqual(shaping.shapedProviders(), [
        { name: "anthropic-2", layer: "global" },
        { name: "anthropic-3", layer: "project" },
      ]);
    });
  });

  describe("warnings", () => {
    test("reports global warnings before project warnings", () => {
      shaping.apply(
        { providers: [], warnings: ["project problem"] },
        "project",
      );
      shaping.apply({ providers: [], warnings: ["global problem"] }, "global");

      assert.deepEqual(shaping.warnings(), [
        "global problem",
        "project problem",
      ]);
    });

    // The project file is re-read on every session_start; its warnings must
    // describe the latest read, not accumulate.
    test("replaces a layer's warnings when that layer is applied again", () => {
      shaping.apply({ providers: [], warnings: ["global problem"] }, "global");
      shaping.apply({ providers: [], warnings: ["stale"] }, "project");
      shaping.apply({ providers: [], warnings: [] }, "project");

      assert.deepEqual(shaping.warnings(), ["global problem"]);
    });
  });
});
