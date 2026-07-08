/**
 * PR Discovery tools — Find pull requests and read their diffs, files, and content.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BitbucketClient, PullRequest } from "../bitbucket-client.js";
import {
  WorkspaceSchema,
  RepoSlugSchema,
} from "../schemas/shared.js";
import {
  toolResponse,
  toolTextResponse,
  toolError,
  withErrorHandling,
} from "../utils/response.js";

/** Compact summary used in list views. */
function summarizePR(pr: PullRequest) {
  return {
    id: pr.id,
    title: pr.title,
    state: pr.state,
    author: pr.author.display_name,
    source_branch: pr.source.branch.name,
    destination_branch: pr.destination.branch.name,
    url: pr.links.html.href,
    created: pr.created_on,
  };
}

/** Full detail used when a single PR is fetched. */
function detailPR(pr: PullRequest) {
  return {
    id: pr.id,
    title: pr.title,
    description: pr.description,
    state: pr.state,
    author: pr.author.display_name,
    source_branch: pr.source.branch.name,
    destination_branch: pr.destination.branch.name,
    reviewers: pr.reviewers.map((r) => r.display_name),
    url: pr.links.html.href,
    created: pr.created_on,
    updated: pr.updated_on,
  };
}

export function registerPRDiscovery(
  server: McpServer,
  client: BitbucketClient
): void {
  server.registerTool(
    "list_pull_requests",
    {
      description:
        "List pull requests for a repository, filterable by state (OPEN, MERGED, DECLINED, SUPERSEDED). To fetch one specific PR, use get_pull_request instead.",
      annotations: { title: "List pull requests", readOnlyHint: true },
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        state: z
          .enum(["OPEN", "MERGED", "DECLINED", "SUPERSEDED"])
          .optional()
          .describe("Filter by PR state. Defaults to OPEN if not specified."),
      },
    },
    withErrorHandling(async ({ workspace, repo_slug, state }) => {
      const prs = await client.listPullRequests(
        workspace,
        repo_slug,
        state || "OPEN"
      );
      return toolResponse({ pull_requests: prs.map(summarizePR) });
    })
  );

  server.registerTool(
    "get_pull_request",
    {
      description:
        "Get a pull request by ID, by source branch name, or from a pasted Bitbucket URL. Provide exactly one of pr_id, branch, or url. Branch lookup may return multiple PRs; pr_id and url return a single PR.",
      annotations: { title: "Get pull request", readOnlyHint: true },
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Pull request ID. Use this when you know the PR number."),
        branch: z
          .string()
          .optional()
          .describe(
            "Source branch name. Use when you know the branch but not the PR ID; may match multiple PRs."
          ),
        url: z
          .string()
          .url()
          .optional()
          .describe(
            "Full Bitbucket PR URL, e.g. https://bitbucket.org/workspace/repo/pull-requests/123. Workspace and repo are parsed from it."
          ),
      },
    },
    withErrorHandling(async ({ workspace, repo_slug, pr_id, branch, url }) => {
      if (url) {
        const ref = client.parsePullRequestUrl(url);
        const pr = await client.getPullRequest(
          ref.prId,
          ref.workspace,
          ref.repoSlug
        );
        return toolResponse({
          ...detailPR(pr),
          workspace: ref.workspace,
          repo_slug: ref.repoSlug,
        });
      }

      if (pr_id) {
        const pr = await client.getPullRequest(pr_id, workspace, repo_slug);
        return toolResponse(detailPR(pr));
      }

      if (branch) {
        const prs = await client.getPullRequestByBranch(
          branch,
          workspace,
          repo_slug
        );
        if (prs.length === 0) {
          return toolTextResponse(
            `No pull requests found for branch "${branch}".`
          );
        }
        return toolResponse({ pull_requests: prs.map(summarizePR) });
      }

      return toolError("Provide exactly one of: pr_id, branch, or url.");
    })
  );

  server.registerTool(
    "get_pull_request_diff",
    {
      description:
        "Get the full unified diff text for a pull request. Large diffs are truncated with a note.",
      annotations: { title: "Get PR diff", readOnlyHint: true },
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: z.number().int().positive().describe("Pull request ID."),
      },
    },
    withErrorHandling(async ({ workspace, repo_slug, pr_id }) => {
      const diff = await client.getPullRequestDiff(pr_id, workspace, repo_slug);
      return toolTextResponse(diff);
    })
  );

  server.registerTool(
    "list_pull_request_files",
    {
      description:
        "List files changed in a pull request with their status (added/modified/deleted/renamed) and line counts.",
      annotations: { title: "List PR files", readOnlyHint: true },
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: z.number().int().positive().describe("Pull request ID."),
      },
    },
    withErrorHandling(async ({ workspace, repo_slug, pr_id }) => {
      const entries = await client.listPRChanges(pr_id, workspace, repo_slug);
      const files = entries.map((entry) => ({
        status: entry.status,
        old_path: entry.old?.path,
        new_path: entry.new?.path,
        lines_added: entry.lines_added,
        lines_removed: entry.lines_removed,
      }));
      return toolResponse({ files });
    })
  );

  server.registerTool(
    "get_file_content",
    {
      description:
        "Get the content of a specific file at a given commit/branch/tag. Useful for reading full file context during review. Large files are truncated with a note.",
      annotations: { title: "Get file content", readOnlyHint: true },
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        commit: z
          .string()
          .describe(
            "The commit hash, branch name, or tag to read the file from."
          ),
        file_path: z
          .string()
          .describe("File path relative to repo root, e.g. src/utils.ts"),
      },
    },
    withErrorHandling(async ({ workspace, repo_slug, commit, file_path }) => {
      const content = await client.getFileContent(
        commit,
        file_path,
        workspace,
        repo_slug
      );
      return toolTextResponse(content);
    })
  );
}
