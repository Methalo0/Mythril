# Mythril

By **MetHalo11885260**. A private, local-first desktop AI client.

- **No accounts, no sign-in** — everything runs on your own API keys.
- **NVIDIA NIM provider** — first-class provider (`https://integrate.api.nvidia.com/v1`) with `moonshotai/kimi-k3` as the default chat model.
- **Cloudflare Workers AI provider** — custom integration (account ID + API token), full paginated model catalog, chat + image models, optional paid-model listing.
- **Multi-key rotation** — add several keys per provider (comma-separated or via the Manage dialog); requests rotate across them. NVIDIA keys are capped at 35 req/min per key (NIM's limit is 40); 429/401 responses rotate to the next key automatically.
- **Effort levels** — low / normal / high / xhigh / ultrahigh, mapped per provider.
- **MCP servers, skills, plugins, connectors** — built in.
- Chat history, knowledge base ("Brain"), background agents, projects, apps — all local.

Mythril is derived from the open-source Rowboat project (Apache 2.0, © Rowboat Labs) — see LICENSE.

## Layout

- `apps/x` — the desktop app (Electron; pnpm monorepo: apps/{main,renderer,server,preload}, packages/{core,client,shared})
- `apps/harbor` — spaces protocol package (build dependency only)

## Build

```bash
cd apps/harbor && pnpm install --filter @mythril/spaces-protocol && (cd packages/protocol && pnpm run build)
cd ../x && pnpm install
# build order: shared → core → server → client → preload → main → renderer
```

## Package (Windows MSI)

```bash
cd apps/x/apps/main
npx electron-forge package --platform win32   # → out/Mythril-win32-x64
node build-msi.mjs                            # → release/Mythril-<version>.msi
```

The MSI installs per-user to `%LocalAppData%\Mythril` (no admin needed) with Desktop + Start Menu shortcuts.

## Data

Everything lives in `~/.mythril` (config, knowledge base, chats).
