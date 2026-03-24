/**
 * Shared response-building utilities for MCP tool handlers.
 * Eliminates the repeated JSON.stringify + content array boilerplate.
 */

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
};

/**
 * Build a successful MCP tool response from structured data.
 */
export function toolResponse(data: Record<string, unknown>): ToolResult {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(data, null, 2) },
    ],
  };
}

/**
 * Build a text-only MCP tool response (e.g. for diffs).
 */
export function toolTextResponse(text: string): ToolResult {
  return {
    content: [{ type: "text" as const, text }],
  };
}

/**
 * Build an error MCP tool response.
 */
export function toolError(message: string): ToolResult {
  return toolResponse({ success: false, error: message });
}

/**
 * Higher-order function that wraps a tool handler with try/catch.
 * Converts unhandled errors into structured error responses.
 */
export function withErrorHandling<TArgs>(
  handler: (args: TArgs) => Promise<ToolResult>
): (args: TArgs) => Promise<ToolResult> {
  return async (args: TArgs) => {
    try {
      return await handler(args);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      return toolError(message);
    }
  };
}
