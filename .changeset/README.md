# Changesets

This repo uses [changesets](https://github.com/changesets/changesets) for `@syncro/sdk` and `@syncro/shared`.

1. After changing a publishable package, run `npx changeset` and commit the file under `.changeset/`.
2. PRs that touch `sdk/` or `shared/` without a changeset fail CI.
3. Version bumps and changelog entries are generated on the release workflow — do not edit package versions or `CHANGELOG.md` by hand for those packages.
4. Publishing happens only from CI (`CI=true`) with npm provenance. Local `npm publish` is rejected.
