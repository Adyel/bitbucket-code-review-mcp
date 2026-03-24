# Contributing to Bitbucket Code Review MCP

Thanks for your interest in contributing! 🎉

## Development Setup

```bash
git clone https://github.com/Adyel/bitbucket-code-review-mcp.git
cd bitbucket-code-review-mcp
nvm use 22
npm install   # auto-builds via `prepare` script
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Watch mode for development |
| `npm test` | Run all unit tests (vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint source with ESLint |
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check formatting without writing |

## Project Structure

```
src/
├── index.ts               # Entry point (env validation, --version)
├── bitbucket-client.ts    # API client (auth, pagination, retry)
├── comment-formatter.ts   # Comment formatting & AI tag guards
├── schemas/
│   └── shared.ts          # Shared Zod input schemas
├── utils/
│   └── response.ts        # Response helpers & error handling
└── tools/
    ├── index.ts            # Tool registration entry point
    ├── pr-discovery.ts     # PR listing, diff, file content tools
    ├── comments.ts         # Inline, file-level, general comments
    ├── tasks.ts            # Task create/list/update
    └── bulk.ts             # Batch inline comments

tests/
├── comment-formatter.test.ts
├── bitbucket-client.test.ts
└── response.test.ts
```

## Adding a New Tool

1. Identify the domain module in `src/tools/` (or create a new one)
2. Add your tool using `server.registerTool()` with:
   - Zod schemas from `src/schemas/shared.ts`
   - `withErrorHandling()` wrapper from `src/utils/response.ts`
   - `toolResponse()` / `toolTextResponse()` for outputs
3. If you created a new module, register it in `src/tools/index.ts`
4. Add the API call in `src/bitbucket-client.ts` if needed
5. Update `README.md` tools table
6. Write tests in `tests/`

## Pull Request Process

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make your changes
3. Run `npm run lint && npm test && npm run build` to verify
4. Commit using [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` for new features
   - `fix:` for bug fixes
   - `refactor:` for code restructuring
   - `docs:` for documentation
   - `test:` for tests
5. Push and open a PR against `main`

## Releasing

This project uses [release-please](https://github.com/googleapis/release-please) for automated releases:

1. Merge PRs with [Conventional Commits](https://www.conventionalcommits.org/) into `main`
2. Release-please auto-creates a "Release PR" with version bump + CHANGELOG
3. Merge the Release PR to publish the release and create a git tag

No manual version bumping needed — just follow the commit conventions.

## Code Style

- TypeScript strict mode
- ESLint + Prettier (run `npm run format` before committing)
- Use Zod for all input validation
- Wrap all tool handlers with `withErrorHandling()`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
