# GitHub rulesets

This public repository uses repository-level branch and tag rulesets supported by GitHub Free.

The `main` ruleset:

- requires a pull request, with zero mandatory approvals for solo development;
- requires `quality`, `smoke (macos-latest)`, and `smoke (windows-latest)` from `ci.yml`;
- requires the branch to be current before merging and all review conversations to be resolved;
- requires linear history; and
- blocks force pushes and branch deletion, including for repository administrators.

The `Release tags` ruleset targets `v*` tags and blocks tag deletion or non-fast-forward updates.
It does not restrict tag creation, allowing the release owner to create a new version after its
release commit has passed CI and merged to `main`.
