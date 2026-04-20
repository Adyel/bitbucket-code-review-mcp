/**
 * Bitbucket Cloud REST API v2.0 client.
 * Handles authentication, pagination, retry logic,
 * and all PR comment/task/diff operations.
 */

const BASE_URL = "https://api.bitbucket.org/2.0";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

export interface BitbucketConfig {
  email: string;
  apiToken: string;
  defaultWorkspace?: string;
  defaultRepoSlug?: string;
  pendingComments?: boolean;
}

export interface PRReference {
  workspace: string;
  repoSlug: string;
  prId: number;
}

export interface InlinePosition {
  path: string;
  to?: number;   // line in new file
  from?: number; // line in old file (for deleted lines)
}

// ─── Response Types ──────────────────────────────────────────────

export interface PullRequest {
  id: number;
  title: string;
  description: string;
  state: string;
  author: { display_name: string; uuid: string };
  source: { branch: { name: string }; repository?: { full_name: string } };
  destination: { branch: { name: string }; repository?: { full_name: string } };
  reviewers: Array<{ display_name: string; uuid: string }>;
  created_on: string;
  updated_on: string;
  links: { html: { href: string } };
}

export interface PRComment {
  id: number;
  content: { raw: string; markup: string; html: string };
  inline?: { path: string; from?: number; to?: number };
  parent?: { id: number };
  user: { display_name: string; uuid: string };
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

export interface PaginatedResponse<T> {
  size: number;
  page: number;
  pagelen: number;
  next?: string;
  previous?: string;
  values: T[];
}

// ─── Client ──────────────────────────────────────────────────────

export class BitbucketClient {
  private config: BitbucketConfig;
  private readonly authHeader: string;

  constructor(config: BitbucketConfig) {
    this.config = config;
    this.authHeader = `Basic ${Buffer.from(
      `${config.email}:${config.apiToken}`
    ).toString("base64")}`;
  }

  private async request<T>(
    method: string,
    pathOrUrl: string,
    body?: unknown
  ): Promise<T> {
    const url = pathOrUrl.startsWith("http")
      ? pathOrUrl
      : `${BASE_URL}${pathOrUrl}`;
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
      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < MAX_RETRIES
      ) {
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
        throw new Error(
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
   * Requests the maximum page size (100) to minimize round trips and
   * tracks visited URLs to guard against infinite pagination loops.
   */
  private async fetchAllPages<T>(path: string): Promise<T[]> {
    const MAX_PAGES = 200; // safety limit — 200 × 100 = 20 000 items
    const allValues: T[] = [];
    const seenUrls = new Set<string>();

    // Append pagelen=100 (Bitbucket max) to the initial request
    const separator = path.includes("?") ? "&" : "?";
    let currentUrl: string | undefined = `${BASE_URL}${path}${separator}pagelen=100`;

    let pageCount = 0;

    while (currentUrl) {
      if (seenUrls.has(currentUrl)) {
        // Circular `next` link detected — stop to prevent infinite loop
        break;
      }
      seenUrls.add(currentUrl);

      if (++pageCount > MAX_PAGES) {
        break;
      }

      const page: PaginatedResponse<T> = await this.request<PaginatedResponse<T>>("GET", currentUrl);

      if (Array.isArray(page.values)) {
        allValues.push(...page.values);
      }

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
      `/repositories/${ws}/${slug}/pullrequests${query}`
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
    const query = `?q=source.branch.name="${encodeURIComponent(branchName)}"`;
    return this.fetchAllPages<PullRequest>(
      `/repositories/${ws}/${slug}/pullrequests${query}`
    );
  }

  // ─── Diff & Changes ──────────────────────────────────────────

  async getPullRequestDiff(
    prId: number,
    workspace?: string,
    repoSlug?: string
  ): Promise<string> {
    const ws = this.resolveWorkspace(workspace);
    const slug = this.resolveRepoSlug(repoSlug);
    return this.request<string>(
      "GET",
      `/repositories/${ws}/${slug}/pullrequests/${prId}/diff`
    );
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
    return this.request<string>(
      "GET",
      `/repositories/${ws}/${slug}/src/${encodeURIComponent(commit)}/${filePath}`
    );
  }
}
