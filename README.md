# 🔍 Bitbucket Code Review MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that enables AI agents like **Gemini CLI** and **Antigravity** to post well-formatted code review comments on **Bitbucket Cloud** pull requests.

> **The MCP does NOT review code itself** — it provides tools for agents to create comments tagged with `[🤖 AI Review]` that a human reviewer will review and approve.

## ✨ Features

| Category | Tools |
|----------|-------|
| **PR Discovery** | List PRs, get by ID/branch/URL, view diff, list changed files |
| **Inline Comments** | Post on specific lines with severity emojis (💡⚠️🐛📝🔒) |
| **Code Suggestions** | Use Bitbucket's `/suggest` syntax — one-click apply for PR authors |
| **File & General Comments** | File-level and PR-wide comments |
| **Comment Management** | Reply, update (with marker), delete (AI-only guard), resolve/reopen |
| **Pending Comments** | Create comments as draft — not published until reviewer submits review |
| **Tasks** | Create, list, update tasks on PRs |
| **Bulk Operations** | Post multiple inline comments in one call |

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
| `get_pull_request` | Get PR details by ID |
| `get_pull_request_by_branch` | Find PR by source branch name |
| `get_pull_request_from_url` | Parse a Bitbucket PR URL → get details |
| `get_pull_request_diff` | Get full diff text |
| `list_pull_request_files` | List changed files with add/remove counts |

### Code Review Comments

| Tool | Description |
|------|-------------|
| `add_general_comment` | Post PR-level comment |
| `add_inline_comment` | Post on a specific file:line with optional severity |
| `add_inline_suggestion` | Post a code suggestion (one-click apply in Bitbucket) |
| `add_file_level_comment` | Post file-level comment |
| `reply_to_comment` | Reply to a comment thread |
| `update_comment` | Update any comment with additional context (appends `[✏️ Updated by AI]`) |
| `delete_comment` | Delete AI comment only (human comments protected) |
| `list_comments` | List all comments |
| `resolve_comment` | Resolve a thread |
| `reopen_comment` | Reopen a thread |
| `add_multiple_inline_comments` | Batch post inline comments |

### Tasks

| Tool | Description |
|------|-------------|
| `create_task` | Create task (optionally linked to comment) |
| `list_tasks` | List all tasks |
| `update_task` | Update task state (OPEN/RESOLVED) |

## 🔒 Safety Guards

- **Delete protection**: `delete_comment` fetches the comment first and checks for the `[AI Review]` tag. Human comments cannot be deleted through this MCP.
- **Update traceability**: `update_comment` works on any comment (AI or human) but always appends an `[✏️ Updated by AI]` marker so every change is traceable.
- **Configurable tags**: Set `BITBUCKET_AI_TAG` env var to customize the tag, or set to `""` to disable tagging entirely.
- **Pending comments**: Set `BITBUCKET_COMMENTS_PENDING=true` to create comments as drafts that are only published when the reviewer submits the review.

## 🎨 Comment Formatting

All comments are auto-tagged and support severity levels:

```
[🤖 AI Review] 💡 Suggestion
Use optional chaining for safer property access.

[🤖 AI Review] 🐛 Bug
This will throw a NullPointerException when `user` is null.

[🤖 AI Review] 🔒 Security
SQL injection risk — use parameterized queries.
```

Code suggestions use Bitbucket's native syntax:

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
├── index.ts              # MCP server entry point
├── bitbucket-client.ts   # Bitbucket Cloud REST API client
├── tools.ts              # MCP tool definitions (Zod schemas)
└── comment-formatter.ts  # Comment formatting & AI tag guards
```

## License

MIT
