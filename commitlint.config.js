'use strict';

// Phase 0 task P0.B of docs/execution-plan.md.
//
// Enforces Conventional Commits 1.0.0 on every PR via the commitlint check
// in .github/workflows/commitlint.yml. Without this, the release-please
// workflow on main would still work, but mis-shaped commits would silently
// drop out of CHANGELOG.md — promise without enforcement, the exact
// anti-pattern docs/execution-plan.md §2 standing order 4 rules out.
//
// Allowed types are the conventional-commits standard set + `sec` for
// security fixes (first-class section in CHANGELOG.md so compliance
// reviewers can see the security history at a glance).
//
// Header length capped at 100 chars: long enough for a clear subject,
// short enough to render in GitHub's PR list, commit log, and the
// generated changelog without truncation.

module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'perf',
        'sec',
        'refactor',
        'revert',
        'docs',
        'test',
        'build',
        'ci',
        'chore',
        'style',
      ],
    ],
    'header-max-length': [2, 'always', 100],
    'subject-case': [0],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
