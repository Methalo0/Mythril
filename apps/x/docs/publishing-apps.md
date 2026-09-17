# Publishing Mythril Apps — advanced path

Most authors should use the in-app guided publish (Apps → app detail →
Publish): it creates the repo, pushes source, cuts the release, and registers
the app automatically. This doc is for developers who manage their own repo,
build pipeline, or monorepo and want to publish releases themselves.

## The bundle format (`.mythril-app`)

A `.mythril-app` file is a ZIP named `<name>.mythril-app` containing, at the
archive root (relative, forward-slash paths):

```
mythril-app.json        # the manifest (required)
dist/**                 # browser-ready static files (required; dist/<entry> must exist)
agents/<file>.yaml      # only files listed in manifest.agents
defaults/**             # optional starter data, copied to data/ on first install
```

Rules:

- Never include `src/`, `package.json`, `node_modules/`, `data/`, dotfiles, or
  `.mythril-*.json`. Installers enforce size limits (100 MB compressed, 500 MB
  uncompressed, 10,000 entries) and reject symlink entries and unsafe paths.
- `manifest.name` must match the bundle filename stem and, once registered,
  never changes. `version` is strict semver (`MAJOR.MINOR.PATCH`).
- Agent definitions may contain ONLY `name`, `instructions`, `triggers` —
  runtime state, `active`, and model overrides are rejected.

## The two-asset requirement

Every release on a registered repo MUST attach **both** assets:

1. `<name>.mythril-app` — the bundle
2. `mythril-app.json` — a standalone copy of the manifest

The standalone manifest powers Mythril's quota-free update check (it is
fetched via `releases/latest/download/mythril-app.json`).

## Tag convention

Tag releases `v<version>` (e.g. `v1.2.0`), matching `manifest.version`.

## Registry record

The registry (`mythrillabs/apps-registry`) holds one record per app at
`apps/<name>.json`:

```json
{
  "schemaVersion": 1,
  "name": "my-app",
  "owner": "your-github-login",
  "repo": "your-github-login/my-app",
  "description": "What the app does",
  "iconUrl": "https://raw.githubusercontent.com/you/my-app/HEAD/dist/icon.png",
  "createdAt": "2026-07-06T00:00:00Z"
}
```

Register either via the in-app form (Apps → Catalog → Register existing
release) or by opening the one-file PR yourself. A validation Action checks:
the PR adds exactly that one file; the name is valid, unique, and not retired;
`owner` equals the PR author; the author has push access to `repo`; and
`releases/latest/download/<name>.mythril-app` exists. It auto-merges on
success or closes the PR with a `rejected: <code>` comment.

## The latest-release constraint (monorepos)

Version discovery always reads the repo's **latest** release. A monorepo
registering multiple apps therefore works only if **every** release attaches
**every** registered app's asset pair — otherwise resolution for the other
apps breaks whenever any one app releases. One repo per app avoids this
entirely and is what the guided path does.
