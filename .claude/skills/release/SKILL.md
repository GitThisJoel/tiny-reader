---
name: release
description: Cut a Tiny Reader release - bump the version, run every check, build the add-on and source packages, prove the source package rebuilds to the same files, tag it, create the GitHub release, and hand the packages to the user to upload to addons.mozilla.org. Use when asked to release, publish or tag a version.
argument-hint: "[version, for example 0.2.0]"
disable-model-invocation: true
---

# Releasing Tiny Reader

A release is a version bump merged to `main`, a tag, a GitHub release, and two zip files the user uploads to
addons.mozilla.org (AMO).
You prepare everything; **the user uploads**. Never submit to AMO yourself, and ask before pushing a tag or creating a
GitHub release.

Run pnpm as `npx -y pnpm@12.21.0 <command>` where `pnpm` is not installed.

## 1. Decide the version

- The version lives in one place: `version` in `package.json`. The manifest and the zip names follow it.
- Use the version the user gave. Otherwise look at the commits since the last tag (`git describe --tags --abbrev=0`,
  then `git log <tag>..HEAD --oneline`; with no tag yet, the whole history): any `feat` means a new minor version,
  only `fix` and smaller means a patch. Say which you chose and why.
- AMO refuses a version that is not higher than the last one uploaded.

## 2. Bring the rest in line

On a branch `release/vX.Y.Z` from an up-to-date `main` with a clean working tree:

- Set `version` in `package.json`.
- If `onnxruntime-web`, `pdfjs-dist` or `wxt` changed in `package.json`, or a pinned revision changed in
  `scripts/fetch-assets.ts`, update the table in `THIRD-PARTY-NOTICES.md`.
- If the popup changed (`entrypoints/popup/`, `content/settings-form.*`), redraw its pictures: `pnpm build`, then
  `pnpm screenshots`.
- If this is the first version to be published, replace the sentence in the README's "Trying it" that says the
  add-on is not on addons.mozilla.org yet.

## 3. Run every check

All of these must pass. Report any failure with its output and stop.

```bash
pnpm install --frozen-lockfile
pnpm fetch-assets
pnpm lint
pnpm typecheck
pnpm test
pnpm test:parity
pnpm test:smoke
pnpm build
pnpm test:e2e
pnpm lint:ext
```

`pnpm lint:ext` must report 0 errors. Four warnings are known and accepted (they are listed in CONTRIBUTING.md); a
new one needs explaining to the reviewer.

## 4. Build the packages and prove the source package

```bash
pnpm zip
```

This writes `.output/tiny-reader-X.Y.Z-firefox.zip` (the add-on) and `.output/tiny-reader-X.Y.Z-sources.zip` (for
the reviewer). AMO's reviewer rebuilds from the source package, so check that it gives the same files:

```bash
CLEAN=$(mktemp -d)
unzip -q .output/tiny-reader-X.Y.Z-sources.zip -d "$CLEAN"
(cd "$CLEAN" && pnpm install --frozen-lockfile && pnpm fetch-assets && pnpm build)
diff <(cd "$CLEAN/.output/firefox-mv3" && find . -type f | sort | xargs sha256sum) \
     <(cd .output/firefox-mv3 && find . -type f | sort | xargs sha256sum) && echo IDENTICAL
```

It must print `IDENTICAL`. If it does not, something the build needs is missing from the source package (see
`zip.excludeSources` in `wxt.config.ts`) or is not pinned.

## 5. Merge, then tag

- Commit as `chore(release): vX.Y.Z`, push the branch and open a pull request. Wait for CI and for the user to merge.
- After the merge, on the updated `main`: `git tag -a vX.Y.Z -m "vX.Y.Z"`, and with the user's go-ahead
  `git push origin vX.Y.Z`.
- Rebuild the packages from the tagged commit (`pnpm zip`) so that what is uploaded is exactly the tag.

## 6. Write the release notes

A short list of what changed since the last release, taken from the `feat` and `fix` commits and written for users,
not developers: what they can now do, and what no longer goes wrong. Leave out refactoring, tests, tooling and docs.
The same text goes to addons.mozilla.org and to GitHub.

## 7. Create the GitHub release

With the user's go-ahead, from the tag, with the add-on package attached:

```bash
gh release create vX.Y.Z .output/tiny-reader-X.Y.Z-firefox.zip --verify-tag --title "vX.Y.Z" --notes-file NOTES.md
```

`NOTES.md` is a temporary file outside the repository holding the release notes, followed by this line: "Install
Tiny Reader from addons.mozilla.org. The attached package is unsigned, so Firefox only loads it as a temporary
add-on." Until the add-on is listed there, say that instead.

## 8. Hand over

Tell the user:

- the two files to upload and their sizes: the add-on package first, the source package when the form asks for
  source code;
- the release notes, to paste into the form;
- anything a reviewer will ask about that is new in this version: a new permission, a new bundled library, a new
  linter warning;
- the choices on the form that stay the same: Firefox for desktop only, licence Apache-2.0, no data collected;
- the link to the GitHub release.
