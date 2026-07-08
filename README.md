# 🔍 Bitbucket Code Review MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that enables AI agents like **Gemini CLI** and **Antigravity** to post well-formatted code review comments on **Bitbucket Cloud** pull requests.

> **The MCP does NOT review code itself** — it provides tools for agents to create comments tagged with `[🤖 AI Review]` that a human reviewer will review and approve.

## ✨ Features

| Category | Tools |
|----------|-------|
| **PR Discovery** | One `get_pull_request` (by ID, branch, or URL), list PRs, view diff, list changed files, read file content |
| **Comments** | One `add_comment` for general / inline / file-level / reply, plus batch `add_comments` |
| **Code Suggestions** | Single and multi-line suggestions with Bitbucket's suggestion syntax — one-click apply |
| **Comment Management** | Edit (clean replace or append), delete (own comments only), resolve/reopen via one toggle |
| **Pending Comments** | Create comments as draft — not published until reviewer submits review |
| **Tasks** | Create, list, update tasks on PRs |

> **v2 is a breaking change** — see [Migrating from v1](#-migrating-from-v1). The tool surface was
> consolidated (21 → 15), severity was removed, `update_comment` now replaces by default, and
> `delete_comment` no longer relies on a text tag.

## 🚀 Setup

### Prerequisites

- **Node.js 22+** (LTS) via [nvm](https://github.com/nvm-sh/nvm)
- A **Bitbucket Cloud** account with an [API Token](https://bitbucket.org/account/settings/api-tokens/)
  - Required permissions: `Repositories: Read`, `Pull requests: Read & Write`

### Install from GitHub

The easiest way to use this MCP is directly from GitHub — no cloning needed:

```bash
# npx directly from GitHub (recommended for agents)
npx -y github:Adyel/bitbucket-code-review-mcp
```

Or clone and build locally:

```fish
git clone https://github.com/Adyel/bitbucket-code-review-mcp.git
cd bitbucket-code-review-mcp
nvm use 22
npm install   # auto-builds via `prepare` script
```

### Environment Variables

```bash
# Required
export BITBUCKET_EMAIL="your-atlassian-email@example.com"
export BITBUCKET_API_TOKEN="your-api-token"

# Optional defaults (avoids specifying in every tool call)
# These values come from your Bitbucket repo URL:
#   https://bitbucket.org/{workspace}/{repo_slug}
# e.g. https://bitbucket.org/acme-corp/backend-api
#   → BITBUCKET_DEFAULT_WORKSPACE=acme-corp
#   → BITBUCKET_DEFAULT_REPO_SLUG=backend-api
export BITBUCKET_DEFAULT_WORKSPACE="your-workspace"
export BITBUCKET_DEFAULT_REPO_SLUG="your-repo"

# Optional: customize the AI review tag (default: 🤖 AI Review)
# Set to empty string to disable tagging entirely: BITBUCKET_AI_TAG=""
export BITBUCKET_AI_TAG="🤖 AI Review"

# Optional: create comments as pending/draft (default: false)
# When true, comments are not published until the reviewer submits the review
export BITBUCKET_COMMENTS_PENDING=false
```

## 🔌 Agent Configuration

### Gemini CLI

Add to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "bitbucket-code-review": {
      "command": "npx",
      "args": ["-y", "github:Adyel/bitbucket-code-review-mcp"],
      "env": {
        "BITBUCKET_EMAIL": "your-atlassian-email@example.com",
        "BITBUCKET_API_TOKEN": "your-api-token",
        "BITBUCKET_DEFAULT_WORKSPACE": "your-workspace",
        "BITBUCKET_DEFAULT_REPO_SLUG": "your-repo"
      }
    }
  }
}
```

> **Local install alternative**: If you cloned the repo locally, replace the `command` and `args` with:
> ```json
> "command": "node",
> "args": ["/absolute/path/to/bitbucket-code-review-mcp/dist/index.js"]
> ```

### Antigravity / Other MCP Clients

```json
{
  "bitbucket-code-review": {
    "command": "npx",
    "args": ["-y", "github:Adyel/bitbucket-code-review-mcp"],
    "env": {
      "BITBUCKET_EMAIL": "your-atlassian-email@example.com",
      "BITBUCKET_API_TOKEN": "your-api-token",
      "BITBUCKET_DEFAULT_WORKSPACE": "your-workspace",
      "BITBUCKET_DEFAULT_REPO_SLUG": "your-repo"
    }
  }
}
```

## 🛠️ Available Tools

### PR Discovery

| Tool | Description |
|------|-------------|
| `list_pull_requests` | List PRs (filter by OPEN/MERGED/DECLINED/SUPERSEDED) |
| `get_pull_request` | Get a PR by `pr_id`, `branch`, or `url` (provide exactly one) |
| `get_pull_request_diff` | Get full diff text (large diffs truncated with a note) |
| `list_pull_request_files` | List changed files with add/remove counts |
| `get_file_content` | Read file content at a specific commit/branch/tag |

### Code Review Comments

| Tool | Description |
|------|-------------|
| `add_comment` | Add a comment — general (no `file_path`), inline (`file_path`+`line`), file-level (`file_path` only), or reply (`parent_id`) |
| `add_suggestion` | Post a code suggestion with optional `end_line` for multi-line spans |
| `add_comments` | Batch-post many comments (each routed like `add_comment`) |
| `update_comment` | Edit a comment — clean replace by default; `append=true` to append, `mark=true` for an `[Updated by AI]` marker |
| `delete_comment` | Delete a comment authored by this integration's own account |
| `list_comments` | List all comments |
| `set_comment_resolution` | Resolve (`resolved=true`) or reopen (`resolved=false`) a thread |

### Tasks

| Tool | Description |
|------|-------------|
| `create_task` | Create task (optionally linked to comment) |
| `list_tasks` | List all tasks |
| `update_task` | Update task state (OPEN/RESOLVED) |

Read-only tools (`list_*`, `get_*`) are annotated with `readOnlyHint`, and `delete_comment` with
`destructiveHint`, so MCP hosts can auto-approve reads and confirm deletes appropriately.

## 🔒 Safety Guards

- **Delete protection**: `delete_comment` deletes only comments authored by the account the API
  token authenticates as (checked via `GET /user`, cached). Bitbucket also enforces permission
  server-side, and a `403` is surfaced as a clear message.
- **Edit control**: `update_comment` cleanly replaces a comment by default. Pass `append=true` to
  keep the old body, and `mark=true` to add an `[✏️ Updated by AI]` marker when you want the edit
  to be visible.
- **Configurable tag**: Set `BITBUCKET_AI_TAG` to customize the `[🤖 AI Review]` prefix, or `""` to
  disable it. The tag is cosmetic — deletion no longer depends on it.
- **Pending comments**: Set `BITBUCKET_COMMENTS_PENDING=true` to create comments as drafts that are
  only published when the reviewer submits the review.

> **Token scope:** use an API token for the review bot's *own* account. The authorship check keys
> off that account, so an admin/shared token would let the bot delete comments authored by that
> same account across the repo.

## 🔀 Migrating from v1

| v1 tool / param | v2 replacement |
|---|---|
| `get_pull_request_by_branch` | `get_pull_request` with `branch` |
| `get_pull_request_from_url` | `get_pull_request` with `url` |
| `add_general_comment` | `add_comment` (omit `file_path`) |
| `add_inline_comment` | `add_comment` with `file_path` + `line` |
| `add_file_level_comment` | `add_comment` with `file_path` only |
| `reply_to_comment` | `add_comment` with `parent_id` |
| `add_inline_suggestion` | `add_suggestion` |
| `add_multiple_inline_comments` | `add_comments` |
| `resolve_comment` / `reopen_comment` | `set_comment_resolution` with `resolved` |
| `severity` parameter (all tools) | removed |
| `update_comment` (append-only) | replaces by default; opt into append with `append=true` |

## 🔄 Resilience & Pagination

- **Automatic pagination**: All list endpoints (`list_pull_requests`, `list_comments`, `list_pull_request_files`, `list_tasks`) automatically follow Bitbucket's `next` URLs to return complete results, even for large PRs. If the safety cap (200 pages) or a circular link is hit, a warning is logged to stderr.
- **Retry with backoff**: API requests automatically retry on HTTP 429 (rate limit) and 5xx (server errors) with exponential backoff, respecting `Retry-After` headers.

## 🎨 Comment Formatting

All comments are auto-tagged with the configurable `[🤖 AI Review]` prefix:

```
[🤖 AI Review]
Use optional chaining for safer property access.
```

Code suggestions use Bitbucket's native syntax and render an **Apply** button:

````
[🤖 AI Review] 💡 Suggestion
Use optional chaining here

```suggestion
const name = user?.name ?? 'default';
```
````

## 📁 Project Structure

```
src/
├── index.ts               # Entry point (Zod env validation, --version)
├── bitbucket-client.ts    # API client (auth, identity, pagination, retry, truncation)
├── comment-formatter.ts   # Comment formatting & AI tag
├── schemas/
│   └── shared.ts          # Shared Zod input schemas
├── utils/
│   └── response.ts        # Response helpers & error handling
└── tools/
    ├── index.ts            # Tool registration entry point
    ├── pr-discovery.ts     # PR lookup, diff, file content
    ├── comments.ts         # add/update/delete/list/resolve comments
    ├── tasks.ts            # Task create/list/update
    └── bulk.ts             # Batch comments (add_comments)
```

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, adding tools, and the release process.

## CLI

```bash
node dist/index.js --version   # Print version and exit
```

## License

MIT
