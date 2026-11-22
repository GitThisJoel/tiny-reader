---
name: release
description: Cut a Tiny Reader release - bump the version, run every check, build the add-on and source packages, prove the source package rebuilds to the same files, tag it, create the GitHub release, and hand the packages to the user to upload to addons.mozilla.org. Use when asked to release, publish or tag a version.
argument-hint: "[major | minor | patch]"
disable-model-invocation: true
---

# Releasing Tiny Reader

A release is a version bump merged to `main`, a tag, a GitHub release, and two zip files the user uploads to
addons.mozilla.org (AMO).
You prepare everything; **the user uploads**. Never submit to AMO yourself, and ask before pushing a tag or creating a
GitHub release.

Run pnpm as `npx -y pnpm@12.21.0 <command>` where `pnpm` is not installed. `pnpm build-espeak` needs Docker.

## 1. Decide the version

The bump asked for: `$ARGUMENTS` (one of `major`, `minor`, `patch`).

- The version lives in one place: `version` in `package.json`, as `major.minor.patch`. The manifest and the zip names
  follow it.
- Raise the part asked for by one and set the parts after it to zero: `patch` 1.2.3 → 1.2.4, `minor` 1.2.3 → 1.3.0,
  `major` 1.2.3 → 2.0.0.
- With no tag yet (`git describe --tags --abbrev=0` fails), nothing has been released: release the version that is
  already in `package.json`, whatever the argument, and say so. There is nothing to ask.
- With no argument, or one that is none of the three, ask the user which part to bump and wait for the answer. Do
  not choose for them.
- AMO refuses a version that is not higher than the last one uploaded.

## 2. Bring the rest in line

On a branch `release/vX.Y.Z` from an up-to-date `main` with a clean working tree:

- Set `version` in `package.json`.
- If `onnxruntime-web`, `pdfjs-dist` or `wxt` changed in `package.json`, or a pinned revision changed in
  `scripts/fetch-assets.ts` or `scripts/build-espeak.sh`, update the table in `THIRD-PARTY-NOTICES.md`.
- If a model was added to or changed in `engine/models.ts`, bring the table of models in the README in line.
- If the popup changed (`entrypoints/popup/`, `content/settings-form.*`), redraw its pictures: `pnpm build`, then
  `pnpm screenshots`.

## 3. Run every check

All of these must pass. Report any failure with its output and stop.

```bash
pnpm install --frozen-lockfile
pnpm fetch-assets
pnpm build-espeak
pnpm lint
pnpm typecheck
pnpm test
pnpm test:parity
pnpm test:smoke
pnpm build
pnpm test:e2e
pnpm lint:ext
```

`pnpm build-espeak` fails when what it built is not the recorded build (`scripts/espeak.sha256`). If it does, stop
and report it: the reviewer's rebuild would differ too. Never pass `--allow-different` for a release.

`pnpm lint:ext` must report 0 errors. Three warnings are known and accepted (they are listed in CONTRIBUTING.md); a
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
(cd "$CLEAN" && pnpm install --frozen-lockfile && pnpm fetch-assets && pnpm build-espeak && pnpm build)
diff -r "$CLEAN/.output/firefox-mv3" .output/firefox-mv3 && echo IDENTICAL
```

It must print `IDENTICAL`. If it does not, something the build needs is missing from the source package (see
`zip.excludeSources` in `wxt.config.ts`) or is not pinned.

## 5. Merge, then tag

- Commit as `chore(release): vX.Y.Z`, push the branch and open a pull request. Wait for CI and for the user to merge.
- After the merge, tag the release's merge commit, which is `main`'s newest commit unless something else was merged
  since: `git tag -a vX.Y.Z -m "vX.Y.Z" <merge commit>`, and with the user's go-ahead `git push origin vX.Y.Z`.
- Rebuild the packages from the tagged commit (`pnpm zip`) so that what is uploaded is exactly the tag.

## 6. Write the release notes

A short list of what changed since the last release, taken from the `feat` and `fix` commits and written for users,
not developers: what they can now do, and what no longer goes wrong. Leave out refactoring, tests, tooling and docs.
The same text goes to addons.mozilla.org and to GitHub.

## 7. Create the GitHub release

With the user's go-ahead, from the tag, with the add-on package attached:

```bash
NOTES=$(mktemp)
gh release create vX.Y.Z .output/tiny-reader-X.Y.Z-firefox.zip --verify-tag --title "vX.Y.Z" --notes-file "$NOTES"
```

Write the release notes into `$NOTES` first, followed by one of these lines:

- once the add-on is listed: "Install Tiny Reader from addons.mozilla.org. The attached package is unsigned, so
  Firefox only loads it as a temporary add-on."
- before that: "Tiny Reader is awaiting review at addons.mozilla.org. The attached package is unsigned, so Firefox
  only loads it as a temporary add-on."

## 8. Hand over

Tell the user:

- the two files to upload and their sizes: the add-on package first, the source package when the form asks for
  source code;
- the release notes, to paste into the form;
- anything a reviewer will ask about that is new in this version: a new permission, a new bundled library, a new
  linter warning, a new model or host in the list of downloads;
- that the reviewer needs Docker to rebuild the add-on, for `pnpm build-espeak`: say so in the notes to the reviewer;
- the choices on the form that stay the same: Firefox for desktop only, licence GPL-3.0-or-later, no data collected;
- the link to the GitHub release;
- for the first release: once Mozilla has listed the add-on, the README's "Trying it" still says it is not on
  addons.mozilla.org and needs changing then.
