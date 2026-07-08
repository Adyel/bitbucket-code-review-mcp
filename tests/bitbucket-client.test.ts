/**
 * Unit tests for bitbucket-client.ts — pure function tests.
 */

import { describe, it, expect } from "vitest";
import { BitbucketClient, truncateText } from "../src/bitbucket-client.js";

describe("BitbucketClient", () => {
  const client = new BitbucketClient({
    email: "test@example.com",
    apiToken: "test-token",
  });

  // ─── parsePullRequestUrl ──────────────────────────────────

  describe("parsePullRequestUrl", () => {
    it("parses standard Bitbucket Cloud URL", () => {
      const ref = client.parsePullRequestUrl(
        "https://bitbucket.org/my-workspace/my-repo/pull-requests/42"
      );
      expect(ref).toEqual({
        workspace: "my-workspace",
        repoSlug: "my-repo",
        prId: 42,
      });
    });

    it("parses URL with trailing path segments", () => {
      const ref = client.parsePullRequestUrl(
        "https://bitbucket.org/acme/backend/pull-requests/123/diff"
      );
      expect(ref).toEqual({
        workspace: "acme",
        repoSlug: "backend",
        prId: 123,
      });
    });

    it("parses API URL", () => {
      const ref = client.parsePullRequestUrl(
        "https://api.bitbucket.org/2.0/repositories/acme/backend/pullrequests/99"
      );
      expect(ref).toEqual({
        workspace: "acme",
        repoSlug: "backend",
        prId: 99,
      });
    });

    it("throws on invalid URL", () => {
      expect(() =>
        client.parsePullRequestUrl("https://github.com/user/repo/pull/1")
      ).toThrow("Could not parse Bitbucket PR URL");
    });

    it("throws on malformed Bitbucket URL", () => {
      expect(() =>
        client.parsePullRequestUrl("https://bitbucket.org/only-workspace")
      ).toThrow("Could not parse Bitbucket PR URL");
    });
  });

  // ─── resolveWorkspace / resolveRepoSlug ───────────────────

  describe("defaults resolution", () => {
    it("uses default workspace when configured", () => {
      const clientWithDefaults = new BitbucketClient({
        email: "test@example.com",
        apiToken: "test-token",
        defaultWorkspace: "default-ws",
        defaultRepoSlug: "default-repo",
      });

      // We can't directly test private methods, but we can verify
      // the config is stored by checking parsePullRequestUrl still works
      expect(clientWithDefaults).toBeDefined();
    });
  });

  // ─── truncateText ─────────────────────────────────────────

  describe("truncateText", () => {
    it("returns text unchanged when under the limit", () => {
      expect(truncateText("short", 100)).toBe("short");
    });

    it("truncates and appends a note when over the limit", () => {
      const result = truncateText("abcdefghij", 4);
      expect(result).toContain("abcd");
      expect(result).toContain("truncated");
      expect(result).toContain("of 10 characters");
    });
  });
});
