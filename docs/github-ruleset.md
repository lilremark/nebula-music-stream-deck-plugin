# Main branch ruleset

Configure the private repository's `main` ruleset with:

- pull requests required, with zero mandatory approvals for solo development;
- required `quality` and both `smoke` matrix checks from `ci.yml`;
- linear history required;
- force pushes and branch deletion blocked;
- repository administrators included unless emergency bypass is explicitly needed.

The initial implementation branch is `codex/initial-plugin`. Releases are made only from tagged
commits already merged to `main`.
