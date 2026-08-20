import type { InspectorDb, MessageRow, PartRow, SessionInputRow, SessionMessageRow, SessionRow } from "./db.ts"

export interface Tokens {
  readonly total?: number
  readonly input: number
  readonly output: number
  readonly reasoning: number
  readonly cacheRead: number
  readonly cacheWrite: number
}

export interface ModelRef {
  readonly providerID: string
  readonly modelID: string
  readonly variant?: string
}

export interface TimeSpan {
  readonly created: number
  readonly completed?: number
}

export interface FileInfo {
  readonly mime?: string
  readonly filename?: string
  readonly url: string
  readonly text?: string
}

export type ToolPartN = {
  readonly kind: "tool"
  readonly id: string
  readonly callID: string
  readonly tool: string
  readonly status: "pending" | "running" | "completed" | "error"
  readonly input: string | undefined
  readonly output: string | undefined
  readonly error: string | undefined
  readonly title: string | undefined
  readonly time: { readonly start?: number; readonly end?: number; readonly compacted?: number } | undefined
}

export type Part =
  | { readonly kind: "text"; readonly id: string; readonly text: string; readonly synthetic?: boolean }
  | { readonly kind: "reasoning"; readonly id: string; readonly text: string; readonly time?: readonly unknown }
  | { readonly kind: "file"; readonly id: string; readonly file: FileInfo }
  | { readonly kind: "patch"; readonly id: string; readonly hash: string; readonly files: readonly string[] }
  | { readonly kind: "snapshot"; readonly id: string; readonly snapshot: string }
  | {
      readonly kind: "subtask"
      readonly id: string
      readonly prompt: string
      readonly description: string
      readonly agent: string
      readonly command?: string
    }
  | ToolPartN
  | { readonly kind: "step-start"; readonly id: string }
  | { readonly kind: "step-finish"; readonly id: string; readonly reason: string; readonly cost?: number; readonly tokens?: Tokens }
  | { readonly kind: "agent"; readonly id: string; readonly name: string }
  | { readonly kind: "retry"; readonly id: string; readonly attempt: number; readonly errorText: string }
  | { readonly kind: "compaction"; readonly id: string; readonly auto: boolean }

export interface MsgN {
  readonly id: string
  readonly sessionID: string
  readonly role: "user" | "assistant"
  readonly agent?: string
  readonly model?: ModelRef
  readonly time: TimeSpan
  readonly finish?: string
  readonly tokens?: Tokens
  readonly cost?: number
  readonly path?: { readonly cwd: string; readonly root: string }
  readonly system?: string
  readonly summaryTitle?: string
  readonly parts: readonly Part[]
  readonly source: "v1" | "v2"
}

export interface SessionInfoN {
  readonly id: string
  readonly projectId: string | null
  readonly workspaceId: string | null
  readonly parentId: string | null
  readonly slug: string
  readonly directory: string
  readonly path: string | null
  readonly title: string
  readonly version: string
  readonly agent: string | null
  readonly model: ModelRef | null
  readonly cost: number
  readonly tokens: Tokens
  readonly timeCreated: number
  readonly timeUpdated: number
  readonly timeCompacting: number | null
  readonly timeArchived: number | null
  readonly metadata: unknown
  readonly projectName: string | null
  readonly workspaceName: string | null
  readonly workspaceDirectory: string | null
}

export interface SessionDetail {
  readonly info: SessionInfoN
  readonly messages: readonly MsgN[]
  readonly source: "v1" | "v2"
}

const json = <T>(raw: string | null | undefined, fallback: T | undefined = undefined): T | undefined => {
  if (raw === null || raw === undefined || raw === "") return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined)
const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)
const bool = (value: unknown): boolean | undefined => (typeof value === "boolean" ? value : undefined)

function readTokens(source: Record<string, unknown> | undefined): Tokens | undefined {
  if (!source) return undefined
  const cache = source["cache"] as Record<string, unknown> | undefined
  return {
    total: num(source["total"]),
    input: num(source["input"]) ?? 0,
    output: num(source["output"]) ?? 0,
    reasoning: num(source["reasoning"]) ?? 0,
    cacheRead: num(cache?.["read"]) ?? 0,
    cacheWrite: num(cache?.["write"]) ?? 0,
  }
}

function readModel(source: Record<string, unknown>): ModelRef | undefined {
  const providerID = str(source["providerID"]) ?? str(source["provider_id"])
  const modelID = str(source["modelID"]) ?? str(source["model_id"]) ?? str(source["id"])
  if (!providerID || !modelID) return undefined
  return { providerID, modelID, variant: str(source["variant"]) }
}

export function formatTimestamp(epochMillis: number): string {
  const d = new Date(epochMillis)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function pctDuration(start: number | undefined, end: number | undefined): string | undefined {
  if (start === undefined || end === undefined || end <= start) return undefined
  const sec = Math.round((end - start) / 1000)
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const rest = sec % 60
  return `${m}m${rest > 0 ? ` ${rest}s` : ""}`
}

interface ParsedToolState {
  readonly status: ToolPartN["status"]
  readonly input: string | undefined
  readonly output: string | undefined
  readonly error: string | undefined
  readonly title: string | undefined
  readonly time: ToolPartN["time"]
}

function parseToolState(state: Record<string, unknown> | undefined): ParsedToolState {
  if (!state || typeof state !== "object") return { status: "pending", input: undefined, output: undefined, error: undefined, title: undefined, time: undefined }
  const status = str(state["status"]) ?? "pending"
  const input: unknown = state["input"]
  const inputJson =
    input === undefined ? undefined : typeof input === "string" ? input : JSON.stringify(input, null, 2)
  const time = (state["time"] as Record<string, unknown> | undefined) ?? undefined
  const start = num(time?.["start"])
  const end = num(time?.["end"])
  switch (status) {
    case "completed":
      return {
        status: "completed",
        input: inputJson,
        output: str(state["output"]) ?? str(state["result"]),
        error: undefined,
        title: str(state["title"]),
        time: { start, end, compacted: num(time?.["compacted"]) },
      }
    case "error":
      return {
        status: "error",
        input: inputJson,
        output: undefined,
        error: str(state["error"]),
        title: str(state["title"]) ?? str((state["metadata"] as Record<string, unknown> | undefined)?.["title"]),
        time: { start, end },
      }
    case "running":
      return { status: "running", input: inputJson, output: undefined, error: undefined, title: str(state["title"]), time: { start } }
    default:
      return { status: "pending", input: inputJson, output: undefined, error: undefined, title: undefined, time: undefined }
  }
}

function decodePartV1(raw: Record<string, unknown>): Part | undefined {
  const id = str(raw["id"]) ?? String(raw["id"] ?? "")
  switch (raw["type"]) {
    case "text":
      return { kind: "text", id, text: str(raw["text"]) ?? "", synthetic: bool(raw["synthetic"]) }
    case "reasoning":
      return { kind: "reasoning", id, text: str(raw["text"]) ?? "" }
    case "file": {
      const source = raw["source"] as Record<string, unknown> | undefined
      const text = source?.type === "text" ? str(source["text"]) : undefined
      return {
        kind: "file",
        id,
        file: {
          mime: str(raw["mime"]),
          filename: str(raw["filename"]),
          url: str(raw["url"]) ?? "",
          ...(text === undefined ? {} : { text }),
        },
      }
    }
    case "patch":
      return { kind: "patch", id, hash: str(raw["hash"]) ?? "", files: Array.isArray(raw["files"]) ? (raw["files"] as string[]) : [] }
    case "snapshot":
      return { kind: "snapshot", id, snapshot: str(raw["snapshot"]) ?? "" }
    case "subtask":
      return {
        kind: "subtask",
        id,
        prompt: str(raw["prompt"]) ?? "",
        description: str(raw["description"]) ?? "",
        agent: str(raw["agent"]) ?? "",
        command: str(raw["command"]),
      }
    case "tool": {
      const state = parseToolState(raw["state"] as Record<string, unknown>)
      return {
        kind: "tool",
        id,
        callID: str(raw["callID"]) ?? "",
        tool: str(raw["tool"]) ?? "",
        status: state.status,
        input: state.input,
        output: state.output,
        error: state.error,
        title: state.title,
        time: state.time,
      }
    }
    case "step-start":
      return { kind: "step-start", id }
    case "step-finish": {
      const tokens = readTokens(dataObj(raw["tokens"]))
      return { kind: "step-finish", id, reason: str(raw["reason"]) ?? "", cost: num(raw["cost"]), tokens }
    }
    case "agent":
      return { kind: "agent", id, name: str(raw["name"]) ?? "" }
    case "retry": {
      const error = raw["error"] as Record<string, unknown> | undefined
      return { kind: "retry", id, attempt: num(raw["attempt"]) ?? 0, errorText: error ? JSON.stringify(error, null, 2) : "" }
    }
    case "compaction":
      return { kind: "compaction", id, auto: bool(raw["auto"]) ?? false }
    default:
      return undefined
  }
}

const dataObj = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : undefined

function decodeMessageV1(row: MessageRow): MsgN {
  const data = json<Record<string, unknown>>(row.data) ?? {}
  const role = data["role"] === "assistant" ? ("assistant" as const) : ("user" as const)
  const time = (data["time"] as Record<string, unknown> | undefined) ?? {}
  return {
    id: row.id,
    sessionID: row.session_id,
    role,
    agent: str(data["agent"]) ?? str(data["mode"]),
    model: readModel(dataObj(data["model"]) ?? data),
    time: { created: num(time["created"]) ?? row.time_created, completed: num(time["completed"]) },
    finish: str(data["finish"]),
    tokens: readTokens(dataObj(data["tokens"])),
    cost: num(data["cost"]),
    path: (data["path"] as { cwd?: unknown; root?: unknown } | undefined)
      ? {
          cwd: (data["path"] as { cwd?: unknown }).cwd as string,
          root: (data["path"] as { root?: unknown }).root as string,
        }
      : undefined,
    system: str(data["system"]),
    summaryTitle: str((data["summary"] as { title?: unknown } | undefined)?.title),
    parts: [] as readonly Part[],
    source: "v1",
  }
}

export interface MessageWithParts {
  readonly message: MsgN
  readonly parts: readonly Part[]
}

/** Build the decoded transcript for one session, preferring the V1 tables and falling back to V2. */
export function buildDetail(db: InspectorDb, row: SessionRow | undefined): SessionDetail | undefined {
  if (!row) return undefined
  const info = sessionInfo(row)
  const v1messages = db.messagesV1(row.id)
  const v1parts = db.partsV1(row.id)

  if (v1messages.length > 0) {
    const partsByMessage = new Map<string, Part[]>()
    for (const partRow of v1parts) {
      const decoded = decodePartV1(json<Record<string, unknown>>(partRow.data) ?? {})
      if (!decoded) continue
      const list = partsByMessage.get(partRow.message_id) ?? []
      list.push(decoded)
      partsByMessage.set(partRow.message_id, list)
    }
    const messages = v1messages.map((mRow) => {
      const msg = decodeMessageV1(mRow)
      return { ...msg, parts: partsByMessage.get(mRow.id) ?? [] }
    })
    return { info, messages, source: "v1" }
  }

  return buildV2(db, row.id, info)
}

function sessionInfo(row: SessionRow): SessionInfoN {
  const modelText = row.model ? json<Record<string, unknown>>(row.model) : undefined
  return {
    id: row.id,
    projectId: row.project_id,
    workspaceId: row.workspace_id,
    parentId: row.parent_id,
    slug: row.slug,
    directory: row.directory,
    path: row.path,
    title: row.title,
    version: row.version,
    agent: row.agent,
    model: readModel(modelText ?? {}),
    cost: row.cost ?? 0,
    tokens: {
      total: undefined,
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
    metadata: json<unknown>(row.metadata),
    projectName: row.project_name,
    workspaceName: row.workspace_name,
    workspaceDirectory: row.workspace_directory,
  }
}

function decodeV2Part(part: Record<string, unknown>): Part[] {
  switch (part["type"]) {
    case "text":
      return [{ kind: "text", id: str(part["id"]) ?? "", text: str(part["text"]) ?? "" }]
    case "reasoning":
      return [{ kind: "reasoning", id: str(part["id"]) ?? "", text: str(part["text"]) ?? "" }]
    case "tool": {
      const state = (part["state"] as Record<string, unknown> | undefined) ?? {}
      const status = str(state["status"]) ?? "pending"
      const completed = status === "completed"
      const failed = status === "error"
      return [
        {
          kind: "tool",
          id: str(part["id"]) ?? "",
          callID: str(part["id"]) ?? "",
          tool: str(part["name"]) ?? "",
          status: completed ? "completed" : failed ? "error" : status === "running" ? "running" : "pending",
          input: state["input"] === undefined ? undefined : JSON.stringify(state["input"], null, 2),
          output: completed ? jsonStringify(state["result"] ?? state["content"]) : undefined,
          error: failed ? jsonStringify(state["error"]) : undefined,
          title: undefined,
          time: undefined,
        },
      ]
    }
    default:
      return []
  }
}

const jsonStringify = (value: unknown): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value === "string") return value
  return JSON.stringify(value, null, 2)
}

function buildV2(db: InspectorDb, sessionID: string, info: SessionInfoN): SessionDetail | undefined {
  const rows = db.sessionMessagesV2(sessionID)
  const inputs = db.sessionInputsV2(sessionID)
  const messages: MsgN[] = []

  for (const row of rows) {
    const data = json<Record<string, unknown>>(row.data) ?? {}
    const time = (data["time"] as Record<string, unknown> | undefined) ?? {}
    if (row.type === "user" || row.type === "synthetic" || row.type === "system") {
      messages.push({
        id: row.id,
        sessionID,
        role: "user",
        agent: str(data["agent"]),
        model: readModel(dataObj(data["model"]) ?? data),
        time: { created: num(time["created"]) ?? row.time_created },
        source: "v2",
        parts: [{ kind: "text", id: row.id, text: str(data["text"]) ?? "" }],
      })
      continue
    }
    if (row.type === "assistant") {
      const parts: Part[] = []
      for (const item of Array.isArray(data["content"]) ? (data["content"] as Record<string, unknown>[]) : []) {
        parts.push(...decodeV2Part(item))
      }
      const tokens = readTokens(dataObj(data["tokens"]))
      messages.push({
        id: row.id,
        sessionID,
        role: "assistant",
        agent: str(data["agent"]),
        model: readModel(dataObj(data["model"]) ?? data),
        time: { created: num(time["created"]) ?? row.time_created, completed: num(time["completed"]) },
        finish: str(data["finish"]),
        tokens,
        cost: num(data["cost"]),
        source: "v2",
        parts,
      })
    }
  }

  // Admitted prompts that were never promoted appear as pending user messages.
  for (const input of inputs) {
    const prompt = json<{ text?: string }>(input.prompt) ?? {}
    if (input.promoted_seq !== null) continue
    messages.push({
      id: input.id,
      sessionID,
      role: "user",
      time: { created: input.time_created },
      source: "v2",
      parts: [{ kind: "text", id: input.id, text: prompt.text ?? "[queued prompt]" }],
    })
  }

  messages.sort((a, b) => a.time.created - b.time.created)
  return { info, messages, source: "v2" }
}