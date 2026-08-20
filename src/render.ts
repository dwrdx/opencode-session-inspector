import { formatTimestamp, pctDuration, type MsgN, type Part, type SessionDetail, type SessionInfoN } from "./decode.ts"

export interface RenderOptions {
  readonly dbFilename: string
  readonly generatedAt: string
}

const APP_NAME = "opencode-session-inspector"

const FAVICON_DATA_URI =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+CiAgPGRlZnM+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImJnIiB4MT0iMCIgeTE9IjAiIHgyPSIxIiB5Mj0iMSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iIzJmMmYzNCIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMwYzBjMGYiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgPC9kZWZzPgogIDxyZWN0IHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgcng9IjciIGZpbGw9InVybCgjYmcpIi8+CiAgPHJlY3QgeD0iNSIgeT0iMTIuNSIgd2lkdGg9IjIyIiBoZWlnaHQ9IjciIHJ4PSIzLjUiIGZpbGw9IiMxYzFjMWYiLz4KICA8cmVjdCB4PSI1IiB5PSIxMi41IiB3aWR0aD0iMTAuNSIgaGVpZ2h0PSI3IiByeD0iMy41IiBmaWxsPSIjZjJiNDVjIi8+CiAgPHJlY3QgeD0iMTUuNSIgeT0iMTIuNSIgd2lkdGg9IjExLjUiIGhlaWdodD0iNyIgcng9IjMuNSIgZmlsbD0iI2E3OGJmYSIvPgo8L3N2Zz4="

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
    <summary><span class="chip chip-reasoning">reasoning</span></summary>
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
    <summary><span class="chip chip-patch">patch</span> <span class="muted">hash</span> <code>${esc(part.hash.slice(0, 12))}</code> · ${part.files.length} file${part.files.length === 1 ? "" : "s"}</summary>
    <ul class="patch-files">${part.files.map((file) => `<li><code>${esc(file)}</code></li>`).join("")}</ul>
  </details>`
}

function renderTool(part: Extract<Part, { kind: "tool" }>): string {
  const badge =
    part.status === "completed"
      ? `<span class="chip chip-ok">done</span>`
      : part.status === "error"
        ? `<span class="chip chip-error">error</span>`
        : part.status === "running"
          ? `<span class="chip chip-running">running</span>`
          : `<span class="chip chip-pending">pending</span>`
  const duration = pctDuration(part.time?.start, part.time?.end)
  const inputHtml = part.input ? `<details class="collapse"><summary>input</summary><pre class="pre">${esc(part.input)}</pre></details>` : ""
  const outputHtml =
    part.output !== undefined
      ? `<details class="collapse"><summary>output</summary><pre class="pre output">${esc(part.output)}</pre></details>`
      : ""
  const errorHtml = part.error ? `<details class="collapse"><summary>error</summary><pre class="pre error">${esc(part.error)}</pre></details>` : ""
  return `<div class="part part-tool">
    <div class="tool-head">
      ${badge}<span class="chip chip-tool">tool</span>
      <code class="tool-name">${esc(part.tool)}</code>
      ${part.title && part.title !== part.tool ? ` <span class="muted">·</span> <span class="tool-call">${esc(part.title)}</span>` : ""}
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
  return `<div class="meta-row"><span class="meta-key">${esc(key)}</span><span class="meta-value">${esc(value)}</span>${extra}</div>`
}

function renderInfo(info: SessionInfoN, messageCount: number, totalTools: number): string {
  const model = info.model ? `${info.model.providerID}/${info.model.modelID}${info.model.variant ? `@${info.model.variant}` : ""}` : (info.agent ?? "—")
  const meta: string[] = []
  meta.push(metaRow("session id", info.id))
  meta.push(metaRow("title", info.title || "(untitled)"))
  meta.push(metaRow("created", formatTimestamp(info.timeCreated)))
  meta.push(metaRow("updated", formatTimestamp(info.timeUpdated)))
  if (info.timeCompacting) meta.push(metaRow("compacting", formatTimestamp(info.timeCompacting)))
  if (info.timeArchived) meta.push(metaRow("archived", formatTimestamp(info.timeArchived)))
  meta.push(metaRow("directory", info.directory))
  if (info.path) meta.push(metaRow("path", info.path))
  if (info.slug) meta.push(metaRow("slug", info.slug))
  meta.push(metaRow("version", info.version))
  if (info.projectName) meta.push(metaRow("project", info.projectName))
  if (info.workspaceDirectory) meta.push(metaRow("workspace", info.workspaceDirectory))
  if (info.agent) meta.push(metaRow("agent", info.agent))
  meta.push(metaRow("model", model))
  meta.push(metaRow("messages", String(messageCount)))
  meta.push(metaRow("tool calls", String(totalTools)))
  meta.push(metaRow("cost", fmtCost(info.cost)))
  meta.push(metaRow("tokens", tokensLine(info.tokens)))
  if (info.parentId) meta.push(metaRow("parent", info.parentId))
  return `<div class="meta">${meta.join("")}</div>`
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
    <div class="segment-caption"><span>message tokens · total ${fmtInt(total)}</span><span>user ${fmtInt(userTotal)} (${pct(userTotal)}) · assistant ${fmtInt(asstTotal)} (${pct(asstTotal)})</span></div>
  </section>`
}

export function renderDetail(detail: SessionDetail, options: RenderOptions): string {
  const messages = detail.messages
  const totalTools = messages.reduce((acc, msg) => acc + msg.parts.filter((p) => p.kind === "tool").length, 0)
  const messageCount = messages.length
  const inner = messages.map(renderMessage).join("")

  const auditLine = `Generated ${esc(options.generatedAt)} · DB ${esc(options.dbFilename)} · ${APP_NAME}`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(detail.info.title || detail.info.id)}</title>
<link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URI}">
<style>${css()}</style>
</head>
<body>
<header class="top">
  <h1 class="session-title">${esc(detail.info.title || "(untitled session)")}</h1>
  <div class="top-actions">
    <a id="exportBtn" class="top-btn" href="/session/${esc(detail.info.id)}?export=1" download>export html</a>
    <button id="toggleAll" type="button">expand/collapse all</button>
    <button id="themeToggle" type="button" title="Toggle light/dark mode">light</button>
  </div>
</header>
${renderInfo(detail.info, messageCount, totalTools)}
${renderSegmentBar(messages)}
<div class="transcript">${inner || `<div class="empty">No messages in this session.</div>`}</div>
<footer class="footer">${auditLine}</footer>
<button id="toTop" type="button" title="Back to top">↑</button>
<script>${jsToggle()}</script>
</body>
</html>`
}

function jsToggle(): string {
  return `document.getElementById("toggleAll")?.addEventListener("click", () => {
  const details = document.querySelectorAll(".transcript details")
  const anyClosed = Array.from(details).some((d) => !d.open)
  details.forEach((d) => (d.open = anyClosed))
});document.querySelector(".segment-bar")?.addEventListener("click", (event) => {
  const seg = event.target.closest(".seg")
  if (!seg) return
  const target = document.getElementById(seg.dataset.target)
  if (!target) return
  target.open = true
  target.scrollIntoView({ behavior: "smooth", block: "start" })
  target.classList.remove("flash")
  void target.offsetWidth
  target.classList.add("flash")
});document.getElementById("toTop")?.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" })
});const themeBtn = document.getElementById("themeToggle")
  const applyTheme = (theme) => {
    document.documentElement.dataset.theme = theme
    if (themeBtn) themeBtn.textContent = theme === "light" ? "dark" : "light"
  }
  let initialTheme = "dark"
  try { initialTheme = localStorage.getItem("si-theme") || "dark" } catch {}
  applyTheme(initialTheme === "light" ? "light" : "dark")
  themeBtn?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light"
    applyTheme(next)
    try { localStorage.setItem("si-theme", next) } catch {}
  });document.querySelectorAll(".collapse-toggle").forEach((btn) => {
  const card = btn.closest(".msg")
  const inner = card ? Array.from(card.querySelectorAll("details")) : []
  const sync = () => (btn.textContent = inner.some((d) => d.open) ? "collapse" : "expand")
  sync()
  btn.addEventListener("click", (event) => {
    event.stopPropagation()
    const anyOpen = inner.some((d) => d.open)
    inner.forEach((d) => (d.open = !anyOpen))
    sync()
  })
})`
}

function css(): string {
  return `:root{color-scheme:dark;--bg:#000000;--panel:#1c1c1e;--border:#38383a;--fg:#f5f5f7;--muted:#98989d;--accent:#0a84ff;--ok:#30d158;--err:#ff453a;--warn:#ffd60a;--chip:#2c2c2e;--wash:#151517;--head:#222226;--hover:#28282c;--code:#111114;--code2:#1a1a1d;--soft:#2a2a2c;--err-bd:#4a1f1d;--err-ink:#ff6961;--role-user:#f2b45c;--role-asst:#a78bfa}
:root[data-theme="light"]{color-scheme:light;--bg:#f5f5f7;--panel:#ffffff;--border:#d6d6dc;--fg:#1d1d1f;--muted:#6e6e73;--accent:#0066ff;--ok:#248a3d;--err:#d70015;--warn:#a05a00;--chip:#e8e8ee;--wash:#f0f0f3;--head:#f2f2f5;--hover:#e4e4ea;--code:#f7f7fa;--code2:#ececf1;--soft:#e3e3e8;--err-bd:#f2b8b3;--err-ink:#c22b24;--role-user:#9a6416;--role-asst:#5f55d8}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 -apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent)}
code{font-family:"SF Mono",ui-monospace,"JetBrains Mono","Cascadia Code",Consolas,monospace;font-size:12.5px;background:var(--code2);border:1px solid var(--border);border-radius:5px;padding:1px 5px}
pre{white-space:pre-wrap;word-break:break-word;margin:0}
.top{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:14px 20px;border-bottom:1px solid var(--border);background:color-mix(in srgb,var(--panel) 86%,transparent);backdrop-filter:blur(14px) saturate(1.2);position:sticky;top:0;z-index:5}
.session-title{margin:0;font-size:18px;font-weight:650;letter-spacing:-.01em;min-width:0;overflow-wrap:anywhere}
.top-actions{display:flex;gap:8px}
.top-actions button,.top-actions a.top-btn{background:var(--chip);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:6px 13px;font-size:12.5px;cursor:pointer;transition:border-color .15s ease,background .15s ease,transform .1s ease;display:inline-flex;align-items:center;text-decoration:none}
.top-actions button:hover,.top-actions a.top-btn:hover{border-color:color-mix(in srgb,var(--accent) 55%,var(--border));background:var(--hover);color:var(--fg);text-decoration:none}
.top-actions button:active,.top-actions a.top-btn:active{transform:scale(.97)}
.meta{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:2px 24px;padding:12px 20px;border-bottom:1px solid var(--border);background:var(--wash)}
.meta-row{display:flex;gap:8px;min-width:0}
.meta-key{color:var(--muted);flex:0 0 86px;overflow:hidden;text-overflow:ellipsis}
.meta-value{min-width:0;overflow-wrap:anywhere}
.segment-wrap{padding:12px 20px;border-bottom:1px solid var(--border);background:var(--wash)}
.segment-bar{display:flex;height:20px;border-radius:4px;overflow:hidden;background:var(--code2);border:1px solid var(--border)}
.seg{min-width:3px;cursor:pointer;transition:filter .15s ease}
.seg:hover{filter:brightness(1.35)}
.seg-user{background:var(--role-user)}
.seg-assistant{background:var(--role-asst)}
.segment-caption{display:flex;justify-content:space-between;gap:12px;font-size:11px;color:var(--muted);margin-top:6px;font-variant-numeric:tabular-nums}
@keyframes segflash{0%{box-shadow:0 0 0 3px var(--accent)}100%{box-shadow:0 0 0 3px transparent}}
.msg.flash{animation:segflash 1.6s ease-out}
.transcript{max-width:1020px;margin:0 auto;padding:18px 20px 60px}
.empty{padding:40px;color:var(--muted);text-align:center}
.msg{border:1px solid var(--border);border-radius:12px;background:var(--panel);margin:14px 0;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.05),0 4px 14px rgba(0,0,0,.04);scroll-margin-top:72px}
.msg-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid var(--border);background:var(--head);font-size:12px}
details.msg>summary{list-style:none;cursor:pointer;user-select:none}
details.msg>summary::-webkit-details-marker{display:none}
details.msg>summary:hover{background:var(--hover)}
details.msg:not([open])>summary{border-bottom:none}
.role{display:inline-block;font-weight:700;text-transform:uppercase;letter-spacing:.4px;font-size:11px;border-radius:999px;padding:2px 9px}
.role.user{color:var(--role-user);background:color-mix(in srgb,var(--role-user) 14%,transparent)}
.role.assistant{color:var(--role-asst);background:color-mix(in srgb,var(--role-asst) 14%,transparent)}
.time{font-variant-numeric:tabular-nums}
.msg-stats{font-variant-numeric:tabular-nums}
.model-badge{font-variant-numeric:tabular-nums}
.msg-body{padding:14px}
.msg.user .msg-body{padding:12px 16px}
.user-text{white-space:pre-wrap;color:var(--fg)}
.parts{padding:6px 14px 14px}
.part{border-bottom:1px solid var(--soft);padding:10px 0}
.part:last-child{border-bottom:none}
.part-text{padding-top:6px}
.chip{display:inline-block;font-size:10.5px;font-weight:650;letter-spacing:.3px;border-radius:999px;padding:2px 9px;margin-right:6px;vertical-align:middle;border:1px solid transparent}
.chip-tool{--c1:#a58bff;background:color-mix(in srgb,var(--c1) 15%,transparent);color:color-mix(in srgb,var(--c1) 74%,var(--fg));border-color:color-mix(in srgb,var(--c1) 28%,transparent)}
.chip-ok{--c1:#30d158;background:color-mix(in srgb,var(--c1) 15%,transparent);color:color-mix(in srgb,var(--c1) 74%,var(--fg));border-color:color-mix(in srgb,var(--c1) 28%,transparent)}
.chip-error{--c1:#ff453a;background:color-mix(in srgb,var(--c1) 15%,transparent);color:color-mix(in srgb,var(--c1) 74%,var(--fg));border-color:color-mix(in srgb,var(--c1) 28%,transparent)}
.chip-warn{--c1:#ffd60a;background:color-mix(in srgb,var(--c1) 18%,transparent);color:color-mix(in srgb,var(--c1) 72%,var(--fg));border-color:color-mix(in srgb,var(--c1) 30%,transparent)}
.chip-running{--c1:#5ac8fa;background:color-mix(in srgb,var(--c1) 15%,transparent);color:color-mix(in srgb,var(--c1) 74%,var(--fg));border-color:color-mix(in srgb,var(--c1) 28%,transparent)}
.chip-pending{--c1:var(--muted);background:color-mix(in srgb,var(--c1) 18%,transparent);color:color-mix(in srgb,var(--c1) 70%,var(--fg));border-color:color-mix(in srgb,var(--c1) 30%,transparent)}
.chip-reasoning{--c1:#8e8aff;background:color-mix(in srgb,var(--c1) 15%,transparent);color:color-mix(in srgb,var(--c1) 74%,var(--fg));border-color:color-mix(in srgb,var(--c1) 28%,transparent)}
.chip-marker{--c1:var(--muted);background:color-mix(in srgb,var(--c1) 16%,transparent);color:color-mix(in srgb,var(--c1) 72%,var(--fg));border-color:color-mix(in srgb,var(--c1) 28%,transparent)}
.chip-agent{--c1:#63e6be;background:color-mix(in srgb,var(--c1) 15%,transparent);color:color-mix(in srgb,var(--c1) 74%,var(--fg));border-color:color-mix(in srgb,var(--c1) 28%,transparent)}
.chip-file{--c1:#b0b0b6;background:color-mix(in srgb,var(--c1) 16%,transparent);color:color-mix(in srgb,var(--c1) 74%,var(--fg));border-color:color-mix(in srgb,var(--c1) 28%,transparent)}
.chip-subtask{--c1:#ffcc00;background:color-mix(in srgb,var(--c1) 18%,transparent);color:color-mix(in srgb,var(--c1) 72%,var(--fg));border-color:color-mix(in srgb,var(--c1) 30%,transparent)}
.chip-synthetic{--c1:#bfa6ff;background:color-mix(in srgb,var(--c1) 15%,transparent);color:color-mix(in srgb,var(--c1) 74%,var(--fg));border-color:color-mix(in srgb,var(--c1) 28%,transparent)}
.chip-patch{--c1:#5ac8fa;background:color-mix(in srgb,var(--c1) 15%,transparent);color:color-mix(in srgb,var(--c1) 74%,var(--fg));border-color:color-mix(in srgb,var(--c1) 28%,transparent)}
.chip-finish{--c1:var(--muted);background:color-mix(in srgb,var(--c1) 16%,transparent);color:var(--muted);border-color:color-mix(in srgb,var(--c1) 28%,transparent);font-size:10px;text-transform:uppercase}
.chip-stop{--c1:#30d158;background:color-mix(in srgb,var(--c1) 18%,transparent);color:color-mix(in srgb,var(--c1) 84%,var(--fg));border-color:color-mix(in srgb,var(--c1) 55%,transparent);font-size:10px;font-weight:800;text-transform:uppercase}
.chip-toolname{--c1:#a58bff;background:color-mix(in srgb,var(--c1) 14%,transparent);color:color-mix(in srgb,var(--c1) 74%,var(--fg));border-color:color-mix(in srgb,var(--c1) 26%,transparent)}
.muted{color:var(--muted)}
.tool-name{font-weight:700}
.tool-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.tool-duration{font-variant-numeric:tabular-nums}
.collapse{margin-top:8px}
.collapse summary{cursor:pointer;color:var(--muted);font-size:12px}
.step-start-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.collapse-toggle{background:var(--chip);color:var(--muted);border:1px solid var(--border);border-radius:8px;font-size:11px;padding:2px 10px;cursor:pointer;transition:border-color .15s ease,color .15s ease}
.collapse-toggle:hover{border-color:color-mix(in srgb,var(--accent) 55%,var(--border));color:var(--fg)}
.part-tool .pre,.part-retry .pre,.reasoning{background:var(--code);border:1px solid var(--border);border-radius:8px;padding:10px;margin-top:8px;max-height:420px;overflow:auto}
.part-tool .pre.output{max-height:520px}
.pre{background:var(--code);border:1px solid var(--border);border-radius:8px;padding:10px}
.text{background:none;border:none;padding:2px}
.user-text{padding:8px 2px;background:none;border:none}
.error{border-color:var(--err-bd);color:var(--err-ink)}
.patch-files{margin:8px 0 0;padding-left:22px}
.patch-files li{margin:2px 0}
.subtask-prompt{margin-top:8px}
.footer{text-align:center;color:var(--muted);font-size:12px;padding:20px;border-top:1px solid var(--border)}
#toTop{position:fixed;right:20px;bottom:20px;z-index:30;width:44px;height:44px;border-radius:50%;background:color-mix(in srgb,var(--panel) 84%,transparent);backdrop-filter:blur(12px);color:var(--fg);border:1px solid var(--border);font-size:17px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(0,0,0,.18);transition:border-color .15s ease,background .15s ease,transform .1s ease}
#toTop:hover{border-color:color-mix(in srgb,var(--accent) 55%,var(--border));background:var(--hover);transform:translateY(-1px)}
@media print{body{background:#fff;color:#111}.part-tool .pre,.part-tool .pre.output,.reasoning{max-height:none}details:not(.collapse){display:block}.collapse{display:block}}
`
}