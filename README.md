# opencode-session-inspector

Offline session analysis tool for opencode. Reads the local opencode database
(**opencode.db**, SQLite) directly and lets you manage, analyze and export sessions
through a clean web UI: **open, search, delete, export**.

- No opencode daemon required; purely local, read-only by default.
- Fully reproduces the **user ↔ agent interaction**: assistant replies, chain-of-thought
  `reasoning`, every tool call with its complete input/output/error, step lifetime,
  diff/file/subtask/compaction/retry markers, plus token and cost metrics.
- Supports both storage layouts: legacy V1 tables (`message` + `part`) and the V2
  projection (`session_message` + `session_input`) with automatic fallback.

## Table of contents

- [Features](#features)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [List page](#list-page)
- [Session detail page](#session-detail-page)
- [HTML export](#html-export)
- [Database path resolution](#database-path-resolution)
- [Technical notes](#technical-notes)
- [Directory layout](#directory-layout)

## Features

| Capability | Description |
|---|---|
| Open session | Server-rendered full interaction timeline, showing every user/agent exchange as items |
| Search & filter | Filter sessions by title / directory / agent / model / time range |
| Delete session | Transactional delete with foreign-key cascade plus best-effort cleanup of per-session files; shared snapshots are never touched |
| Export HTML | Downloads the session as **a single self-contained HTML file** that fully reproduces the interaction, for archiving and analysis |
| Parent/child hierarchy | Sub-sessions (`parent_id`) are nested under their parent in the list; missing parents are completed across pages automatically |
| Token segment bar | A User (gold) / ASSISTANT (indigo) bar under the metadata that shows the session structure by per-message token share; clicking a segment jumps to that card |
| Light & dark themes | `light` / `dark` toggle in the header, Apple-inspired palette, choice persisted |
| In-card folding | Every card folds as a whole; the `step start` row has a `collapse` / `expand` button to fold/unfold all details inside a card |
| Full metrics | Per message: cost, input/output/reasoning/cache token breakdown |

## Requirements

- **Node.js ≥ 24** (uses the built-in `node:sqlite`; no `npm install`, zero runtime dependencies)

## Quick start

```sh
# from the tool directory
cd tools/session-inspector
node src/server.ts [--db <path>] [--port 8787] [--host 127.0.0.1] [--open]
```

Then open http://127.0.0.1:8787

CLI options:

| Option | Description |
|---|---|
| `--db <path>` | Database path (see [Database path resolution](#database-path-resolution)) |
| `--port <n>` | Listen port, default `8787` |
| `--host <h>` | Bind address, default `127.0.0.1` |
| `--open` | Open the browser automatically when the server is ready |
| `--help` | Show help |

## List page

- **Search**: the top search box fuzzy-matches title / directory / agent; additional
  agent, model and time-range (`from` / `to`) filters are available.
- **Hierarchy**: sub-sessions are indented below their parent with a `↳` arrow, a muted
  `sub` tag and a left guide line; parents missing from the current page are completed
  automatically so the structure is never broken by pagination.
- **Row actions**: `open` (open detail in a new tab), `export` (download HTML),
  `delete` (with a confirmation dialog).
- **Top bar**: `refresh` to reload the list, `light/dark` theme toggle, plus the active
  database path and total session count.

## Session detail page

Layout (top to bottom): sticky title bar → metadata area → token segment bar → message timeline.

- **Metadata**: session id, title, created/updated time, directory, version, project,
  workspace, agent, model, message count, tool-call count, cost and token totals.
- **Token segment bar**: segments in message order, colored User (gold) / ASSISTANT
  (indigo); width = message tokens / session token total. Hover for message details;
  **click a segment to jump to the card** with a highlight flash.
- **Message cards**:
  - Header shows role, time, agent, model, end label (`tool-calls` / highlighted `stop`)
    and the tools called (`bash ×2`, etc.).
  - Cards are collapsed by default; click the header to expand. The `collapse` /
    `expand` button on the `step start` row folds/unfolds every detail inside the card
    (tool I/O, reasoning, etc.).
  - Assistant content is rendered item by item: reasoning (collapsible), tool-call
    cards (input / output / error, collapsed by default), `step finish` with its token
    chips, patches, retries, etc.
- **Title bar actions**: `export html` (download this session), `expand/collapse all`,
  `light/dark` theme toggle.
- **Bottom right**: a circular `↑` button that scrolls back to top, always visible.

## HTML export

- Triggered from the list page (`export`) or the detail page (`export html`).
- Produces **one self-contained `.html`** file: CSS, JS and favicon are all inlined
  (base64), no external dependencies — openable offline, printable, archive-ready.
- Shares the same renderer as the detail page, so what you see is exactly what is
  exported.
- An audit footer records the export time, database path and tool version.

## Database path resolution

1. `--db <path>` flag
2. `OPENCODE_DB` environment variable (absolute, or relative to the data directory; `:memory:` unsupported)
3. Default: `~/.local/share/opencode/opencode.db`

## Technical notes

- **Read-first**: read operations only issue `SELECT`s; the only write path is the
  explicit session delete endpoint.
- **Concurrency-safe**: the database is opened with `PRAGMA busy_timeout` and
  `foreign_keys = ON`, so it is safe to use while opencode is running (WAL mode).
- **Security**: session ids are validated against `^[a-zA-Z0-9_-]+$` to prevent
  injection / path traversal; all text is HTML-escaped; credential-related files are
  never read.
- **Dual-layout reads**: V1 tables (`message` + `part`) are preferred for full history;
  when empty, the tool falls back to V2 (`session_message` + `session_input`), including
  pending inbox prompts.
- **Delete scope**: transactional cascade over `message` / `part` / `todo` /
  `session_message` / `session_input`, plus best-effort cleanup of session-owned files
  on disk (e.g. `storage/session_diff/<id>.json`). Shared snapshots are never touched.
- **Consistent rendering**: detail page and export share `src/render.ts`.

## Directory layout

```
tools/session-inspector/
├─ package.json          # Node ≥24, zero runtime dependencies
├─ tsconfig.json
├─ README.md
├─ public/               # List page static assets (no build step)
│  ├─ index.html
│  ├─ app.js
│  ├─ styles.css
│  └─ favicon.svg
└─ src/
   ├─ paths.ts           # Database path resolution
   ├─ db.ts              # node:sqlite queries, delete, artifact cleanup
   ├─ decode.ts          # Normalizes messages/parts into a render model (V1 + V2 fallback)
   ├─ render.ts          # HTML renderer for detail & export + theme + interaction scripts
   └─ server.ts          # Node HTTP server and routes
```