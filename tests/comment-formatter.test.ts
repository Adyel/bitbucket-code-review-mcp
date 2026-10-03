/**
 * Unit tests for comment-formatter.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getAITag,
  isTagEnabled,
  formatComment,
  formatCodeSuggestion,
  formatUpdatedComment,
  getUpdateMarker,
} from "../src/comment-formatter.js";

describe("comment-formatter", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ─── getAITag ──────────────────────────────────────────────

  describe("getAITag", () => {
    it("returns default tag when env is not set", () => {
      delete process.env.BITBUCKET_AI_TAG;
      expect(getAITag()).toBe("🤖 AI Review");
    });

    it("returns custom tag from env", () => {
      process.env.BITBUCKET_AI_TAG = "Custom Bot";
      expect(getAITag()).toBe("Custom Bot");
    });

    it("returns empty string when env is set to empty", () => {
      process.env.BITBUCKET_AI_TAG = "";
      expect(getAITag()).toBe("");
    });
  });

  // ─── isTagEnabled ─────────────────────────────────────────

  describe("isTagEnabled", () => {
    it("returns true with default tag", () => {
      delete process.env.BITBUCKET_AI_TAG;
      expect(isTagEnabled()).toBe(true);
    });

    it("returns false when tag is empty", () => {
      process.env.BITBUCKET_AI_TAG = "";
      expect(isTagEnabled()).toBe(false);
    });
  });

  // ─── formatComment ─────────────────────────────────────────

  describe("formatComment", () => {
    it("prepends AI tag", () => {
      delete process.env.BITBUCKET_AI_TAG;
      const result = formatComment("Great code!");
      expect(result).toContain("**[🤖 AI Review]**");
      expect(result).toContain("Great code!");
    });

    it("respects a custom tag", () => {
      process.env.BITBUCKET_AI_TAG = "Bot Review";
      expect(formatComment("hi")).toContain("**[Bot Review]**");
    });

    it("omits tag when disabled", () => {
      process.env.BITBUCKET_AI_TAG = "";
      expect(formatComment("Great code!")).toBe("Great code!");
    });
  });

  // ─── formatCodeSuggestion ─────────────────────────────────

  describe("formatCodeSuggestion", () => {
    it("wraps code in a suggestion block", () => {
      delete process.env.BITBUCKET_AI_TAG;
      const result = formatCodeSuggestion("const x = 1;");
      expect(result).toContain("```suggestion");
      expect(result).toContain("const x = 1;");
    });

    it("includes explanation when provided", () => {
      delete process.env.BITBUCKET_AI_TAG;
      const result = formatCodeSuggestion("const x = 1;", "Use const");
      expect(result).toContain("Use const");
    });

    it("adds no label of its own, so an empty tag leaves only the explanation and the block", () => {
      process.env.BITBUCKET_AI_TAG = "";
      expect(formatCodeSuggestion("const x = 1;", "Use const")).toBe(
        "Use const\n\n```suggestion\nconst x = 1;\n```"
      );
      expect(formatCodeSuggestion("const x = 1;")).toBe(
        "```suggestion\nconst x = 1;\n```"
      );
    });

    it("carries the AI tag like any other comment when it is set", () => {
      process.env.BITBUCKET_AI_TAG = "AI";
      const result = formatCodeSuggestion("const x = 1;", "Use const");
      expect(result.startsWith("**[AI]**\n\nUse const")).toBe(true);
      expect(result).not.toContain("Suggestion");
    });
  });

  // ─── formatUpdatedComment ─────────────────────────────────

  describe("formatUpdatedComment", () => {
    it("replaces cleanly by default (no marker, no old body)", () => {
      const result = formatUpdatedComment("Original", "New body");
      expect(result).toBe("New body");
      expect(result).not.toContain("Original");
      expect(result).not.toContain(getUpdateMarker());
    });

    it("prefixes the marker when mark=true", () => {
      const result = formatUpdatedComment("Original", "New body", {
        mark: true,
      });
      expect(result).toContain(getUpdateMarker());
      expect(result).toContain("New body");
      expect(result).not.toContain("Original");
    });

    it("keeps the old body and adds a divider when append=true", () => {
      const result = formatUpdatedComment("Original", "New body", {
        append: true,
      });
      expect(result).toContain("Original");
      expect(result).toContain("---");
      expect(result).toContain("New body");
    });

    it("appends with a marker when append and mark are both true", () => {
      const result = formatUpdatedComment("Original", "New body", {
        append: true,
        mark: true,
      });
      expect(result).toContain("Original");
      expect(result).toContain(getUpdateMarker());
      expect(result).toContain("New body");
    });
  });
});
