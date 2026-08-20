import { DatabaseSync } from "node:sqlite"
import { existsSync } from "fs"
import { access, rm } from "fs/promises"
import { join } from "path"

export interface SessionRow {
  readonly id: string
  readonly project_id: string | null
  readonly workspace_id: string | null
  readonly parent_id: string | null
  readonly slug: string
  readonly directory: string
  readonly path: string | null
  readonly title: string
  readonly version: string
  readonly agent: string | null
  readonly model: string | null
  readonly cost: number | null
  readonly tokens_input: number | null
  readonly tokens_output: number | null
  readonly tokens_reasoning: number | null
  readonly tokens_cache_read: number | null
  readonly tokens_cache_write: number | null
  readonly time_created: number
  readonly time_updated: number
  readonly time_compacting: number | null
  readonly time_archived: number | null
  readonly metadata: string | null
  readonly message_count: number
  readonly smessage_count: number
  readonly project_name: string | null
  readonly workspace_name: string | null
  readonly workspace_directory: string | null
}

export interface MessageRow {
  readonly id: string
  readonly session_id: string
  readonly time_created: number
  readonly time_updated: number
  readonly data: string
}

export interface PartRow {
  readonly id: string
  readonly message_id: string
  readonly session_id: string
  readonly time_created: number
  readonly time_updated: number
  readonly data: string
}

export interface SessionMessageRow {
  readonly id: string
  readonly session_id: string
  readonly type: string
  readonly seq: number
  readonly time_created: number
  readonly time_updated: number
  readonly data: string
}

export interface SessionInputRow {
  readonly id: string
  readonly session_id: string
  readonly prompt: string
  readonly delivery: string
  readonly admitted_seq: number
  readonly promoted_seq: number | null
  readonly time_created: number
}

export interface ListFilter {
  readonly search: string | undefined
  readonly agent: string | undefined
  readonly model: string | undefined
  readonly from: number | undefined
  readonly to: number | undefined
  readonly limit: number
  readonly offset: number
}

export class NotFoundError extends Error {}

/**
 * Detect the `workspace` table columns so the session query works across opencode
 * schema variants (older builds expose `name`/`directory`, newer ones `binding`).
 */
function workspaceColumns(db: DatabaseSync): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(workspace)`).all() as { name: string }[]
  return new Set(rows.map((row) => row.name))
}

function buildSessionSelect(workspaceCols: Set<string>): string {
  const nameExpr = workspaceCols.has("name") ? "w.name" : "w.binding"
  const dirExpr = workspaceCols.has("directory") ? "w.directory" : workspaceCols.has("name") ? "w.name" : "w.binding"
  return `
  SELECT s.id, s.project_id, s.workspace_id, s.parent_id, s.slug, s.directory, s.path,
         s.title, s.version, s.agent, s.model, s.cost,
         s.tokens_input, s.tokens_output, s.tokens_reasoning, s.tokens_cache_read, s.tokens_cache_write,
         s.time_created, s.time_updated, s.time_compacting, s.time_archived, s.metadata,
         (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) AS message_count,
         (SELECT COUNT(*) FROM session_message sm WHERE sm.session_id = s.id) AS smessage_count,
         p.name AS project_name,
         ${nameExpr} AS workspace_name, ${dirExpr} AS workspace_directory
  FROM session s
  LEFT JOIN project p ON p.id = s.project_id
  LEFT JOIN workspace w ON w.id = s.workspace_id
  `
}

export function openDb(filename: string): DatabaseSync {
  if (!existsSync(filename)) {
    throw new Error(`database not found: ${filename}`)
  }
  const db = new DatabaseSync(filename)
  db.exec("PRAGMA busy_timeout = 5000")
  db.exec("PRAGMA foreign_keys = ON")
  return db
}

const like = (value: string) => `%${value.replace(/[\\%_]/g, "\\$&")}%`

export class InspectorDb {
  readonly db: DatabaseSync
  readonly filename: string
  private readonly sessionSelect: string
  constructor(filename: string) {
    this.filename = filename
    this.db = openDb(filename)
    this.sessionSelect = buildSessionSelect(workspaceColumns(this.db))
  }

  list(filter: ListFilter): SessionRow[] {
    const where: string[] = []
    const params: Record<string, string | number> = {}
    if (filter.search) {
      where.push(`(s.title LIKE @search ESCAPE '\\' OR s.directory LIKE @search ESCAPE '\\' OR s.agent LIKE @search ESCAPE '\\')`)
      params["search"] = like(filter.search)
    }
    if (filter.agent) {
      where.push(`s.agent = @agent`)
      params["agent"] = filter.agent
    }
    if (filter.model) {
      where.push(`s.model LIKE @model`)
      params["model"] = like(filter.model)
    }
    if (filter.from !== undefined) {
      where.push(`s.time_updated >= @from`)
      params["from"] = filter.from
    }
    if (filter.to !== undefined) {
      where.push(`s.time_updated <= @to`)
      params["to"] = filter.to
    }
    const sql = `${this.sessionSelect} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY s.time_updated DESC LIMIT @limit OFFSET @offset`
    params["limit"] = filter.limit
    params["offset"] = filter.offset
    return this.db.prepare(sql).all(params) as unknown as SessionRow[]
  }

  count(filter: Omit<ListFilter, "limit" | "offset">): number {
    const where: string[] = []
    const params: Record<string, string | number> = {}
    if (filter.search) {
      where.push(`(s.title LIKE @search ESCAPE '\\' OR s.directory LIKE @search ESCAPE '\\' OR s.agent LIKE @search)`)
      params["search"] = like(filter.search)
    }
    if (filter.agent) {
      where.push(`s.agent = @agent`)
      params["agent"] = filter.agent
    }
    if (filter.model) {
      where.push(`s.model LIKE @model`)
      params["model"] = like(filter.model)
    }
    if (filter.from !== undefined) {
      where.push(`s.time_updated >= @from`)
      params["from"] = filter.from
    }
    if (filter.to !== undefined) {
      where.push(`s.time_updated <= @to`)
      params["to"] = filter.to
    }
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM session s ${where.length ? "WHERE " + where.join(" AND ") : ""}`)
      .get(params) as { n: number }
    return row.n
  }

  getSession(id: string): SessionRow | undefined {
    const row = this.db.prepare(`${this.sessionSelect} WHERE s.id = ?`).get(id) as SessionRow | undefined
    return row
  }

  byIds(ids: readonly string[]): SessionRow[] {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => "?").join(", ")
    return this.db
      .prepare(`${this.sessionSelect} WHERE s.id IN (${placeholders})`)
      .all(...ids) as unknown as SessionRow[]
  }

  messagesV1(sessionID: string): MessageRow[] {
    return this.db
      .prepare(`SELECT * FROM message WHERE session_id = ? ORDER BY time_created, id`)
      .all(sessionID) as unknown as MessageRow[]
  }

  partsV1(sessionID: string): PartRow[] {
    return this.db
      .prepare(`SELECT * FROM part WHERE session_id = ? ORDER BY time_created, id`)
      .all(sessionID) as unknown as PartRow[]
  }

  sessionMessagesV2(sessionID: string): SessionMessageRow[] {
    return this.db
      .prepare(`SELECT * FROM session_message WHERE session_id = ? ORDER BY seq, time_created, id`)
      .all(sessionID) as unknown as SessionMessageRow[]
  }

  sessionInputsV2(sessionID: string): SessionInputRow[] {
    return this.db
      .prepare(`SELECT * FROM session_input WHERE session_id = ? ORDER BY admitted_seq`)
      .all(sessionID) as unknown as SessionInputRow[]
  }

  /**
   * Delete a session and all its descendant sub-sessions (recursive via `parent_id`).
   * Foreign keys cascade to message/part/todo/… for every deleted session.
   * Returns the ids of the deleted sessions (including `id` itself).
   */
  deleteSession(id: string): string[] {
    return this.deleteSessions([id])
  }

  /**
   * Delete several sessions and all their descendant sub-sessions in one transaction.
   * Returns the full set of deleted session ids (including subtrees).
   */
  deleteSessions(ids: readonly string[]): string[] {
    if (ids.length === 0) return []
    const deleted: string[] = []
    const seen = new Set<string>()
    this.db.exec("BEGIN")
    try {
      const placeholders = ids.map(() => "?").join(", ")
      const rootIds = this.db
        .prepare(`SELECT id FROM session WHERE id IN (${placeholders})`)
        .all(...ids) as { id: string }[]
      const rows = this.db
        .prepare(
          `WITH RECURSIVE subtree(id) AS (
             SELECT id FROM session WHERE id IN (${placeholders})
             UNION ALL
             SELECT s.id FROM session s JOIN subtree t ON s.parent_id = t.id
           )
           SELECT id FROM subtree`
        )
        .all(...ids) as { id: string }[]
      for (const row of rows) {
        if (seen.has(row.id)) continue
        seen.add(row.id)
        this.db.prepare(`DELETE FROM session WHERE id = ?`).run(row.id)
        deleted.push(row.id)
      }
      this.db.exec("COMMIT")
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
    return deleted
  }
}

/** Best-effort removal of per-session artifacts on disk; never touches shared snapshots. */
export function legacyArtifacts(dataDir: string, sessionID: string): string[] {
  const candidates = [
    join(dataDir, "storage", "session", "message", sessionID),
    join(dataDir, "storage", "session", "part", sessionID),
    join(dataDir, "storage", "session", "info", `${sessionID}.json`),
    join(dataDir, "storage", "session_diff", `${sessionID}.json`),
  ]
  return candidates
}

export async function removeSessionArtifacts(dataDir: string, sessionID: string): Promise<string[]> {
  const removed: string[] = []
  for (const target of legacyArtifacts(dataDir, sessionID)) {
    try {
      await access(target)
    } catch {
      continue
    }
    try {
      await rm(target, { recursive: true, force: true })
      removed.push(target)
    } catch {
      // ignore individual cleanup failures
    }
  }
  return removed
}