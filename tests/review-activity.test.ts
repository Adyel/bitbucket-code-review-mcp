import { describe, it, expect, afterEach, vi } from "vitest";
import { BitbucketClient } from "../src/bitbucket-client.js";
import { jsonResponse, requestedUrls, stubFetch } from "./helpers/mock-fetch.js";

const ME = "me-id";

function pr(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `PR ${id}`,
    state: "OPEN",
    author: { display_name: "Colleague", account_id: "colleague-id" },
    reviewers: [],
    participants: [],
    updated_on: `2026-09-${String(20 - id).padStart(2, "0")}T12:00:00Z`,
    links: { html: { href: `https://bitbucket.org/ws/repo/pull-requests/${id}` } },
    ...extra,
  };
}

function participant(role: string, extra: Record<string, unknown> = {}) {
  return {
    role,
    approved: false,
    state: null,
    participated_on: null,
    user: { display_name: "Me", account_id: ME },
    ...extra,
  };
}

function makeClient(defaultAccountId?: string) {
  return new BitbucketClient({
    email: "me@example.com",
    apiToken: "token",
    defaultWorkspace: "ws",
    defaultRepoSlug: "repo",
    defaultAccountId,
  });
}

const isListUrl = (url: string) => /\/pullrequests\?/.test(url);

describe("getReviewActivity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests participants and matches author, reviewer and commenter PRs", async () => {
    const fetchMock = stubFetch((url) => {
      if (isListUrl(url)) {
        return jsonResponse({
          values: [
            pr(1, {
              reviewers: [{ display_name: "Me", account_id: ME }],
              participants: [
                participant("REVIEWER", {
                  approved: true,
                  state: "approved",
                  participated_on: "2026-09-19T12:00:00Z",
                }),
              ],
            }),
            pr(2, {
              participants: [
                participant("PARTICIPANT", { participated_on: "2026-09-18T12:00:00Z" }),
              ],
            }),
            pr(3),
            pr(4, { author: { display_name: "Me", account_id: ME } }),
            pr(5, { reviewers: [{ display_name: "Me", account_id: ME }] }),
            pr(6, {
              state: "MERGED",
              reviewers: [{ display_name: "Me", account_id: ME }],
            }),
          ],
        });
      }
      if (url.includes("/pullrequests/2/comments")) {
        return jsonResponse({
          values: [
            {
              id: 9,
              content: { raw: "Looks solid" },
              created_on: "2026-09-18T12:00:00Z",
              user: { account_id: ME },
              deleted: false,
            },
            {
              id: 10,
              content: { raw: "" },
              created_on: "2026-09-18T12:00:00Z",
              user: { account_id: ME },
              deleted: true,
            },
          ],
        });
      }
      return jsonResponse({ values: [] });
    });

    const result = await makeClient(ME).getReviewActivity();

    const [listUrl] = requestedUrls(fetchMock);
    expect(listUrl).toContain("fields=+values.participants,+values.reviewers");
    expect(listUrl).toContain("state=OPEN&state=MERGED&state=DECLINED");
    expect(listUrl).toContain("pagelen=50");

    expect(result.account_id).toBe(ME);
    expect(result.reviews.map((r) => [r.id, r.summary_action])).toEqual([
      [1, "Approved"],
      [2, "Commented"],
      [4, "Author"],
      [5, "Pending Review"],
      [6, "Not Reviewed"],
    ]);
    expect(result.reviews[1].my_comments).toEqual([
      { id: 9, created_on: "2026-09-18T12:00:00Z", text: "Looks solid" },
    ]);
    expect(result.incomplete).toBe(false);
  });

  it("filters the list and the comments by since and account", async () => {
    const fetchMock = stubFetch((url) =>
      jsonResponse({
        values: isListUrl(url)
          ? [pr(1, { participants: [participant("PARTICIPANT")] })]
          : [],
      })
    );

    await makeClient(ME).getReviewActivity({ since: "2026-09-14", state: "MERGED" });

    const [listUrl, commentsUrl] = requestedUrls(fetchMock);
    expect(listUrl).toContain("state=MERGED&sort=-updated_on");
    expect(listUrl).toContain("q=updated_on >= 2026-09-14");
    expect(commentsUrl).toContain(
      `q=user.account_id = "${ME}" AND created_on >= 2026-09-14`
    );
  });

  it("rejects a malformed since before any request", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ values: [] }));
    await expect(
      makeClient(ME).getReviewActivity({ since: "2026-09-14) OR (1=1" })
    ).rejects.toThrow("Invalid since");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops paging once limit matches are found", async () => {
    const next = "https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests?page=2";
    const fetchMock = stubFetch((url) =>
      isListUrl(url)
        ? jsonResponse({
            values: [pr(1, { participants: [participant("PARTICIPANT")] })],
            next,
          })
        : jsonResponse({ values: [] })
    );

    const result = await makeClient(ME).getReviewActivity({
      limit: 1,
      includeComments: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0].my_comments).toBeUndefined();
  });

  it("flags the result incomplete when the page cap is hit", async () => {
    let page = 0;
    stubFetch(() =>
      jsonResponse({
        values: [pr(3)],
        next: `https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests?page=${++page + 1}`,
      })
    );

    const result = await makeClient(ME).getReviewActivity();

    expect(page).toBe(10);
    expect(result.scanned_pull_requests).toBe(10);
    expect(result.incomplete).toBe(true);
  });

  it("propagates a failed list request", async () => {
    stubFetch(() => jsonResponse({ error: { message: "Forbidden" } }, 403));
    await expect(makeClient(ME).getReviewActivity()).rejects.toThrow("403");
  });

  it("keeps a PR and records the error when its comments fail", async () => {
    stubFetch((url) =>
      isListUrl(url)
        ? jsonResponse({
            values: [pr(1, { participants: [participant("PARTICIPANT")] })],
          })
        : jsonResponse({ error: { message: "Forbidden" } }, 403)
    );

    const result = await makeClient(ME).getReviewActivity();

    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0].comments_error).toContain("403");
  });

  it("falls back to the token's account from /user", async () => {
    const fetchMock = stubFetch((url) =>
      url.endsWith("/user")
        ? jsonResponse({ uuid: "{u}", display_name: "Me", account_id: "from-user" })
        : jsonResponse({ values: [] })
    );

    const result = await makeClient().getReviewActivity();

    expect(result.account_id).toBe("from-user");
    expect(requestedUrls(fetchMock)[0]).toMatch(/\/user$/);
  });

  it("asks for BITBUCKET_ACCOUNT_ID when /user is not readable", async () => {
    stubFetch(() => jsonResponse({ error: { message: "Unauthorized" } }, 401));
    await expect(makeClient().getReviewActivity()).rejects.toThrow(
      "BITBUCKET_ACCOUNT_ID"
    );
  });
});

describe("getCurrentUser", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects when /user fails so delete_comment defers to Bitbucket", async () => {
    stubFetch(() => jsonResponse({ error: { message: "Unauthorized" } }, 401));
    await expect(makeClient(ME).getCurrentUser()).rejects.toThrow("401");
  });
});
