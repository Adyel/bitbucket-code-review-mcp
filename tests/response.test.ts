/**
 * Unit tests for utils/response.ts
 */

import { describe, it, expect } from "vitest";
import {
  toolResponse,
  toolTextResponse,
  toolError,
  withErrorHandling,
} from "../src/utils/response.js";

describe("response utilities", () => {
  // ─── toolResponse ─────────────────────────────────────────

  describe("toolResponse", () => {
    it("returns structured JSON content", () => {
      const result = toolResponse({ success: true, id: 42 });
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual({ success: true, id: 42 });
    });

    it("pretty-prints JSON", () => {
      const result = toolResponse({ key: "value" });
      expect(result.content[0].text).toContain("\n");
    });
  });

  // ─── toolTextResponse ─────────────────────────────────────

  describe("toolTextResponse", () => {
    it("returns raw text content", () => {
      const result = toolTextResponse("diff --git a/file.ts");
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toBe("diff --git a/file.ts");
    });
  });

  // ─── toolError ─────────────────────────────────────────────

  describe("toolError", () => {
    it("returns error response", () => {
      const result = toolError("Something went wrong");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual({
        success: false,
        error: "Something went wrong",
      });
    });
  });

  // ─── withErrorHandling ─────────────────────────────────────

  describe("withErrorHandling", () => {
    it("passes through successful results", async () => {
      const handler = withErrorHandling(async () =>
        toolResponse({ success: true })
      );
      const result = await handler({} as never);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
    });

    it("catches errors and returns error response", async () => {
      const handler = withErrorHandling(async () => {
        throw new Error("API timeout");
      });
      const result = await handler({} as never);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual({
        success: false,
        error: "API timeout",
      });
    });

    it("handles non-Error throws", async () => {
      const handler = withErrorHandling(async () => {
        throw "string error";
      });
      const result = await handler({} as never);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe("string error");
    });
  });
});
