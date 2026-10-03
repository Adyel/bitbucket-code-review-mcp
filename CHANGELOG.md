# Changelog

## [2.1.1](https://github.com/Adyel/bitbucket-code-review-mcp/compare/v2.1.0...v2.1.1) (2026-10-03)


### Bug Fixes

* drop the Suggestion label from code suggestions ([#8](https://github.com/Adyel/bitbucket-code-review-mcp/issues/8)) ([773cef6](https://github.com/Adyel/bitbucket-code-review-mcp/commit/773cef643cc562d828eda94d528eb69634828c2a))

## [2.1.0](https://github.com/Adyel/bitbucket-code-review-mcp/compare/v2.0.0...v2.1.0) (2026-09-30)


### Features

* add get_review_activity tool ([10f435b](https://github.com/Adyel/bitbucket-code-review-mcp/commit/10f435b3c6f88474d5d36643b5482806b2cc3321))


### Bug Fixes

* respect Bitbucket pagelen limit on pullrequests list ([#5](https://github.com/Adyel/bitbucket-code-review-mcp/issues/5)) ([c64a3bd](https://github.com/Adyel/bitbucket-code-review-mcp/commit/c64a3bd737e5c174f61dea83fbd2666870de501c))

## [2.0.0](https://github.com/Adyel/bitbucket-code-review-mcp/compare/v1.0.0...v2.0.0) (2026-07-08)


### ⚠ BREAKING CHANGES

* several tools were removed or renamed and the `severity` parameter was dropped. Migration:   - get_pull_request_by_branch / get_pull_request_from_url       -> get_pull_request (branch / url)   - add_general_comment / add_inline_comment / add_file_level_comment /     reply_to_comment       -> add_comment (routes on file_path / line / parent_id)   - add_inline_suggestion        -> add_suggestion   - add_multiple_inline_comments -> add_comments   - resolve_comment / reopen_comment -> set_comment_resolution (resolved bool)   - severity parameter           -> removed

### Features

* lean v2 redesign — consolidate tools, fix delete/update, drop severity ([e8b0b60](https://github.com/Adyel/bitbucket-code-review-mcp/commit/e8b0b604cbdae9b541b39757a5c763ab018aad2d))

## 1.0.0 (2026-04-20)


### Features

* Bitbucket Code Review MCP Server ([342b883](https://github.com/Adyel/bitbucket-code-review-mcp/commit/342b8833b780dad1160a0ff4970855d5143640c3))
* Bitbucket Code Review MCP Server — Initial Implementation ([0c2854a](https://github.com/Adyel/bitbucket-code-review-mcp/commit/0c2854abf4a64f2e3f0060eac155dba60d0fb617))
* optimize pagination with max page size and implement safety limits to prevent infinite loops ([c9b42fc](https://github.com/Adyel/bitbucket-code-review-mcp/commit/c9b42fc1f51f2a14a9247368ede7ef35a6984726))
* pagination, retry, multi-line suggestions, --version, release-please ([d74e3c1](https://github.com/Adyel/bitbucket-code-review-mcp/commit/d74e3c1c2e7be9d737054dd9d513c26349ec196c))


### Bug Fixes

* add eslint.config.js to gitignore exclusion ([0acdbf0](https://github.com/Adyel/bitbucket-code-review-mcp/commit/0acdbf07885cfecff770926a9d4a71eae8e1edbd))
