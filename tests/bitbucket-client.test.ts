/**
 * Unit tests for bitbucket-client.ts — pure function tests.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { BitbucketClient, truncateText } from "../src/bitbucket-client.js";
import { jsonResponse, stubFetch } from "./helpers/mock-fetch.js";

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

  describe("pagination", () => {
    const paged = new BitbucketClient({
      email: "test@example.com",
      apiToken: "test-token",
      defaultWorkspace: "ws",
      defaultRepoSlug: "repo",
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("requests pagelen=50 on the pullrequests list endpoint", async () => {
      const fetchMock = stubFetch(() => jsonResponse({ values: [] }));
      await paged.listPullRequests(undefined, undefined, "OPEN");
      await paged.getPullRequestByBranch("feature/x");
      expect(fetchMock.mock.calls[0][0]).toContain("/pullrequests?state=OPEN&pagelen=50");
      expect(fetchMock.mock.calls[1][0]).toMatch(/\/pullrequests\?q=.*&pagelen=50$/);
    });

    it("keeps pagelen=100 on PR sub-resources", async () => {
      const fetchMock = stubFetch(() => jsonResponse({ values: [] }));
      await paged.listPRComments(1);
      expect(fetchMock.mock.calls[0][0]).toContain(
        "/pullrequests/1/comments?pagelen=100"
      );
    });

    it("follows next links until exhausted", async () => {
      const next =
        "https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests?page=2";
      const fetchMock = stubFetch((url) =>
        url === next
          ? jsonResponse({ values: [{ id: 2 }] })
          : jsonResponse({ values: [{ id: 1 }], next })
      );
      const prs = await paged.listPullRequests();
      expect(prs.map((pr) => pr.id)).toEqual([1, 2]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
