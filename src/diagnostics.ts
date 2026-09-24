import type { ShapedProvider } from "./extra-provider-shaping";

/**
 * Diagnostic information surfaced via the `/anthropic-auth:status` command.
 */
export interface ExtensionDiagnostics {
  /** Published version read from `package.json` at load time. */
  version: string;
  /** Absolute filesystem path of the loaded `src/index.ts` entry module. */
  modulePath: string;
  /**
   * Whether the built-in Anthropic `streamSimple` transport resolved
   * successfully.  Always `true` when the command is reachable: a resolution
   * failure aborts extension load before `registerCommand` runs.
   */
  transportResolved: boolean;
  /**
   * Extra providers the config files named, each registered with the shaping
   * wrapper.  `anthropic` is always shaped and is not listed here.
   */
  shapedProviders: readonly ShapedProvider[];
  /** Problems found reading the config files, one line each. */
  configWarnings: readonly string[];
}

/**
 * Narrow subset of `ExtensionCommandContext` the status handler actually uses.
 *
 * Accepting this interface instead of the full `ExtensionCommandContext` keeps
 * `createStatusCommandHandler` free of the Pi SDK so it is trivially testable
 * with a plain fake.  The real `ExtensionCommandContext` is structurally
 * assignable here, so no cast is needed at the registration call site.
 */
export interface StatusCommandContext {
  /** Whether dialog-capable UI is available (true in TUI and RPC modes). */
  hasUI: boolean;
  ui: {
    notify(message: string, type?: "info" | "warning" | "error"): void;
  };
}

/**
 * Returns a compact multi-line diagnostics report suitable for display in a
 * Pi TUI notification or printed to stdout.
 */
export function formatDiagnosticsReport(d: ExtensionDiagnostics): string {
  const transport = d.transportResolved ? "resolved" : "not resolved";
  const shaped = [
    "anthropic",
    ...d.shapedProviders.map(({ name, layer }) => `${name} (${layer})`),
  ];
  return [
    "pi-anthropic-auth diagnostics",
    `  version: ${d.version}`,
    `  module:  ${d.modulePath}`,
    `  built-in Anthropic transport: ${transport}`,
    `  shaped providers: ${shaped.join(", ")}`,
    ...formatConfigWarnings(d.configWarnings),
  ].join("\n");
}

function formatConfigWarnings(warnings: readonly string[]): string[] {
  if (warnings.length === 0) return [];
  return ["  config warnings:", ...warnings.map((warning) => `    ${warning}`)];
}

/**
 * Returns a command handler that routes the diagnostics report to the Pi UI
 * notification system when a UI is available, or falls back to `console.log`
 * for headless (`-p`) and RPC invocations.
 *
 * @param readDiagnostics Called on every invocation, because some of what the
 *   report shows (project-layer providers) only becomes known after the
 *   command is registered.
 */
export function createStatusCommandHandler(
  readDiagnostics: () => ExtensionDiagnostics,
): (args: string, ctx: StatusCommandContext) => Promise<void> {
  return (_args, ctx) => {
    const report = formatDiagnosticsReport(readDiagnostics());
    if (ctx.hasUI) {
      ctx.ui.notify(report, "info");
    } else {
      console.log(report);
    }
    return Promise.resolve();
  };
}
