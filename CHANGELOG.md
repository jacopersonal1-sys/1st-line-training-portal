# Changelog

## 2.6.15 - 2026-04-13

- Fix: Vetting Arena persistent compliance overlay that blocked Enter/Start after auto-submission.
- Fix: Defensive parsing for localStorage to avoid JSON.parse('undefined') crashes.
- Sync: Improvements to tombstone / pending-delete handling to prevent ghost data.

## Notes for release

1. This release bumps `package.json` to `2.6.15`.
2. Build artifacts using `npm run dist` and publish via your existing GitHub Releases pipeline.
3. After publishing, bump `system_config.min_version` if you want to force clients to update immediately.

## Quick build & publish commands

```bash
# create a release branch locally
git checkout -b release/v2.6.15

# install and build (run in CI or a build machine with Node/Electron configured)
npm ci
npm run dist

# push branch and create GitHub release (CI or manual)
git add package.json CHANGELOG.md
git commit -m "chore(release): 2.6.15 - vetting arena + sync fixes"
git push --set-upstream origin release/v2.6.15
# then create a GitHub Release with the built installer assets
```

If you want, I can attempt to create the branch and commit locally here and prepare the artifacts, but publishing requires your CI/GitHub credentials.