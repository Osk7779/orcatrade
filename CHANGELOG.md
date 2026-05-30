# Changelog

All notable changes to OrcaTrade are recorded here. This file is **managed
by [release-please](https://github.com/googleapis/release-please)** —
manual edits between releases will be overwritten on the next release.

## How releases work

1. Conventional-commit messages on `main` (`feat:`, `fix:`, `perf:`, `sec:`,
   `refactor:`, etc) are scanned by `.github/workflows/release-please.yml`.
2. A **Release PR** is opened (or updated) that proposes a SemVer bump and
   appends a new changelog section.
3. When the Release PR merges, a tag is cut, a GitHub Release is published,
   and `CHANGELOG.md` is updated in place.

A human-facing styled page mirrors highlights at
[`/changelog/`](changelog/index.html) and is curated manually for editorial
quality; this file is the canonical machine record.

## Commit types that produce changelog entries

| Type | Section | SemVer bump |
|---|---|---|
| `feat:` | Features | minor |
| `fix:` | Bug Fixes | patch |
| `perf:` | Performance | patch |
| `sec:` | Security | patch |
| `refactor:` | Code Refactoring | patch |
| `revert:` | Reverts | patch |
| `BREAKING CHANGE:` footer or `feat!:` | (per type) | major |

Other types (`chore`, `docs`, `test`, `ci`, `build`, `style`) are valid
conventional commits and pass commitlint, but do not produce a changelog
entry by default. Use them when the change is not user-visible.

## [1.0.0] — initial state

Pre-`release-please` state of the platform. Subsequent entries will be
added by release-please from this point forward.
