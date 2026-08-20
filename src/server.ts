import { createServer, type ServerResponse } from "http"
import { readFile } from "fs/promises"
import { join } from "path"
import { fileURLToPath } from "url"
import { InspectorDb, removeSessionArtifacts, type SessionRow } from "./db.ts"
import { buildDetail } from "./decode.ts"
import { renderDetail } from "./render.ts"
import { DEFAULT_PORT, resolveDb } from "./paths.ts"

const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/

interface Cli {
  readonly db: string | undefined
  readonly port: number
  readonly host: string
  readonly open: boolean
}

function parseCli(argv: string[]): Cli {
  const cli: Cli = { db: undefined, port: DEFAULT_PORT, host: "127.0.0.1", open: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case "--db":
      case "--db-path":
        cli.db = argv[++i]
        break
      case "--port":
        cli.port = Number(argv[++i])
        break
      case "--host":
        cli.host = argv[++i]
        break
      case "--open":
        cli.open = true
        break
      case "-h":
      case "--help":
        usage()
        process.exit(0)
        break
    }
  }
  return cli
}

function usage(): void {
  console.log(`opencode-session-inspector — offline session analysis UI

Usage:
  node src/server.ts [options]

Options:
  --db <path>   path to opencode.db (default: ~/.local/share/opencode/opencode.db,
                or OPENCODE_DB env)
  --port <n>    HTTP port (default: ${DEFAULT_PORT})
  --host <h>    bind host (default: 127.0.0.1)
  --open        open the browser when ready
  --help        show this help
`)
}

const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
])

/** Fetch ancestors of rows on the current page so the client can nest sub-sessions under their parents. */
function collectMissingParents(inspector: InspectorDb, rows: readonly SessionRow[]): SessionRow[] {
  const present = new Set(rows.map((row) => row.id))
  const wanted = new Set<string>()
  for (const row of rows) {
    if (row.parent_id && !present.has(row.parent_id)) wanted.add(row.parent_id)
  }
  const parents: SessionRow[] = []
  let guard = 0
  while (wanted.size > 0 && guard++ < 10) {
    const found = inspector.byIds(Array.from(wanted))
    for (const row of found) {
      parents.push(row)
      present.add(row.id)
    }
    const next = new Set<string>()
    for (const row of found) {
      if (row.parent_id && !present.has(row.parent_id)) next.add(row.parent_id)
    }
    wanted.clear()
    for (const id of next) wanted.add(id)
  }
  return parents
}

const publicDir = join(fileURLToPath(new URL(".", import.meta.url)), "..", "public")

function sessionView(row: SessionRow) {
  let model: { providerID?: string; modelID?: string; variant?: string } | null = null
  if (row.model) {
    try {
      const parsed = JSON.parse(row.model) as { providerID?: string; modelID?: string; id?: string; variant?: string }
      model = parsed && typeof parsed === "object" ? { providerID: parsed.providerID, modelID: parsed.modelID ?? parsed.id, variant: parsed.variant } : null
    } catch {
      model = null
    }
  }
  return {
    id: row.id,
    title: row.title,
    directory: row.directory,
    path: row.path,
    slug: row.slug,
    version: row.version,
    agent: row.agent,
    model,
    parentId: row.parent_id,
    projectId: row.project_id,
    projectName: row.project_name,
    workspaceName: row.workspace_name,
    workspaceDirectory: row.workspace_directory,
    cost: row.cost ?? 0,
    tokens: {
      input: row.tokens_input ?? 0,
      output: row.tokens_output ?? 0,
      reasoning: row.tokens_reasoning ?? 0,
      cacheRead: row.tokens_cache_read ?? 0,
      cacheWrite: row.tokens_cache_write ?? 0,
    },
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
    timeCompacting: row.time_compacting,
    timeArchived: row.time_archived,
    messageCount: (row.message_count ?? 0) + (row.smessage_count ?? 0),
    v2: (row.smessage_count ?? 0) > 0,
  }
}

function sendText(res: ServerResponse, status: number, body: string, contentType = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "content-type": contentType })
  res.end(body)
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  sendText(res, status, JSON.stringify(value, null, 2), "application/json; charset=utf-8")
}

function readJsonBody(req: import("http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = ""
    req.setEncoding("utf8")
    req.on("data", (chunk) => {
      data += chunk
      if (data.length > 1_000_000) {
        reject(new Error("request body too large"))
        req.destroy()
      }
    })
    req.on("end", () => {
      if (!data) {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(data))
      } catch {
        reject(new Error("invalid JSON body"))
      }
    })
    req.on("error", reject)
  })
}

function htmlPage(title: string, message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title} — opencode-session-inspector</title>
<style>body{font:16px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;background:#0f1115;color:#d7dce4;margin:0;padding:60px 24px;text-align:center}a{color:#4c8dff}.wrap{max-width:640px;margin:0 auto}</style></head>
<body><div class="wrap"><h1>${message}</h1><p><a href="/">← back to sessions</a></p></div></body></html>`
}

async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  const safe = pathname.replace(/^\/+/, "")
  const filename = join(publicDir, safe)
  if (!filename.startsWith(publicDir)) {
    sendText(res, 403, "forbidden")
    return
  }
  try {
    const body = await readFile(filename)
    const ext = "." + (safe.split(".").pop() ?? "")
    res.writeHead(200, { "content-type": MIME.get(ext) ?? "application/octet-stream" })
    res.end(body)
  } catch {
    sendText(res, 404, htmlPage("Not found", "Not found — <code>" + safe + "</code>"))
  }
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2))
  let dbConfig
  try {
    dbConfig = resolveDb(cli.db)
  } catch (error) {
    console.error((error as Error).message)
    process.exit(1)
  }

  let inspector: InspectorDb
  try {
    inspector = new InspectorDb(dbConfig.filename)
  } catch (error) {
    console.error(`cannot open database: ${(error as Error).message}`)
    process.exit(1)
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
    const pathname = decodeURIComponent(url.pathname)
    const method = (req.method ?? "GET").toUpperCase()
    const params = url.searchParams

    try {
      if (pathname === "/api/meta") {
        const count = inspector.count({})
        sendJson(res, 200, { db: dbConfig.filename, sessionCount: count })
        return
      }

      if (pathname === "/api/sessions" && method === "GET") {
        const limit = Math.min(Math.max(Number(params.get("limit") ?? 50) || 50, 1), 500)
        const offset = Math.max(Number(params.get("offset") ?? 0) || 0, 0)
        const from = params.has("from") ? Number(params.get("from")) : undefined
        const to = params.has("to") ? Number(params.get("to")) : undefined
        const filter = {
          search: params.get("search")?.trim() || undefined,
          agent: params.get("agent")?.trim() || undefined,
          model: params.get("model")?.trim() || undefined,
          from: Number.isFinite(from as number) ? from : undefined,
          to: Number.isFinite(to as number) ? to : undefined,
          limit,
          offset,
        }
        const rows = inspector.list(filter)
        const parents = await collectMissingParents(inspector, rows)
        const total = inspector.count(filter)
        sendJson(res, 200, {
          sessions: rows.map(sessionView),
          parents: parents.map(sessionView),
          total,
          limit,
          offset,
        })
        return
      }

      if (pathname === "/api/sessions" && method === "DELETE") {
        const body = await readJsonBody(req)
        const ids = Array.isArray(body?.ids) ? body.ids.filter((v): v is string => typeof v === "string") : []
        if (ids.length === 0) {
          sendJson(res, 400, { error: "no ids provided" })
          return
        }
        if (ids.length > 1000) {
          sendJson(res, 400, { error: "too many ids (max 1000)" })
          return
        }
        for (const id of ids) {
          if (!SESSION_ID_RE.test(id)) {
            sendJson(res, 400, { error: `invalid session id: ${id}` })
            return
          }
        }
        const removedIds = inspector.deleteSessions(ids)
        const artifacts: string[] = []
        for (const deletedId of removedIds) {
          artifacts.push(...(await removeSessionArtifacts(dbConfig.dataDir, deletedId)))
        }
        sendJson(res, 200, { ok: true, removed: removedIds, artifacts })
        return
      }

      const sessionsMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/)
      if (sessionsMatch && method === "DELETE") {
        const id = sessionsMatch[1]
        if (!SESSION_ID_RE.test(id)) {
          sendJson(res, 400, { error: "invalid session id" })
          return
        }
        if (!inspector.getSession(id)) {
          sendJson(res, 404, { error: "session not found" })
          return
        }
        const removedIds = inspector.deleteSession(id)
        const artifacts: string[] = []
        for (const deletedId of removedIds) {
          artifacts.push(...(await removeSessionArtifacts(dbConfig.dataDir, deletedId)))
        }
        sendJson(res, 200, { ok: true, removed: removedIds, artifacts })
        return
      }

      const pageMatch = pathname.match(/^\/session\/([^/]+)$/)
      if (pageMatch && method === "GET") {
        const id = pageMatch[1]
        if (!SESSION_ID_RE.test(id)) {
          sendText(res, 400, htmlPage("Invalid id", "Invalid session id."))
          return
        }
        const detail = buildDetail(inspector, inspector.getSession(id))
        if (!detail) {
          sendText(res, 404, htmlPage("Not found", "Session not found."))
          return
        }
        const html = renderDetail(detail, { dbFilename: dbConfig.filename, generatedAt: new Date().toISOString() })
        if (params.get("export") === "1" || params.get("download") === "1") {
          res.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "content-disposition": `attachment; filename="session-${id}.html"`,
          })
          res.end(html)
          return
        }
        sendText(res, 200, html, "text/html; charset=utf-8")
        return
      }

      if (pathname === "/" || pathname === "/index.html") {
        await serveStatic(res, "index.html")
        return
      }

      await serveStatic(res, pathname)
    } catch (error) {
      sendJson(res, 500, { error: (error as Error).message ?? String(error) })
    }
  })

  server.listen(cli.port, cli.host, () => {
    const url = `http://${cli.host}:${cli.port}`
    console.log(`opencode-session-inspector running at ${url}`)
    console.log(`database: ${dbConfig.filename}`)
    if (cli.open) {
      void import("open").then(({ default: open }) => open(url)).catch(() => undefined)
    }
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})