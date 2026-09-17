# Mythril — Design Spec

**Owner:** MetHalo11885260 · **Date:** 2026-09-14 · **Status:** Approved

## 1. Overview

Mythril is a Windows desktop AI chat application in the style of Claude Desktop. It talks exclusively to NVIDIA NIM (`https://integrate.api.nvidia.com/v1`, OpenAI-compatible) and rotates across a pool of user-supplied API keys to multiply the effective 40 RPM per-key rate limit. Ships as an MSI installer.

**Non-goals / explicit exclusions:**
- No telemetry or exfiltration of user API keys to any remote server. Keys stay on the user's machine (rejected feature).
- No privilege escalation to SYSTEM. File tools run with the launching user's permissions, matching Claude Desktop's model.
- Rust is not used anywhere.

## 2. Tech Stack

- **Electron** (latest stable) + **TypeScript**
- **React 18** + Vite for the renderer UI
- **electron-builder** with the WiX target → MSI installer
- **better-sqlite3** for local persistence
- **keytar**-style storage via Electron `safeStorage` (DPAPI) for API keys
- **@modelcontextprotocol/sdk** for MCP client support

## 3. Architecture

```
┌──────────────────────────── Electron Main Process ───────────────────────────┐
│  KeyPoolManager    RateLimiter    NimClient    McpHost    ToolRunner          │
│  ChatStore (SQLite)  SettingsStore   SkillLoader   PluginHost                 │
└───────────────▲──────────────────────────────────────────────────────────────┘
                │ IPC (typed channels, contextBridge)
┌───────────────┴──────────────── Renderer (React) ────────────────────────────┐
│  Sidebar (chat list)  ChatView  Composer  UsageTab  Settings  McpPanel       │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Key Pool & Validation
- Keys are added in Settings. On add:
  1. Format check: `nvapi-` prefix, plausible length.
  2. Live validation: `POST /v1/chat/completions` with model `moonshotai/kimi-k3`, 1-token request; expect HTTP 200. On 200 → stored; on 401/403 → rejected with message.
- Keys are encrypted with Electron `safeStorage` (Windows DPAPI) and stored in SQLite `keys` table. Never logged, never transmitted anywhere except `integrate.api.nvidia.com`.
- Pool capacity displayed as `40 × N keys` RPM.

### 3.2 Rate Limiter
- Sliding 60-second window **per key**, hard cap **35 requests** (5 RPM safety margin).
- Request routing: pick the key with the most remaining capacity; ties → least recently used.
- If every key is at 35: the request queues and is dispatched the moment the oldest request in any window ages past 60 s.
- Each request's slot frees exactly 60 s after it was made (per-request expiry, not bucket reset).
- On HTTP 429 from NIM: mark that key saturated, retry on the next key automatically.
- Usage state is broadcast to the renderer every **500 ms**; Usage tab shows per-key `used/40` and pool total (e.g. "35 / 400 RPM (10 keys)").

### 3.3 Models & Effort
- Model list fetched live from `GET /v1/models`; default chat model `moonshotai/kimi-k3`.
- Image generation uses a separate, user-selectable image model (placeholder slot until the user picks one).
- Per-chat effort selector: **low / normal (default) / high / xhigh / ultrahigh**, mapped to max_tokens + thinking budget:
  | Level | max_tokens | Notes |
  |---|---|---|
  | low | 1,024 | terse |
  | normal | 4,096 | default |
  | high | 16,384 | |
  | xhigh | 32,768 | |
  | ultrahigh | 65,536 | + reasoning params where the model supports them |

### 3.4 Chats & Memory
- New empty chat on every app launch; previous chats listed in a collapsible left sidebar, restorable.
- SQLite tables: `chats`, `messages`, `keys`, `settings`, `mcp_servers`, `skills`, `plugins`, `memory`.
- A `memory` store holds user facts/preferences the assistant can write to via a built-in tool; injected into the system prompt each turn.

### 3.5 Tools, MCP, Skills, Plugins
- **Built-in tools**: filesystem read/write/list/search across the whole drive (user's permissions), shell exec (with per-command approval prompt), memory read/write.
- **MCP client**: stdio servers (command + args + env, like Claude Desktop's config) and remote HTTP/SSE servers; manageable from an MCP settings panel; tools merged into the model's tool list.
- **Skills**: a user folder (`%APPDATA%/Mythril/skills/`) of markdown skill files with frontmatter; listed in UI, toggleable, injected into context when active.
- **Plugins**: JS modules in `plugins/` with a `manifest.json` (name, version, permissions); loaded in a sandboxed context; can register tools and UI panels. Permission prompts on first use.

### 3.6 UI (Renderer)
Claude Desktop-style layout:
- Left sidebar: chat history, New Chat button, collapsible.
- Main: chat view with streaming markdown responses, tool-call indicators.
- Composer: model picker, effort dropdown, send.
- Tabs/pages: Usage (live RPM gauges), MCP Servers, Skills & Plugins, Settings (keys, defaults, image model).

### 3.7 Packaging
- electron-builder → `msi` target (WiX), appId `com.methalo11885260.mythril`, product name **Mythril**, per-user install, desktop shortcut, auto-launch option.

## 4. Error Handling
- NIM errors surfaced inline in chat (401 → "key rejected", 429 handled silently by rotation, 5xx → retry once then report).
- Queue overflow (all keys saturated >2 min) → visible "waiting for rate limit" indicator in composer.
- SQLite corruption → automatic backup + rebuild prompt.

## 5. Testing
- Unit: rate limiter window math, key rotation order, effort mapping (Vitest).
- Integration: mock NIM server (nock/msw) for validation + rotation + 429 fallback.
- E2E smoke: Playwright Electron launch → add mock key → send chat → verify streaming render.
