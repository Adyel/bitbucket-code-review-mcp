/**
 * Bitbucket Cloud REST API v2.0 client.
 * Handles authentication, pagination, retry logic,
 * and all PR comment/task/diff operations.
 */

const BASE_URL = "https://api.bitbucket.org/2.0";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const DEFAULT_PAGELEN = 100;
/** The /pullrequests list endpoint rejects pagelen > 50 with 400 "Invalid pagelen". */
const PR_LIST_PAGELEN = 50;
const ACTIVITY_MAX_PAGES = 10;
const ACTIVITY_COMMENT_CONCURRENCY = 4;

/** Cap for large text payloads (diffs, file content) to avoid flooding context. */
const MAX_TEXT_CHARS = 1_000_000;

/** YYYY-MM-DD with an optional ISO-8601 time; also keeps BBQL free of injected syntax. */
export const SINCE_PATTERN =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Error carrying the HTTP status of a failed Bitbucket API call so callers can
 * branch on it (e.g. map 403 to a friendly permission message).
 */
export class BitbucketApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "BitbucketApiError";
  }
}

/** Truncate oversized text and append a note so the reader knows it was cut. */
export function truncateText(text: string, max = MAX_TEXT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n… [truncated — showing ${max} of ${text.length} characters]`;
}

export interface BitbucketConfig {
  email: string;
  apiToken: string;
  defaultWorkspace?: string;
  defaultRepoSlug?: string;
  defaultAccountId?: string;
  pendingComments?: boolean;
}

export interface BitbucketUser {
  uuid: string;
  display_name: string;
  account_id?: string;
}

export interface PRReference {
  workspace: string;
  repoSlug: string;
  prId: number;
}

export interface InlinePosition {
  path: string;
  to?: number; // line in new file
  from?: number; // line in old file (for deleted lines)
}

// ─── Response Types ──────────────────────────────────────────────

export interface PullRequest {
  id: number;
  title: string;
  description: string;
  state: string;
  author: { display_name: string; uuid: string; account_id?: string };
  source: { branch: { name: string }; repository?: { full_name: string } };
  destination: { branch: { name: string }; repository?: { full_name: string } };
  reviewers: Array<{ display_name: string; uuid: string; account_id?: string }>;
  /** Absent on list responses unless requested with `fields=+values.participants`. */
  participants?: Array<{
    role: "PARTICIPANT" | "REVIEWER";
    approved: boolean;
    state?: "approved" | "changes_requested" | null;
    participated_on?: string | null;
    user: { display_name: string; uuid: string; account_id?: string };
  }>;
  created_on: string;
  updated_on: string;
  links: { html: { href: string } };
}

export interface PRComment {
  id: number;
  content: { raw: string; markup: string; html: string };
  inline?: { path: string; from?: number; to?: number };
  parent?: { id: number };
  user: { display_name: string; uuid: string; account_id?: string };
  created_on: string;
  updated_on: string;
  deleted: boolean;
  pending: boolean;
  resolved?: boolean;
}

export interface PRTask {
  id: number;
  content: { raw: string };
  state: string;
  comment?: { id: number };
  creator: { display_name: string };
  created_on: string;
  updated_on: string;
}

export interface DiffStatEntry {
  type: string;
  status: string;
  old?: { path: string };
  new?: { path: string };
  lines_added: number;
  lines_removed: number;
}

export type ReviewAction =
  | "Approved"
  | "Changes Requested"
  | "Commented"
  | "Author"
  | "Pending Review"
  | "Not Reviewed"
  | "Participated";

export interface ReviewActivityItem {
  id: number;
  title: string;
  state: string;
  author: string;
  url: string;
  updated_on: string;
  is_author: boolean;
  is_reviewer: boolean;
  approved: boolean;
  review_state: "approved" | "changes_requested" | null;
  participated_on: string | null;
  summary_action: ReviewAction;
  my_comments?: Array<{ id: number; created_on: string; text: string }>;
  comments_error?: string;
}

export interface ReviewActivityOptions {
  workspace?: string;
  repoSlug?: string;
  accountId?: string;
  since?: string;
  state?: "OPEN" | "MERGED" | "DECLINED" | "ALL";
  limit?: number;
  includeComments?: boolean;
}

export interface ReviewActivityResult {
  account_id: string;
  reviews: ReviewActivityItem[];
  scanned_pull_requests: number;
  /** True when the page cap stopped the scan before the matching PRs ran out. */
  incomplete: boolean;
}

export interface PaginatedResponse<T> {
  size: number;
  page: number;
  pagelen: number;
  next?: string;
  previous?: string;
  values: T[];
}

function bbqlString(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        await fn(items[next++]);
      }
    }
  );
  await Promise.all(workers);
}

function toActivityItem(
  pr: PullRequest,
  accountId: string
): ReviewActivityItem | undefined {
  const participant = pr.participants?.find((p) => p.user?.account_id === accountId);
  const isAuthor = pr.author?.account_id === accountId;
  const isReviewer =
    participant?.role === "REVIEWER" ||
    (pr.reviewers ?? []).some((r) => r.account_id === accountId);
  if (!isAuthor && !isReviewer && !participant) return undefined;

  const approved = participant?.approved ?? false;
  const reviewState = participant?.state ?? null;
  let summaryAction: ReviewAction;
  if (approved) summaryAction = "Approved";
  else if (reviewState === "changes_requested") summaryAction = "Changes Requested";
  else if (isAuthor) summaryAction = "Author";
  else if (isReviewer && !participant?.participated_on)
    summaryAction = pr.state === "OPEN" ? "Pending Review" : "Not Reviewed";
  else summaryAction = "Participated";

  return {
    id: pr.id,
    title: pr.title,
    state: pr.state,
    author: pr.author.display_name,
    url: pr.links.html.href,
    updated_on: pr.updated_on,
    is_author: isAuthor,
    is_reviewer: isReviewer,
    approved,
    review_state: reviewState,
    participated_on: participant?.participated_on ?? null,
    summary_action: summaryAction,
  };
}

// ─── Client ──────────────────────────────────────────────────────

export class BitbucketClient {
  private config: BitbucketConfig;
  private readonly authHeader: string;
  private currentUser?: BitbucketUser;

  constructor(config: BitbucketConfig) {
    this.config = config;
    this.authHeader = `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString(
      "base64"
    )}`;
  }

  private async request<T>(
    method: string,
    pathOrUrl: string,
    body?: unknown
  ): Promise<T> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${BASE_URL}${pathOrUrl}`;
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      // Retry on 429 (rate limit) or 5xx (server error)
      if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
        const retryAfter = response.headers.get("retry-after");
        if (retryAfter) {
          const waitMs = parseInt(retryAfter, 10) * 1000;
          if (!isNaN(waitMs)) {
            await new Promise((resolve) => setTimeout(resolve, waitMs));
          }
        }
        lastError = new Error(
          `Bitbucket API error ${response.status} ${response.statusText}`
        );
        continue;
      }

      if (!response.ok) {
        const errorBody = await response.text();
        throw new BitbucketApiError(
          response.status,
          `Bitbucket API error ${response.status} ${response.statusText}: ${errorBody}`
        );
      }

      // Some endpoints return no content (204)
      if (response.status === 204) {
        return {} as T;
      }

      // Check if the response has a body
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        return (await response.json()) as T;
      }

      // For text responses (like diff)
      return (await response.text()) as unknown as T;
    }

    throw lastError ?? new Error("Request failed after retries");
  }

  /**
   * Fetch all pages of a paginated endpoint, following `next` URLs.
   *
   * Requests `pagelen` items per page (the endpoint's max) to minimize round
   * trips and tracks visited URLs to guard against infinite pagination loops.
   */
  private async fetchAllPages<T>(
    path: string,
    pagelen = DEFAULT_PAGELEN,
    isDone?: (values: T[], pageCount: number) => boolean
  ): Promise<T[]> {
    const MAX_PAGES = 200;
    const allValues: T[] = [];
    const seenUrls = new Set<string>();

    const separator = path.includes("?") ? "&" : "?";
    let currentUrl: string | undefined =
      `${BASE_URL}${path}${separator}pagelen=${pagelen}`;

    let pageCount = 0;

    while (currentUrl) {
      if (seenUrls.has(currentUrl)) {
        // Circular `next` link detected — stop to prevent infinite loop
        console.error(
          `[bitbucket] pagination stopped: circular 'next' link after ${allValues.length} items`
        );
        break;
      }
      seenUrls.add(currentUrl);

      if (++pageCount > MAX_PAGES) {
        console.error(
          `[bitbucket] pagination cap reached (${MAX_PAGES} pages) — results may be incomplete (${allValues.length} items)`
        );
        break;
      }

      const page: PaginatedResponse<T> = await this.request<PaginatedResponse<T>>(
        "GET",
        currentUrl
      );

      if (Array.isArray(page.values)) {
        allValues.push(...page.values);
      }

      if (page.next && isDone?.(allValues, pageCount)) break;

      // `next` is either a full URL for the next page or absent / undefined
      currentUrl = page.next;
    }

    return allValues;
  }

  private resolveWorkspace(workspace?: string): string {
    const ws = workspace || this.config.defaultWorkspace;
    if (!ws) {
      throw new Error(
        "Workspace is required. Provide it as a parameter or set BITBUCKET_DEFAULT_WORKSPACE env var."
      );
    }
    return ws;
  }

  private resolveRepoSlug(repoSlug?: string): string {
    const slug = repoSlug || this.config.defaultRepoSlug;
    if (!slug) {
      throw new Error(
        "Repository slug is required. Provide it as a parameter or set BITBUCKET_DEFAULT_REPO_SLUG env var."
      );
    }
    return slug;
  }

  // ─── Identity ───────────────────────────────────────────────

  /**
   * Fetch the account the API token authenticates as. Cached for the process
   * lifetime — used to enforce that we only delete our own comments.
   */
  async getCurrentUser(): Promise<BitbucketUser> {
    if (!this.currentUser) {
      this.currentUser = await this.request<BitbucketUser>("GET", "/user");
    }
    return this.currentUser;
  }

  // ─── PR URL Parser ──────────────────────────────────────────

  /**
   * Parse a Bitbucket PR URL into workspace, repo slug, and PR ID.
   * Supports: https://bitbucket.org/{workspace}/{repo}/pull-requests/{id}
   */
  parsePullRequestUrl(prUrl: string): PRReference {
    const patterns = [
      // Standard Bitbucket Cloud URL
      /bitbucket\.org\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)/,
      // API URL
      /api\.bitbucket\.org\/2\.0\/repositories\/([^/]+)\/([^/]+)\/pullrequests\/(\d+)/,
    ];

    for (const pattern of patterns) {
      const match = prUrl.match(pattern);
      if (match) {
        return {
          workspace: match[1],
          repoSlug: match[2],
          prId: parseInt(match[3], 10),
        };
      }
    }

    throw new Error(
      `Could not parse Bitbucket PR URL: ${prUrl}. Expected format: https://bitbucket.org/{workspace}/{repo}/pull-requests/{id}`
    );
  }

  // ─── Pull Requests ──────────────────────────────────────────

  async listPullRequests(
    workspace?: string,
    repoSlug?: string,
    state?: string
  ): Promise<PullRequest[]> {
    const ws = this.resolveWorkspace(workspace);
    const slug = this.resolveRepoSlug(repoSlug);
    const query = state ? `?state=${encodeURIComponent(state)}` : "";
    return this.fetchAllPages<PullRequest>(
      `/repositories/${ws}/${slug}/pullrequests${query}`,
      PR_LIST_PAGELEN
    );
  }

  async getPullRequest(
    prId: number,
    workspace?: string,
    repoSlug?: string
  ): Promise<PullRequest> {
    const ws = this.resolveWorkspace(workspace);
    const slug = this.resolveRepoSlug(repoSlug);
    return this.request<PullRequest>(
      "GET",
      `/repositories/${ws}/${slug}/pullrequests/${prId}`
    );
  }

  async getPullRequestByBranch(
    branchName: string,
    workspace?: string,
    repoSlug?: string
  ): Promise<PullRequest[]> {
    const ws = this.resolveWorkspace(workspace);
    const slug = this.resolveRepoSlug(repoSlug);
    const filter = `source.branch.name="${branchName}"`;
    const query = `?q=${encodeURIComponent(filter)}`;
    return this.fetchAllPages<PullRequest>(
      `/repositories/${ws}/${slug}/pullrequests${query}`,
      PR_LIST_PAGELEN
    );
  }

  // ─── Review Activity ────────────────────────────────────────

  private async resolveAccountId(accountId?: string): Promise<string> {
    const explicit = accountId || this.config.defaultAccountId;
    if (explicit) return explicit;
    try {
      const me = await this.getCurrentUser();
      if (me.account_id) return me.account_id;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not determine the Bitbucket account (GET /user failed: ${reason}). Pass account_id or set BITBUCKET_ACCOUNT_ID.`,
        { cause: error }
      );
    }
    throw new Error(
      "Could not determine the Bitbucket account. Pass account_id or set BITBUCKET_ACCOUNT_ID."
    );
  }

  /**
   * PRs updated on or after `since` in which the account is the author, a
   * reviewer or a participant, newest first.
   */
  async getReviewActivity(
    options: ReviewActivityOptions = {}
  ): Promise<ReviewActivityResult> {
    const ws = this.resolveWorkspace(options.workspace);
    const slug = this.resolveRepoSlug(options.repoSlug);
    const { since } = options;
    if (since && !SINCE_PATTERN.test(since)) {
      throw new Error(
        `Invalid since "${since}". Use YYYY-MM-DD or an ISO-8601 datetime.`
      );
    }
    const accountId = await this.resolveAccountId(options.accountId);
    const limit = options.limit ?? 25;
    const states =
      !options.state || options.state === "ALL"
        ? ["OPEN", "MERGED", "DECLINED"]
        : [options.state];

    const params = [
      ...states.map((st) => `state=${st}`),
      "sort=-updated_on",
      `fields=${encodeURIComponent("+values.participants,+values.reviewers")}`,
    ];
    if (since) params.push(`q=${encodeURIComponent(`updated_on >= ${since}`)}`);

    let stoppedAtCap = false;
    const prs = await this.fetchAllPages<PullRequest>(
      `/repositories/${ws}/${slug}/pullrequests?${params.join("&")}`,
      PR_LIST_PAGELEN,
      (values, pageCount) => {
        if (values.filter((pr) => toActivityItem(pr, accountId)).length >= limit) {
          return true;
        }
        stoppedAtCap = pageCount >= ACTIVITY_MAX_PAGES;
        return stoppedAtCap;
      }
    );

    const reviews = prs
      .map((pr) => toActivityItem(pr, accountId))
      .filter((item): item is ReviewActivityItem => item !== undefined)
      .slice(0, limit);

    if (options.includeComments !== false) {
      await mapWithConcurrency(reviews, ACTIVITY_COMMENT_CONCURRENCY, async (item) => {
        try {
          const comments = await this.listCommentsBy(item.id, accountId, since, ws, slug);
          item.my_comments = comments.map((c) => ({
            id: c.id,
            created_on: c.created_on,
            text: truncateText(c.content.raw, 200),
          }));
          if (
            item.my_comments.length > 0 &&
            (item.summary_action === "Author" ||
              item.summary_action === "Pending Review" ||
              item.summary_action === "Not Reviewed" ||
              item.summary_action === "Participated")
          ) {
            item.summary_action = "Commented";
          }
        } catch (error) {
          item.comments_error = error instanceof Error ? error.message : String(error);
        }
      });
    }

    return {
      account_id: accountId,
      reviews,
      scanned_pull_requests: prs.length,
      incomplete: stoppedAtCap,
    };
  }

  private async listCommentsBy(
    prId: number,
    accountId: string,
    since: string | undefined,
    ws: string,
    slug: string
  ): Promise<PRComment[]> {
    let filter = `user.account_id = ${bbqlString(accountId)}`;
    if (since) filter += ` AND created_on >= ${since}`;
    const comments = await this.fetchAllPages<PRComment>(
      `/repositories/${ws}/${slug}/pullrequests/${prId}/comments?q=${encodeURIComponent(filter)}`
    );
    return comments.filter((c) => !c.deleted);
  }

  // ─── Diff & Changes ──────────────────────────────────────────

  async getPullRequestDiff(
    prId: number,
    workspace?: string,
    repoSlug?: string
  ): Promise<string> {
    const ws = this.resolveWorkspace(workspace);
    const slug = this.resolveRepoSlug(repoSlug);
    const diff = await this.request<string>(
      "GET",
      `/repositories/${ws}/${slug}/pullrequests/${prId}/diff`
    );
    return truncateText(diff);
  }

  async listPRChanges(
    prId: number,
    workspace?: string,
    repoSlug?: string
  ): Promise<DiffStatEntry[]> {
    const ws = this.resolveWorkspace(workspace);
    const slug = this.resolveRepoSlug(repoSlug);
    return this.fetchAllPages<DiffStatEntry>(
      `/repositories/${ws}/${slug}/pullrequests/${prId}/diffstat`
    );
  }

  // ─── Comments ──────────────────────────────────────────────

  async listPRComments(
    prId: number,
    workspace?: string,
    repoSlug?: string
  ): Promise<PRComment[]> {
    const ws = this.resolveWorkspace(workspace);
    const slug = this.resolveRepoSlug(repoSlug);
    return this.fetchAllPages<PRComment>(
      `/repositories/${ws}/${slug}/pullrequests/${prId}/comments`
    );
  }

  async createPRComment(
    prId: number,
    rawContent: string,
    inline?: InlinePosition,
    parentId?: number,
    workspace?: string,
    repoSlug?: string
  ): Promise<PRComment> {
    const ws = this.resolveWorkspace(workspace);
    const slug = this.resolveRepoSlug(repoSlug);

    const body: Record<string, unknown> = {
      content: { raw: rawContent },
    };

    if (this.config.pendingComments) {
      body.pending = true;
    }

    if (inline) {
      body.inline = inline;
    }

    if (parentId) {
      body.parent = { id: parentId };
    }

    return this.request<PRComment>(
      "POST",
      `/repositories/${ws}/${slug}/pullrequests/${prId}/comments`,
      body
    );
  }

  async updatePRComment(
    prId: number,
    commentId: number,
    rawContent: string,
    workspace?: string,
    repoSlug?: string
  ): Promise<PRComment> {
    const ws = this.resolveWorkspace(workspace);
    const slug = this.resolveRepoSlug(repoSlug);
    return this.request<PRComment>(
      "PUT",
      `/repositories/${ws}/${slug}/pullrequests/${prId}/comments/${commentId}`,
      { content: { raw: rawContent } }
    );
  }

  async getPRComment(
    prId: number,
    commentId: number,
    workspace?: string,
    repoSlug?: string
  ): Promise<PRComment> {
    const ws = this.resolveWorkspace(workspace);
    const slug = this.resolveRepoSlug(repoSlug);
    return this.request<PRComment>(
      "GET",
      `/repositories/${ws}/${slug}/pullrequests/${prId}/comments/${commentId}`
    );
  }

  async deletePRComment(
    prId: number,
    commentId: number,
    workspace?: string,
    repoSlug?: string
  ): Promise<void> {
    const ws = this.resolveWorkspace(workspace);
    const slug = this.resolveRepoSlug(repoSlug);
    await this.request<void>(
      "DELETE",
      `/repositories/${ws}/${slug}/pullrequests/${prId}/comments/${commentId}`
    );
  }

  async resolveComment(
    prId: number,
    commentId: number,
    workspace?: string,
    repoSlug?: string
  ): Promise<PRComment> {
    const ws = this.resolveWorkspace(workspace);
    const slug = this.resolveRepoSlug(repoSlug);
    return this.request<PRComment>(
      "PUT",
      `/repositories/${ws}/${slug}/pullrequests/${prId}/comments/${commentId}/resolve`,
      {}
    );
  }

  async reopenComment(
    prId: number,
    commentId: number,
    workspace?: string,
    repoSlug?: string
  ): Promise<void> {
    const ws = this.resolveWorkspace(workspace);
    const slug = this.resolveRepoSlug(repoSlug);
    await this.request<void>(
      "DELETE",
      `/repositories/${ws}/${slug}/pullrequests/${prId}/comments/${commentId}/resolve`
    );
  }

  // ─── Tasks ──────────────────────────────────────────────────

  async listPRTasks(
    prId: number,
    workspace?: string,
    repoSlug?: string
  ): Promise<PRTask[]> {
    const ws = this.resolveWorkspace(workspace);
    const slug = this.resolveRepoSlug(repoSlug);
    return this.fetchAllPages<PRTask>(
      `/repositories/${ws}/${slug}/pullrequests/${prId}/tasks`
    );
  }

  async createPRTask(
    prId: number,
    content: string,
    commentId?: number,
    workspace?: string,
    repoSlug?: string
  ): Promise<PRTask> {
    const ws = this.resolveWorkspace(workspace);
    const slug = this.resolveRepoSlug(repoSlug);
    const body: Record<string, unknown> = {
      content: { raw: content },
    };
    if (commentId) {
      body.comment = { id: commentId };
    }
    return this.request<PRTask>(
      "POST",
      `/repositories/${ws}/${slug}/pullrequests/${prId}/tasks`,
      body
    );
  }

  async updatePRTask(
    prId: number,
    taskId: number,
    state: string,
    workspace?: string,
    repoSlug?: string
  ): Promise<PRTask> {
    const ws = this.resolveWorkspace(workspace);
    const slug = this.resolveRepoSlug(repoSlug);
    return this.request<PRTask>(
      "PUT",
      `/repositories/${ws}/${slug}/pullrequests/${prId}/tasks/${taskId}`,
      { state }
    );
  }

  // ─── Source / File Content ──────────────────────────────────

  async getFileContent(
    commit: string,
    filePath: string,
    workspace?: string,
    repoSlug?: string
  ): Promise<string> {
    const ws = this.resolveWorkspace(workspace);
    const slug = this.resolveRepoSlug(repoSlug);
    const content = await this.request<string>(
      "GET",
      `/repositories/${ws}/${slug}/src/${encodeURIComponent(commit)}/${filePath}`
    );
    return truncateText(content);
  }
}
