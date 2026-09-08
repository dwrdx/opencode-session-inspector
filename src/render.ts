import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { formatTimestamp, pctDuration, type MsgN, type Part, type SessionDetail, type SessionInfoN } from "./decode.ts"

export interface RenderOptions {
  readonly dbFilename: string
  readonly generatedAt: string
  /** Show the `export html` button. Hidden when viewing a sub-agent session directly. */
  readonly showExport: boolean
  /** True for the downloaded export file: hides links back to the live server. */
  readonly standalone: boolean
}

/** A session plus its nested sub-agent sessions, depth-first. */
export interface SessionTree {
  readonly detail: SessionDetail
  readonly children: readonly SessionTree[]
}

interface FlatSection {
  readonly node: SessionTree
  readonly depth: number
}

function flattenTree(tree: SessionTree): FlatSection[] {
  const out: FlatSection[] = []
  const walk = (node: SessionTree, depth: number): void => {
    out.push({ node, depth })
    for (const child of node.children) walk(child, depth + 1)
  }
  walk(tree, 0)
  return out
}

const truncate = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value)

const APP_NAME = "opencode-session-inspector"

const FAVICON_DATA_URI =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+CiAgPGRlZnM+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImJnIiB4MT0iMCIgeTE9IjAiIHgyPSIxIiB5Mj0iMSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iIzZlNzlkNiIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNkMzg0YjgiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgPC9kZWZzPgogIDxyZWN0IHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgcng9IjgiIGZpbGw9InVybCgjYmcpIi8+CiAgPHJlY3QgeD0iNiIgeT0iMTIiIHdpZHRoPSI5IiBoZWlnaHQ9IjgiIHJ4PSIzIiBmaWxsPSIjZjZmN2ZhIi8+CiAgPHJlY3QgeD0iMTciIHk9IjEyIiB3aWR0aD0iOSIgaGVpZ2h0PSI4IiByeD0iMyIgZmlsbD0iI2U4YTgzZCIvPgo8L3N2Zz4="

/** Shared design tokens, inlined so exported HTML stays fully self-contained. */
let sharedCss = ""
try {
  const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public")
  sharedCss = readFileSync(join(publicDir, "tokens.css"), "utf8")
} catch {
  sharedCss = ""
}

const ICON = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  unfold: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/></svg>',
  fold: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/></svg>',
  toTop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>',
}

const esc = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")

const fmtInt = (value: number): string => new Intl.NumberFormat("en-US").format(value)

const fmtCost = (value: number | undefined): string => {
  if (value === undefined || value === 0) return ""
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

const msgTime = (msg: MsgN): string => formatTimestamp(msg.time.created)

function tokensLine(tokens: { readonly input: number; readonly output: number; readonly reasoning: number; readonly cacheRead: number; readonly cacheWrite: number }): string {
  const parts = [
    `in ${fmtInt(tokens.input)}`,
    `out ${fmtInt(tokens.output)}`,
    tokens.reasoning > 0 ? `reasoning ${fmtInt(tokens.reasoning)}` : "",
    tokens.cacheRead > 0 ? `cache-r ${fmtInt(tokens.cacheRead)}` : "",
    tokens.cacheWrite > 0 ? `cache-w ${fmtInt(tokens.cacheWrite)}` : "",
  ].filter((item) => item !== "")
  return parts.join(" · ")
}

function tokensChips(tokens: { readonly input: number; readonly output: number; readonly reasoning: number; readonly cacheRead: number; readonly cacheWrite: number } | undefined): string {
  if (!tokens) return ""
  const parts = [
    `in ${fmtInt(tokens.input)}`,
    `out ${fmtInt(tokens.output)}`,
    tokens.reasoning > 0 ? `reasoning ${fmtInt(tokens.reasoning)}` : "",
    tokens.cacheRead > 0 ? `cache-r ${fmtInt(tokens.cacheRead)}` : "",
    tokens.cacheWrite > 0 ? `cache-w ${fmtInt(tokens.cacheWrite)}` : "",
  ].filter((item) => item !== "")
  if (parts.length === 0) return ""
  return `<span class="unit-tokens">${parts.map((item) => `<span class="chip chip-marker">${esc(item)}</span>`).join("")}</span>`
}

function renderFile(part: Extract<Part, { kind: "file" }>): string {
  const title = part.file.filename ?? part.file.url.split("/").pop() ?? part.file.url
  return `<div class="part part-file">
    <span class="chip chip-file">file</span>
    <span class="file-name">${esc(title)}</span>
    ${part.file.mime ? `<span class="muted">${esc(part.file.mime)}</span>` : ""}
    ${part.file.url ? `<span class="muted file-url">${esc(part.file.url)}</span>` : ""}
    ${part.file.text ? `<pre class="pre file-text">${esc(part.file.text)}</pre>` : ""}
  </div>`
}

function renderText(part: Extract<Part, { kind: "text" }>): string {
  return `<div class="part part-text">${part.synthetic ? '<span class="chip chip-synthetic">synthetic</span>' : ""}<pre class="pre text">${esc(part.text)}</pre></div>`
}

function renderReasoning(part: Extract<Part, { kind: "reasoning" }>): string {
  return `<details class="part part-reasoning">
    <summary><span class="chip chip-reasoning">reasoning</span><span class="collapse-hint">toggle chain-of-thought</span></summary>
    <pre class="pre reasoning">${esc(part.text)}</pre>
  </details>`
}

function renderSubtask(part: Extract<Part, { kind: "subtask" }>): string {
  return `<div class="part part-subtask">
    <span class="chip chip-subtask">subtask</span>
    <span class="muted">agent</span> <code>${esc(part.agent)}</code>
    ${part.command ? `<span class="muted">command</span> <code>${esc(part.command)}</code>` : ""}
    <div class="subtask-prompt"><pre class="pre">${esc(part.prompt || part.description)}</pre></div>
  </div>`
}

function renderPatch(part: Extract<Part, { kind: "patch" }>): string {
  return `<details class="part part-patch">
    <summary><span class="chip chip-patch">patch</span> <span class="muted">hash</span> <code>${esc(part.hash.slice(0, 12))}</code> <span class="muted">·</span> ${part.files.length} file${part.files.length === 1 ? "" : "s"}</summary>
    <ul class="patch-files">${part.files.map((file) => `<li><code>${esc(file)}</code></li>`).join("")}</ul>
  </details>`
}

function renderTool(part: Extract<Part, { kind: "tool" }>): string {
  const statusCls =
    part.status === "completed"
      ? "st-ok"
      : part.status === "error"
        ? "st-err"
        : part.status === "running"
          ? "st-run"
          : "st-pend"
  const duration = pctDuration(part.time?.start, part.time?.end)
  const inputHtml = part.input ? `<details class="collapse"><summary><span class="col-label">input</span></summary><pre class="pre">${esc(part.input)}</pre></details>` : ""
  const outputHtml =
    part.output !== undefined
      ? `<details class="collapse"><summary><span class="col-label">output</span></summary><pre class="pre output">${esc(part.output)}</pre></details>`
      : ""
  const errorHtml = part.error ? `<details class="collapse" open><summary><span class="col-label col-err">error</span></summary><pre class="pre error">${esc(part.error)}</pre></details>` : ""
  return `<div class="part part-tool">
    <div class="tool-head">
      <span class="tool-status ${statusCls}" title="${esc(part.status)}"></span>
      <code class="tool-name">${esc(part.tool)}</code>
      ${part.title && part.title !== part.tool ? ` <span class="tool-call">${esc(part.title)}</span>` : ""}
      ${duration ? `<span class="muted tool-duration">${esc(duration)}</span>` : ""}
    </div>
    <div class="tool-body">${inputHtml}${outputHtml}${errorHtml}</div>
  </div>`
}

function renderRetry(part: Extract<Part, { kind: "retry" }>): string {
  return `<details class="part part-retry">
    <summary><span class="chip chip-error">retry #${part.attempt}</span></summary>
    <pre class="pre error">${esc(part.errorText)}</pre>
  </details>`
}

function renderPart(part: Part): string {
  switch (part.kind) {
    case "text":
      return renderText(part)
    case "reasoning":
      return renderReasoning(part)
    case "file":
      return renderFile(part)
    case "patch":
      return renderPatch(part)
    case "snapshot":
      return `<div class="part part-marker"><span class="chip chip-marker">snapshot</span> <code>${esc(part.snapshot.slice(0, 12))}</code></div>`
    case "subtask":
      return renderSubtask(part)
    case "tool":
      return renderTool(part)
    case "step-start":
      return `<div class="part part-marker step-start-row"><span class="chip chip-marker">step start</span><button type="button" class="collapse-toggle" title="Fold/unfold contents of this card">collapse</button></div>`
    case "step-finish": {
      const reason = part.reason ? `<span class="muted"> · ${esc(part.reason)}</span>` : ""
      const cost = fmtCost(part.cost) ? `<span class="muted"> · ${esc(fmtCost(part.cost))}</span>` : ""
      return `<div class="part part-marker"><span class="chip chip-marker">step finish</span>${tokensChips(part.tokens)}${reason}${cost}</div>`
    }
    case "agent":
      return `<div class="part part-marker"><span class="chip chip-agent">agent</span> <code>${esc(part.name)}</code></div>`
    case "retry":
      return renderRetry(part)
    case "compaction":
      return `<div class="part part-marker"><span class="chip chip-marker">compaction${part.auto ? " (auto)" : ""}</span></div>`
  }
}

function renderMessage(msg: MsgN): string {
  if (msg.role === "user") {
    const textPart = msg.parts.find((p) => p.kind === "text")
    const others = msg.parts.filter((p) => p.kind !== "text")
    const head = `<span class="role user">user</span><span class="muted time">${esc(msgTime(msg))}</span>${msg.agent ? `<span class="muted">· ${esc(msg.agent)}</span>` : ""}`
    const body = textPart ? `<pre class="pre user-text">${esc((textPart as { text: string }).text)}</pre>` : ""
    const extra = others.map(renderPart).join("")
    return `<details class="msg msg-user" id="${esc(msg.id)}"><summary class="msg-head">${head}</summary><div class="msg-body">${body}${extra}</div></details>`
  }

  const toolsCalled = new Map<string, number>()
  for (const p of msg.parts) {
    if (p.kind === "tool") toolsCalled.set(p.tool, (toolsCalled.get(p.tool) ?? 0) + 1)
  }
  const toolChips =
    toolsCalled.size > 0
      ? Array.from(toolsCalled.entries())
          .map(([name, n]) => `<span class="chip chip-toolname">${esc(name)}${n > 1 ? ` ×${n}` : ""}</span>`)
          .join("")
      : ""
  const headBits = [
    `<span class="role assistant">assistant</span>`,
    `<span class="muted time">${esc(msgTime(msg))}</span>`,
    msg.agent ? `<span class="muted">· ${esc(msg.agent)}</span>` : "",
    msg.model ? `<span class="muted model-badge">· ${esc(msg.model.providerID)}/${esc(msg.model.modelID)}</span>` : "",
    msg.finish
      ? `<span class="chip ${msg.finish === "stop" ? "chip-stop" : "chip-finish"}">${esc(msg.finish)}</span>`
      : "",
    toolChips,
  ]
    .filter((item) => item !== "")
    .join(" ")
  const stats = fmtCost(msg.cost)
  return `<details class="msg msg-assistant" id="${esc(msg.id)}">
    <summary class="msg-head">${headBits}${stats ? `<span class="muted msg-stats">· ${esc(stats)}</span>` : ""}</summary>
    <div class="parts">${msg.parts.map(renderPart).join("")}</div>
  </details>`
}

function metaRow(key: string, value: string, extra = ""): string {
  return `<div class="meta-row"><span class="meta-key">${esc(key)}</span><span class="meta-value">${value}</span>${extra}</div>`
}

function renderInfo(info: SessionInfoN, messageCount: number, totalTools: number, inFileIds?: ReadonlySet<string>): string {
  const model = info.model ? `${info.model.providerID}/${info.model.modelID}${info.model.variant ? `@${info.model.variant}` : ""}` : (info.agent ?? "—")
  const meta: string[] = []
  meta.push(metaRow("session id", `<code>${esc(info.id)}</code>`))
  meta.push(metaRow("title", esc(info.title || "(untitled)")))
  meta.push(metaRow("created", esc(formatTimestamp(info.timeCreated))))
  meta.push(metaRow("updated", esc(formatTimestamp(info.timeUpdated))))
  if (info.timeCompacting) meta.push(metaRow("compacting", esc(formatTimestamp(info.timeCompacting))))
  if (info.timeArchived) meta.push(metaRow("archived", esc(formatTimestamp(info.timeArchived))))
  meta.push(metaRow("directory", `<code>${esc(info.directory)}</code>`))
  if (info.path) meta.push(metaRow("path", `<code>${esc(info.path)}</code>`))
  if (info.slug) meta.push(metaRow("slug", esc(info.slug)))
  meta.push(metaRow("version", esc(info.version)))
  if (info.projectName) meta.push(metaRow("project", esc(info.projectName)))
  if (info.workspaceDirectory) meta.push(metaRow("workspace", `<code>${esc(info.workspaceDirectory)}</code>`))
  if (info.agent) meta.push(metaRow("agent", esc(info.agent)))
  meta.push(metaRow("model", `<code>${esc(model)}</code>`))
  meta.push(metaRow("parent", info.parentId ? parentLink(info.parentId, inFileIds) : "—"))
  return `<div class="meta">${meta.join("")}</div>`
}

function parentLink(parentId: string, inFileIds?: ReadonlySet<string>): string {
  const inFile = inFileIds?.has(parentId) ?? false
  const href = inFile ? `#sess-${esc(parentId)}` : `/session/${esc(parentId)}`
  const target = inFile ? "" : ` target="_blank" rel="noopener"`
  return `<a href="${href}"${target}><code>${esc(parentId)}</code></a>`
}

function statCard(label: string, value: string): string {
  return `<div class="stat"><span class="stat-label">${esc(label)}</span><span class="stat-value">${value}</span></div>`
}

function renderStatStrip(info: SessionInfoN, messageCount: number, totalTools: number): string {
  const totalTokens = info.tokens.input + info.tokens.output + info.tokens.reasoning + info.tokens.cacheRead + info.tokens.cacheWrite
  const stats = [
    statCard("messages", fmtInt(messageCount)),
    statCard("tool calls", fmtInt(totalTools)),
    statCard("cost", fmtCost(info.cost) || "—"),
    statCard("tokens", totalTokens > 0 ? fmtInt(totalTokens) : "—"),
  ]
  return `<div class="stat-strip">${stats.join("")}</div>`
}

function messageTokens(msg: MsgN): number {
  const t = msg.tokens
  if (t) {
    if (t.total && t.total > 0) return t.total
    const sum = t.input + t.output + t.reasoning + t.cacheRead + t.cacheWrite
    if (sum > 0) return sum
  }
  const text = msg.parts
    .filter((p) => p.kind === "text")
    .map((p) => p.text)
    .join("")
  return text ? Math.max(1, Math.ceil(text.length / 3)) : 0
}

function renderSegmentBar(messages: readonly MsgN[]): string {
  if (messages.length === 0) return ""
  const tokens = messages.map(messageTokens)
  const total = tokens.reduce((a, b) => a + b, 0)
  if (total <= 0) return ""
  const segs = messages
    .map((msg, i) => {
      const pct = (tokens[i] / total) * 100
      const cls = msg.role === "user" ? "seg-user" : "seg-assistant"
      const title = `${msg.role} · ${fmtInt(tokens[i])} tokens · ${pct.toFixed(1)}% · ${msgTime(msg)}`
      return `<div class="seg ${cls}" data-target="${esc(msg.id)}" role="button" tabindex="0" style="flex-basis:${pct.toFixed(4)}%" title="${esc(title)}"></div>`
    })
    .join("")
  const userTotal = tokens.reduce((acc, t, i) => acc + (messages[i].role === "user" ? t : 0), 0)
  const asstTotal = total - userTotal
  const pct = (v: number) => ((v / total) * 100).toFixed(1) + "%"
  return `<section class="segment-wrap">
    <div class="segment-bar">${segs}</div>
    <div class="segment-caption"><span>message tokens · total ${fmtInt(total)}</span><span class="seg-legend"><i class="dot dot-user"></i>user ${fmtInt(userTotal)} (${pct(userTotal)}) <i class="dot dot-asst"></i>assistant ${fmtInt(asstTotal)} (${pct(asstTotal)})</span></div>
  </section>`
}

function sessionStats(detail: SessionDetail): { messageCount: number; totalTools: number } {
  const totalTools = detail.messages.reduce((acc, msg) => acc + msg.parts.filter((p) => p.kind === "tool").length, 0)
  return { messageCount: detail.messages.length, totalTools }
}

function renderSectionNav(sections: readonly FlatSection[]): string {
  const items = sections
    .map(({ node, depth }) => {
      const info = node.detail.info
      const role = depth === 0 ? "main" : "sub"
      const label = depth === 0 ? info.agent ?? "main" : info.agent ?? `sub-${depth}`
      const title = info.title || "(untitled)"
      return `<a class="nav-sect nav-sect-${role}" href="#sess-${esc(info.id)}" title="${esc(title)}"${depth ? ` style="margin-left:${depth * 10}px"` : ""}><span class="nav-role">${role}</span><span class="nav-agent">${esc(label)}</span><span class="nav-title">${esc(truncate(title, 26))}</span></a>`
    })
    .join("")
  return `<nav class="sect-nav"><span class="sect-nav-label">sections</span><div class="sect-nav-list">${items}</div></nav>`
}

function renderSection(node: SessionTree, depth: number, inFileIds: ReadonlySet<string>): string {
  const detail = node.detail
  const info = detail.info
  const { messageCount, totalTools } = sessionStats(detail)
  const role = depth === 0 ? "main" : "sub"
  const agentLabel = info.agent ?? "—"
  return `<section class="sess sess-${role}" id="sess-${esc(info.id)}" data-depth="${depth}">
    <div class="sess-head">
      <span class="sess-role-dot sess-role-${role}"></span>
      <span class="chip chip-agent">agent</span>
      <code class="sess-agent">${esc(agentLabel)}</code>
      <span class="chip ${depth === 0 ? "chip-stop" : "chip-subtag"}">${role}</span>
      <h2 class="sess-title">${esc(info.title || "(untitled session)")}</h2>
      <span class="muted sess-meta-line"><code>${esc(info.id)}</code> · ${messageCount} msg${messageCount === 1 ? "" : "s"} · ${totalTools} tool call${totalTools === 1 ? "" : "s"} · ${esc(formatTimestamp(info.timeUpdated))}</span>
    </div>
    ${renderStatStrip(info, messageCount, totalTools)}
    ${renderInfo(info, messageCount, totalTools, inFileIds)}
    ${renderSegmentBar(detail.messages)}
    <div class="transcript">${detail.messages.map(renderMessage).join("") || `<div class="empty">No messages in this session.</div>`}</div>
    ${node.children.map((child) => renderSection(child, depth + 1, inFileIds)).join("")}
  </section>`
}

export function renderDetail(tree: SessionTree, options: RenderOptions): string {
  const sections = flattenTree(tree)
  const inFileIds = new Set(sections.map(({ node }) => node.detail.info.id))
  const root = tree.detail
  const auditLine = `Generated ${esc(options.generatedAt)} · DB ${esc(options.dbFilename)} · ${APP_NAME}`
  const exportBtn = options.showExport && !options.standalone
    ? `<a id="exportBtn" class="btn btn-primary" href="/session/${esc(root.info.id)}?export=1" download>${ICON.download}export html</a>`
    : ""
  const backLink = options.standalone
    ? ""
    : `<a class="back-link btn btn-ghost" href="/" title="Back to session list">${ICON.back}<span>sessions</span></a>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(root.info.title || root.info.id)}</title>
<link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URI}">
<style>${sharedCss}
${detailCss()}</style>
</head>
<body>
<header class="top">
  <div class="top-left">
    ${backLink}
    <h1 class="session-title">${esc(root.info.title || "(untitled session)")}</h1>
  </div>
  <div class="top-actions">
    ${exportBtn}
    <button id="toggleAll" type="button" class="btn" title="Expand or collapse all messages">${ICON.unfold}<span id="toggleAllLabel">expand all</span></button>
    <button id="themeToggle" type="button" class="btn btn-icon" title="Theme: system" aria-label="Theme: system">
      <svg class="ic-system" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
      <svg class="ic-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" hidden><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
      <svg class="ic-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" hidden><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
    </button>
  </div>
</header>
${renderSectionNav(sections)}
<div class="sess-tree">${renderSection(tree, 0, inFileIds)}</div>
<footer class="footer">${auditLine}</footer>
<button id="toTop" type="button" title="Back to top" aria-label="Back to top">${ICON.toTop}</button>
<script>${detailJs()}</script>
</body>
</html>`
}

function detailJs(): string {
  return `
const ICON_FOLD = ${JSON.stringify(ICON.fold)};
const ICON_UNFOLD = ${JSON.stringify(ICON.unfold)};
document.getElementById("toggleAll")?.addEventListener("click", () => {
  const details = document.querySelectorAll(".transcript details.msg");
  const anyClosed = Array.from(details).some((d) => !d.open);
  details.forEach((d) => (d.open = anyClosed));
  syncToggleAll();
});
function syncToggleAll() {
  const details = document.querySelectorAll(".transcript details.msg");
  const anyClosed = Array.from(details).some((d) => !d.open);
  const label = document.getElementById("toggleAllLabel");
  const btn = document.getElementById("toggleAll");
  if (label) label.textContent = anyClosed ? "expand all" : "collapse all";
  if (btn) btn.title = anyClosed ? "Expand all messages" : "Collapse all messages";
  btn?.querySelector("svg")?.remove();
  if (btn) btn.insertAdjacentHTML("afterbegin", anyClosed ? ICON_UNFOLD : ICON_FOLD);
}
document.querySelectorAll(".segment-bar").forEach((bar) => bar.addEventListener("click", (event) => {
  const seg = event.target.closest(".seg");
  if (!seg) return;
  const target = document.getElementById(seg.dataset.target);
  if (!target) return;
  target.open = true;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.classList.remove("flash");
  void target.offsetWidth;
  target.classList.add("flash");
}));
document.querySelector(".sect-nav")?.addEventListener("click", (event) => {
  const link = event.target.closest(".nav-sect");
  if (!link) return;
  const href = link.getAttribute("href") || "";
  if (!href.startsWith("#sess-")) return;
  const target = document.getElementById(href.slice(1));
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.classList.remove("sect-flash");
  void target.offsetWidth;
  target.classList.add("sect-flash");
});
(function scrollSpy() {
  const links = Array.from(document.querySelectorAll(".nav-sect"));
  const byId = new Map(links.map((l) => [l.getAttribute("href").slice(1), l]));
  const sections = Array.from(document.querySelectorAll(".sess"));
  if (!("IntersectionObserver" in window) || sections.length === 0) return;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      links.forEach((l) => l.classList.remove("active"));
      byId.get(entry.target.id)?.classList.add("active");
    }
  }, { rootMargin: "-30% 0px -60% 0px", threshold: 0 });
  sections.forEach((s) => observer.observe(s));
  byId.get(sections[0].id)?.classList.add("active");
})();
document.getElementById("toTop")?.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});
(function toTopVisibility() {
  const btn = document.getElementById("toTop");
  if (!btn) return;
  let ticking = false;
  const update = () => {
    btn.classList.toggle("visible", window.scrollY > 400);
    ticking = false;
  };
  window.addEventListener("scroll", () => {
    if (!ticking) { requestAnimationFrame(update); ticking = true; }
  }, { passive: true });
  update();
})();
(function theme() {
  const themeBtn = document.getElementById("themeToggle");
  const root = document.documentElement;
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const effective = (mode) => (mode === "system" ? (mq.matches ? "light" : "dark") : mode);
  const applyMode = (mode) => {
    const theme = effective(mode);
    root.dataset.themeMode = mode;
    if (theme === "light") root.setAttribute("data-theme", "light");
    else root.removeAttribute("data-theme");
    themeBtn?.querySelectorAll("svg").forEach((svg) => (svg.hidden = true));
    const cls = mode === "light" ? ".ic-sun" : mode === "dark" ? ".ic-moon" : ".ic-system";
    const icon = themeBtn?.querySelector(cls);
    if (icon) icon.hidden = false;
    const title = mode === "system" ? "Theme: system (" + theme + ")" : "Theme: " + mode;
    if (themeBtn) { themeBtn.title = title; themeBtn.setAttribute("aria-label", title); }
  };
  let mode = "system";
  try { mode = localStorage.getItem("si-theme-mode") || "system"; } catch {}
  if (mode !== "light" && mode !== "dark" && mode !== "system") mode = "system";
  applyMode(mode);
  themeBtn?.addEventListener("click", () => {
    const next = root.dataset.themeMode === "system" ? "light" : root.dataset.themeMode === "light" ? "dark" : "system";
    applyMode(next);
    try { localStorage.setItem("si-theme-mode", next); } catch {}
  });
  mq.addEventListener("change", () => {
    if (root.dataset.themeMode === "system" || !root.dataset.themeMode) applyMode("system");
  });
})();
document.querySelectorAll(".collapse-toggle").forEach((btn) => {
  const card = btn.closest(".msg");
  const inner = card ? Array.from(card.querySelectorAll("details")) : [];
  const sync = () => (btn.textContent = inner.some((d) => d.open) ? "collapse" : "expand");
  sync();
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    const anyOpen = inner.some((d) => d.open);
    inner.forEach((d) => (d.open = !anyOpen));
    sync();
  });
});`
}

function detailCss(): string {
  return `
/* ---------- detail page ---------- */
.top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 10px 22px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 78%, transparent);
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
  position: sticky;
  top: 0;
  z-index: 20;
}
.top-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.back-link { flex: none; font-size: 12px; }
.back-link svg { width: 13px; height: 13px; }
.session-title { margin: 0; font-size: 15px; font-weight: 650; letter-spacing: -0.01em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.top-actions { display: flex; gap: 8px; flex: none; }
#themeToggle .ic-system, #themeToggle .ic-sun, #themeToggle .ic-moon { display: none; }
:root[data-theme-mode="system"] #themeToggle .ic-system, :root:not([data-theme-mode]) #themeToggle .ic-system { display: block; }
:root[data-theme-mode="light"] #themeToggle .ic-sun { display: block; }
:root[data-theme-mode="dark"] #themeToggle .ic-moon { display: block; }

/* sections nav */
.sect-nav {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 22px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--wash) 88%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  position: sticky;
  top: 52px;
  z-index: 15;
}
.sect-nav-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--faint); flex: none; }
.sect-nav-list { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.nav-sect {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 999px;
  padding: 3px 11px;
  font-size: 11.5px;
  color: var(--muted);
  text-decoration: none;
  max-width: 300px;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}
.nav-sect:hover { border-color: var(--border-strong); color: var(--fg); text-decoration: none; }
.nav-sect.active { border-color: color-mix(in srgb, var(--accent) 60%, var(--border)); background: var(--accent-soft); color: var(--fg); }
.nav-role { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: var(--faint); }
.nav-sect-main .nav-role { color: var(--role-asst); }
.nav-sect.active .nav-role { color: var(--accent); }
.nav-agent { font-weight: 650; color: var(--fg); }
.nav-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* layout */
.sess-tree { max-width: 1080px; margin: 0 auto; padding: 22px 22px 60px; }
.sess {
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--surface);
  margin: 0 0 22px;
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  scroll-margin-top: 108px;
}
.sess-sub {
  margin: 0 0 18px 26px;
  border-style: dashed;
  border-color: var(--border-strong);
  background: color-mix(in srgb, var(--surface) 60%, var(--wash));
}
.sess-sub .sess-sub { margin-left: 18px; }

.sess-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.sess-role-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.sess-role-main { background: var(--role-asst); box-shadow: 0 0 0 3px color-mix(in srgb, var(--role-asst) 20%, transparent); }
.sess-role-sub { background: var(--info); box-shadow: 0 0 0 3px color-mix(in srgb, var(--info) 18%, transparent); }
.sess-title { margin: 0; font-size: 15px; font-weight: 650; letter-spacing: -0.01em; min-width: 0; overflow-wrap: anywhere; flex: 1 1 auto; }
.sess-agent { font-weight: 650; }
.sess-meta-line { font-size: 11.5px; font-variant-numeric: tabular-nums; word-break: break-all; flex-basis: 100%; }

/* stat strip */
.stat-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 1px;
  background: var(--border);
  border-bottom: 1px solid var(--border);
}
.stat {
  background: var(--surface);
  padding: 10px 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.stat-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--faint); }
.stat-value { font-size: 15px; font-weight: 650; font-variant-numeric: tabular-nums; color: var(--fg-strong); }

/* meta grid */
.meta {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 6px 24px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface-2) 40%, transparent);
}
.meta-row { display: flex; gap: 10px; min-width: 0; font-size: 12.5px; align-items: baseline; }
.meta-key { color: var(--faint); flex: 0 0 82px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; padding-top: 2px; }
.meta-value { min-width: 0; overflow-wrap: anywhere; }
.meta-value code { font-size: 11.5px; }

/* segment bar */
.segment-wrap { padding: 12px 16px; border-bottom: 1px solid var(--border); }
.segment-bar { display: flex; height: 22px; border-radius: 6px; overflow: hidden; background: var(--code-bg); border: 1px solid var(--code-border); gap: 2px; padding: 2px; }
.seg { min-width: 3px; border-radius: 3px; cursor: pointer; transition: filter 0.15s ease, transform 0.15s ease; }
.seg:hover { filter: brightness(1.3); transform: scaleY(1.08); }
.seg-user { background: linear-gradient(180deg, color-mix(in srgb, var(--role-user) 80%, white 8%), var(--role-user)); }
.seg-assistant { background: linear-gradient(180deg, color-mix(in srgb, var(--role-asst) 80%, white 8%), var(--role-asst)); }
.segment-caption { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; font-size: 11px; color: var(--muted); margin-top: 7px; font-variant-numeric: tabular-nums; }
.seg-legend { display: inline-flex; align-items: center; gap: 5px; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin: 0 2px 0 8px; }
.dot-user { background: var(--role-user); }
.dot-asst { background: var(--role-asst); }
@keyframes segflash { 0% { box-shadow: 0 0 0 3px var(--accent); } 100% { box-shadow: 0 0 0 3px transparent; } }
.msg.flash { animation: segflash 1.6s ease-out; }

/* transcript */
.transcript { padding: 14px 16px 18px; }
.empty { padding: 40px; color: var(--muted); text-align: center; }

.msg {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  margin: 12px 0;
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  scroll-margin-top: 108px;
}
.msg-user { border-left: 2px solid var(--role-user); }
.msg-assistant { border-left: 2px solid var(--role-asst); }
.msg-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
  transition: background 0.12s ease;
}
details.msg > summary { list-style: none; }
details.msg > summary::-webkit-details-marker { display: none; }
.msg-user .msg-head { background: color-mix(in srgb, var(--role-user) 6%, transparent); }
.msg-assistant .msg-head { background: color-mix(in srgb, var(--surface-2) 70%, transparent); }
.msg-head:hover { background: var(--surface-2); }
details.msg:not([open]) > .msg-head { border-bottom: none; }

.role {
  display: inline-block;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 10px;
  border-radius: 999px;
  padding: 2px 9px;
}
.role.user { color: var(--role-user); background: color-mix(in srgb, var(--role-user) 15%, transparent); }
.role.assistant { color: var(--role-asst); background: color-mix(in srgb, var(--role-asst) 15%, transparent); }
.time, .msg-stats, .model-badge, .tool-duration { font-variant-numeric: tabular-nums; }

.msg-body { padding: 12px 14px; }
.user-text { white-space: pre-wrap; color: var(--fg); background: color-mix(in srgb, var(--role-user) 7%, var(--code-bg)); border: 1px solid color-mix(in srgb, var(--role-user) 18%, var(--code-border)); border-radius: var(--radius); padding: 10px 12px; }
.parts { padding: 4px 14px 12px; }
.part { border-top: 1px solid var(--border); padding: 10px 0; }
.part:first-child { border-top: none; }
.part-text { padding-top: 8px; }

/* chips */
.chip {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border-radius: 999px;
  padding: 2px 8px;
  margin-right: 4px;
  vertical-align: middle;
  border: 1px solid transparent;
}
.chip-tool, .chip-toolname { --c1: #a78bfa; background: color-mix(in srgb, var(--c1) 15%, transparent); color: color-mix(in srgb, var(--c1) 72%, var(--fg)); border-color: color-mix(in srgb, var(--c1) 28%, transparent); }
.chip-ok { --c1: var(--ok); background: var(--ok-soft); color: var(--ok); border-color: color-mix(in srgb, var(--c1) 28%, transparent); }
.chip-error { --c1: var(--danger); background: var(--danger-soft); color: var(--danger); border-color: color-mix(in srgb, var(--c1) 30%, transparent); }
.chip-warn, .chip-subtask { --c1: var(--warn); background: var(--warn-soft); color: var(--warn); border-color: color-mix(in srgb, var(--c1) 30%, transparent); }
.chip-running { --c1: var(--info); background: var(--info-soft); color: var(--info); border-color: color-mix(in srgb, var(--c1) 28%, transparent); }
.chip-pending, .chip-marker, .chip-finish { --c1: var(--muted); background: color-mix(in srgb, var(--c1) 14%, transparent); color: var(--muted); border-color: color-mix(in srgb, var(--c1) 26%, transparent); }
.chip-reasoning, .chip-synthetic { --c1: #8e8aff; background: color-mix(in srgb, var(--c1) 15%, transparent); color: color-mix(in srgb, var(--c1) 72%, var(--fg)); border-color: color-mix(in srgb, var(--c1) 28%, transparent); }
.chip-agent { --c1: #5ecfa8; background: color-mix(in srgb, var(--c1) 14%, transparent); color: color-mix(in srgb, var(--c1) 70%, var(--fg)); border-color: color-mix(in srgb, var(--c1) 26%, transparent); }
.chip-file { --c1: var(--faint); background: color-mix(in srgb, var(--c1) 16%, transparent); color: var(--muted); border-color: color-mix(in srgb, var(--c1) 26%, transparent); text-transform: none; letter-spacing: 0; font-size: 10.5px; }
.chip-patch { --c1: var(--info); background: var(--info-soft); color: var(--info); border-color: color-mix(in srgb, var(--c1) 28%, transparent); }
.chip-stop { --c1: var(--ok); background: var(--ok-soft); color: var(--ok); border-color: color-mix(in srgb, var(--c1) 40%, transparent); font-size: 9.5px; }
.chip-subtag { --c1: var(--info); background: var(--info-soft); color: var(--info); border-color: color-mix(in srgb, var(--c1) 28%, transparent); }
.chip-toolname { text-transform: none; letter-spacing: 0; font-size: 10.5px; font-weight: 600; }

/* tool cards */
.tool-name { font-weight: 650; font-size: 12px; background: none; border: none; padding: 0; color: var(--fg-strong); }
.tool-head { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }
.tool-call { color: var(--muted); font-size: 12px; }
.tool-status { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.st-ok { background: var(--ok); box-shadow: 0 0 0 3px var(--ok-soft); }
.st-err { background: var(--danger); box-shadow: 0 0 0 3px var(--danger-soft); }
.st-run { background: var(--info); box-shadow: 0 0 0 3px var(--info-soft); animation: pulse-soft 1.2s ease-in-out infinite; }
.st-pend { background: var(--faint); box-shadow: 0 0 0 3px color-mix(in srgb, var(--faint) 18%, transparent); }
.tool-body { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }

.collapse summary, .part-reasoning summary, .part-patch summary {
  cursor: pointer;
  color: var(--muted);
  font-size: 11.5px;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 7px;
}
.collapse summary::-webkit-details-marker, .part-reasoning summary::-webkit-details-marker, .part-patch summary::-webkit-details-marker { display: none; }
.collapse summary::before, .part-reasoning summary::before, .part-patch summary::before {
  content: "";
  width: 0; height: 0;
  border-left: 4px solid var(--faint);
  border-top: 3.5px solid transparent;
  border-bottom: 3.5px solid transparent;
  transition: transform 0.15s ease;
}
details[open].collapse summary::before, details[open].part-reasoning summary::before, details[open].part-patch summary::before { transform: rotate(90deg); }
.col-label { font-weight: 650; text-transform: uppercase; letter-spacing: 0.05em; font-size: 10px; }
.col-err { color: var(--danger); }
.collapse-hint { color: var(--faint); font-size: 11px; }

.step-start-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.collapse-toggle {
  background: var(--surface-2);
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 3px 10px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.collapse-toggle:hover { border-color: var(--border-strong); color: var(--fg); background: var(--surface-3); }

.pre {
  background: var(--code-bg);
  border: 1px solid var(--code-border);
  border-radius: var(--radius);
  padding: 10px 12px;
  font-size: 12px;
}
.part-tool .pre, .part-retry .pre, .reasoning { max-height: 420px; overflow: auto; margin-top: 8px; }
.part-tool .pre.output { max-height: 520px; }
.text { background: none; border: none; padding: 2px; }
.error { border-color: color-mix(in srgb, var(--danger) 40%, var(--code-border)); color: color-mix(in srgb, var(--danger) 80%, var(--fg)); background: color-mix(in srgb, var(--danger) 6%, var(--code-bg)); }
.patch-files { margin: 8px 0 0; padding-left: 22px; }
.patch-files li { margin: 3px 0; }
.subtask-prompt { margin-top: 8px; }

@keyframes sectflash { 0% { box-shadow: 0 0 0 3px var(--accent); } 100% { box-shadow: 0 0 0 3px transparent; } }
.sess.sect-flash { animation: sectflash 1.6s ease-out; }

.footer { text-align: center; color: var(--faint); font-size: 11.5px; padding: 22px; border-top: 1px solid var(--border); font-variant-numeric: tabular-nums; }

#toTop {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 30;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--surface-3) 90%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: var(--fg);
  border: 1px solid var(--border-strong);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-md);
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease, opacity 0.15s ease;
  opacity: 0;
  pointer-events: none;
}
#toTop svg { width: 17px; height: 17px; }
#toTop.visible { opacity: 1; pointer-events: auto; }
#toTop:hover { border-color: var(--accent); color: var(--accent); transform: translateY(-2px); }
#toTop:active { transform: translateY(0); }

@media print {
  body { background: #fff; color: #111; }
  .top, .sect-nav, #toTop { position: static; backdrop-filter: none; }
  .part-tool .pre, .part-tool .pre.output, .reasoning { max-height: none; }
  details { display: block; }
  details > summary { list-style: none; }
  .seg { border: 1px solid #999; }
}
`
}
