# Repository policy

This private repository intentionally avoids GitHub rulesets and legacy branch-protection features
that require a GitHub Pro subscription.

Changes are developed on `codex/*` branches and merged through pull requests. Before merging,
confirm that these existing GitHub Actions checks pass:

- `quality`
- `smoke (windows-latest)`
- `smoke (macos-latest)`

Use a linear merge strategy such as squash or rebase, do not force-push or delete `main`, and keep
release tags on commits already merged to `main`. These are project conventions rather than
server-enforced paid features.
