git checkout -b release/v2.6.15
npm ci
git add package.json CHANGELOG.md
git commit -m "chore(release): 2.6.15 - vetting arena + sync fixes"
git push --set-upstream origin release/v2.6.15
# Changelog

## 2.6.15 - 2026-04-13

- Bug fixes.

> Build artifacts and publish as usual. See `package.json` for build scripts.