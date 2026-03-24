/**
 * Unit tests for comment-formatter.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getAITag,
  isTagEnabled,
  isAIComment,
  formatGeneralComment,
  formatInlineComment,
  formatCodeSuggestion,
  formatUpdatedComment,
  formatReply,
  formatFileLevelComment,
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

  // ─── isAIComment ──────────────────────────────────────────

  describe("isAIComment", () => {
    it("detects default AI tag", () => {
      delete process.env.BITBUCKET_AI_TAG;
      expect(isAIComment("**[🤖 AI Review]**\n\nSome comment")).toBe(true);
    });

    it("returns false for human comment", () => {
      delete process.env.BITBUCKET_AI_TAG;
      expect(isAIComment("This is a human comment")).toBe(false);
    });

    it("detects custom AI tag", () => {
      process.env.BITBUCKET_AI_TAG = "Bot Review";
      expect(isAIComment("**[Bot Review]** Some comment")).toBe(true);
    });

    it("does NOT match hardcoded fallback when custom tag is set", () => {
      process.env.BITBUCKET_AI_TAG = "Custom Tag";
      expect(isAIComment("[AI Review] old comment")).toBe(false);
    });

    it("returns false when tagging is disabled", () => {
      process.env.BITBUCKET_AI_TAG = "";
      expect(isAIComment("**[🤖 AI Review]** whatever")).toBe(false);
    });
  });

  // ─── formatGeneralComment ─────────────────────────────────

  describe("formatGeneralComment", () => {
    it("prepends AI tag", () => {
      delete process.env.BITBUCKET_AI_TAG;
      const result = formatGeneralComment("Great code!");
      expect(result).toContain("**[🤖 AI Review]**");
      expect(result).toContain("Great code!");
    });

    it("omits tag when disabled", () => {
      process.env.BITBUCKET_AI_TAG = "";
      const result = formatGeneralComment("Great code!");
      expect(result).toBe("Great code!");
    });
  });

  // ─── formatInlineComment ──────────────────────────────────

  describe("formatInlineComment", () => {
    it("formats with severity", () => {
      delete process.env.BITBUCKET_AI_TAG;
      const result = formatInlineComment("Use const", "suggestion");
      expect(result).toContain("💡");
      expect(result).toContain("**Suggestion**");
      expect(result).toContain("Use const");
    });

    it("formats without severity", () => {
      delete process.env.BITBUCKET_AI_TAG;
      const result = formatInlineComment("Note this");
      expect(result).toContain("**[🤖 AI Review]**");
      expect(result).toContain("Note this");
    });

    it("formats all severity types", () => {
      delete process.env.BITBUCKET_AI_TAG;
      expect(formatInlineComment("x", "bug")).toContain("🐛");
      expect(formatInlineComment("x", "warning")).toContain("⚠️");
      expect(formatInlineComment("x", "note")).toContain("📝");
      expect(formatInlineComment("x", "security")).toContain("🔒");
    });
  });

  // ─── formatCodeSuggestion ─────────────────────────────────

  describe("formatCodeSuggestion", () => {
    it("wraps code in suggestion block", () => {
      delete process.env.BITBUCKET_AI_TAG;
      const result = formatCodeSuggestion("const x = 1;");
      expect(result).toContain("```suggestion");
      expect(result).toContain("const x = 1;");
      expect(result).toContain("```");
    });

    it("includes explanation when provided", () => {
      delete process.env.BITBUCKET_AI_TAG;
      const result = formatCodeSuggestion("const x = 1;", "Use const");
      expect(result).toContain("Use const");
    });
  });

  // ─── formatUpdatedComment ─────────────────────────────────

  describe("formatUpdatedComment", () => {
    it("appends update marker", () => {
      const result = formatUpdatedComment("Original", "New info");
      expect(result).toContain("Original");
      expect(result).toContain("New info");
      expect(result).toContain("✏️ Updated by AI");
      expect(result).toContain("---");
    });
  });

  // ─── formatReply ──────────────────────────────────────────

  describe("formatReply", () => {
    it("formats with AI tag", () => {
      delete process.env.BITBUCKET_AI_TAG;
      const result = formatReply("I agree");
      expect(result).toContain("**[🤖 AI Review]**");
      expect(result).toContain("I agree");
    });
  });

  // ─── formatFileLevelComment ───────────────────────────────

  describe("formatFileLevelComment", () => {
    it("delegates to formatInlineComment", () => {
      delete process.env.BITBUCKET_AI_TAG;
      const result = formatFileLevelComment("File issue", "warning");
      expect(result).toContain("⚠️");
      expect(result).toContain("File issue");
    });
  });
});
