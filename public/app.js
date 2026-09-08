const $ = (id) => document.getElementById(id)

const state = {
  search: "",
  agent: "",
  model: "",
  from: undefined,
  to: undefined,
  limit: 50,
  offset: 0,
  total: 0,
}

const selected = new Set()
let deletingId = null
let bulkDeleteIds = null

const ICONS = {
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  export: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
}

const fmtTime = (ms) => {
  if (!ms) return "—"
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const fmtCost = (v) => {
  if (!v) return "—"
  if (v < 0.01) return `$${v.toFixed(4)}`
  return `$${v.toFixed(2)}`
}

const esc = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

const modelLabel = (model) => {
  if (!model) return "—"
  const id = model.modelID ?? model.id ?? ""
  return `${model.providerID ?? ""}/${id}`
}

function paramFilter() {
  const params = new URLSearchParams()
  const push = (key, value) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value))
  }
  push("search", state.search)
  push("agent", state.agent)
  push("model", state.model)
  push("from", state.from)
  push("to", state.to)
  push("limit", state.limit)
  push("offset", state.offset)
  return params.toString()
}

async function fetchJson(url, options) {
  const res = await fetch(url, options)
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`${res.status} ${text.slice(0, 300)}`)
  }
  return res.json()
}

function skeletonRows() {
  return Array.from({ length: 8 }, () => `
    <tr class="skeleton-row">
      <td class="col-check-td"></td>
      <td><span class="skeleton" style="width:62%"></span><div style="height:6px"></div><span class="skeleton" style="width:38%;height:9px"></span></td>
      <td><span class="skeleton" style="width:70%"></span></td>
      <td><span class="skeleton" style="width:60%"></span></td>
      <td><span class="skeleton" style="width:75%"></span></td>
      <td><span class="skeleton" style="width:55%"></span></td>
      <td><span class="skeleton" style="width:30%"></span></td>
      <td><span class="skeleton" style="width:40%;margin-left:auto;display:block"></span></td>
      <td></td>
    </tr>`).join("")
}

function emptyState(message, hint = "") {
  return `<tr><td colspan="9" class="empty-td">
    <div class="empty-state">
      ${ICONS.inbox}
      <div class="empty-title">${esc(message)}</div>
      ${hint ? `<div class="empty-sub">${esc(hint)}</div>` : ""}
    </div>
  </td></tr>`
}

async function render() {
  const tbody = $("sessionsBody")
  tbody.innerHTML = skeletonRows()
  try {
    const data = await fetchJson(`/api/sessions?${paramFilter()}`)
    state.total = data.total
    $("statTotal").textContent = `${data.total} session${data.total === 1 ? "" : "s"}`
    $("pageInfo").textContent = data.sessions.length
      ? `${data.offset + 1}–${data.offset + data.sessions.length} of ${data.total}`
      : `0 of ${data.total}`
    $("btnPrev").disabled = data.offset <= 0
    $("btnNext").disabled = data.offset + data.sessions.length >= data.total
    const pageAll = [...(data.parents || []), ...data.sessions]
    const pageIds = new Set(pageAll.map((s) => s.id))
    const selectable = pageAll.filter((s) => !s.parentId || !pageIds.has(s.parentId))
    $("checkAll").checked = selectable.length > 0 && selectable.every((s) => selected.has(s.id))
    updateBulkDelete()

    if (data.sessions.length === 0) {
      const hasFilter = state.search || state.agent || state.model || state.from || state.to
      tbody.innerHTML = hasFilter
        ? emptyState("no sessions match", "try clearing or adjusting the filters")
        : emptyState("no sessions yet", "sessions created in opencode will appear here")
      return
    }
    tbody.innerHTML = buildHierarchyRows(pageAll)
  } catch (error) {
    tbody.innerHTML = emptyState("failed to load", error.message)
  }
}

function buildHierarchyRows(sessions) {
  const byId = new Map(sessions.map((s) => [s.id, s]))
  const childrenByParent = new Map()
  for (const s of sessions) {
    if (s.parentId && byId.has(s.parentId)) {
      const list = childrenByParent.get(s.parentId) || []
      list.push(s)
      childrenByParent.set(s.parentId, list)
    }
  }
  const rows = []
  const walk = (s, depth) => {
    rows.push({ s, sub: depth > 0 || Boolean(s.parentId), orphan: Boolean(s.parentId && !byId.has(s.parentId)), depth })
    for (const child of childrenByParent.get(s.id) || []) walk(child, depth + 1)
  }
  for (const s of sessions) {
    if (!s.parentId || !byId.has(s.parentId)) walk(s, 0)
  }
  return rows.map(({ s, sub, orphan, depth }) => sessionRow(s, sub, orphan, depth)).join("")
}

function sessionRow(s, sub, orphan, depth) {
  // Child sessions are managed through their main (root) session: no checkbox,
  // export or delete on their rows. Orphans (parent gone from the db) count as roots.
  const isRoot = !sub || orphan
  const checked = selected.has(s.id) ? " checked" : ""
  const checkCell = isRoot
    ? `<input type="checkbox" class="row-check" data-id="${esc(s.id)}"${checked} aria-label="Select session">`
    : ""
  const indent = sub ? `<span class="sub-indent" style="width:${14 + Math.max(0, depth - 1) * 16}px"></span><span class="sub-arrow">↳</span>` : ""
  const actions = isRoot
    ? `<div class="row-actions">
        <a class="action-btn act-open" href="/session/${esc(s.id)}" target="_blank" rel="noopener" title="Open session">${ICONS.open}</a>
        <a class="action-btn act-export" href="/session/${esc(s.id)}?export=1" target="_blank" rel="noopener" download title="Export as HTML">${ICONS.export}</a>
        <button class="action-btn act-delete" data-action="delete" title="Delete session tree">${ICONS.delete}</button>
      </div>`
    : `<div class="row-actions">
        <a class="action-btn act-open" href="/session/${esc(s.id)}" target="_blank" rel="noopener" title="Open session">${ICONS.open}</a>
      </div>`
  const model = modelLabel(s.model)
  return `<tr class="${sub ? "sub-row" : "main-row"}${selected.has(s.id) ? " row-selected" : ""}" data-id="${esc(s.id)}" data-root="${isRoot ? "1" : "0"}">
    <td class="col-check-td">${checkCell}</td>
    <td>
      <div class="title-cell">
        ${indent}
        <a class="session-title" href="/session/${esc(s.id)}" target="_blank">${esc(s.title || "(untitled)")}</a>
        ${sub ? '<span class="chip-sub">sub</span>' : ""}
      </div>
      <div class="title-meta" style="${sub ? `padding-left:${14 + Math.max(0, depth - 1) * 16 + 20}px` : ""}">${esc(s.id)}${orphan ? ` · <span class="sub-parent-hint">parent ${esc(s.parentId)}</span>` : ""}</div>
    </td>
    <td><span class="directory">${esc(s.directory || "—")}</span></td>
    <td><span class="agent-name">${esc(s.agent ?? "—")}</span></td>
    <td><code title="${esc(model)}">${esc(model)}</code></td>
    <td>${fmtTime(s.timeUpdated)}</td>
    <td>${s.messageCount}</td>
    <td>${fmtCost(s.cost)}</td>
    <td class="col-actions">${actions}</td>
  </tr>`
}

function toEpoch(input) {
  if (!input) return undefined
  const d = new Date(input)
  return Number.isNaN(d.getTime()) ? undefined : d.getTime()
}

function applyFilters() {
  state.search = $("fSearch").value.trim()
  state.agent = $("fAgent").value.trim()
  state.model = $("fModel").value.trim()
  state.from = toEpoch($("fFrom").value)
  state.to = toEpoch($("fTo").value)
  state.offset = 0
  selected.clear()
  updateBulkDelete()
  render()
}

function clearFilters() {
  $("fSearch").value = ""
  $("fAgent").value = ""
  $("fModel").value = ""
  $("fFrom").value = ""
  $("fTo").value = ""
  state.search = ""
  state.agent = ""
  state.model = ""
  state.from = undefined
  state.to = undefined
  state.offset = 0
  render()
}

function openConfirm(session) {
  bulkDeleteIds = null
  deletingId = session.id
  $("confirmTitle").textContent = "Delete session"
  $("confirmText").innerHTML =
    `Delete <strong>${esc(session.title || "(untitled)")}</strong>?<span class="session-dir">${esc(session.id)} · ${esc(session.directory || "")}</span>` +
    `<span class="confirm-sub">Sub-sessions (children) of this session will be deleted too.</span>`
  $("confirmOverlay").hidden = false
  $("btnCancel").focus()
}

function openBulkConfirm() {
  const ids = Array.from(selected)
  if (ids.length === 0) return
  bulkDeleteIds = ids
  deletingId = null
  $("confirmTitle").textContent = "Delete sessions"
  $("confirmText").innerHTML =
    `Delete <strong>${ids.length}</strong> selected session${ids.length === 1 ? "" : "s"}?` +
    `<span class="confirm-sub">Sub-sessions (children) of each selected session will be deleted too.</span>`
  $("confirmOverlay").hidden = false
  $("btnCancel").focus()
}

function closeConfirm() {
  $("confirmOverlay").hidden = true
  deletingId = null
  bulkDeleteIds = null
}

function updateBulkDelete() {
  const btn = $("btnBulkDelete")
  if (!btn) return
  const n = selected.size
  btn.disabled = n === 0
  btn.querySelector(".bulk-label").textContent = n === 0 ? "delete selected" : `delete (${n})`
}

async function deleteSessions(ids) {
  try {
    let result
    if (ids.length === 1) {
      result = await fetchJson(`/api/sessions/${encodeURIComponent(ids[0])}`, { method: "DELETE" })
    } else {
      result = await fetchJson(`/api/sessions`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      })
    }
    if (result.ok) {
      const n = Array.isArray(result.removed) ? result.removed.length : ids.length
      for (const id of ids) selected.delete(id)
      updateBulkDelete()
      presentToast(`Deleted ${n} session${n === 1 ? "" : "s"}${result.artifacts?.length ? ` (+${result.artifacts.length} artifact(s))` : ""}`)
      render()
    }
  } catch (error) {
    presentToast(`Delete failed: ${error.message}`, true)
  }
}

function presentToast(message, error = false) {
  let toast = document.getElementById("toast")
  if (!toast) {
    toast = document.createElement("div")
    toast.id = "toast"
    document.body.appendChild(toast)
  }
  toast.classList.toggle("error", Boolean(error))
  toast.textContent = message
  clearTimeout(toast._t)
  toast._t = setTimeout(() => toast.remove(), 4000)
}

/* ---------- theme: system -> light -> dark ---------- */
function initTheme() {
  const themeBtn = $("themeToggle")
  if (!themeBtn) return
  const root = document.documentElement
  const mq = window.matchMedia("(prefers-color-scheme: light)")

  const effective = (mode) => (mode === "system" ? (mq.matches ? "light" : "dark") : mode)

  const applyMode = (mode) => {
    const theme = effective(mode)
    root.dataset.themeMode = mode
    if (theme === "light") root.setAttribute("data-theme", "light")
    else root.removeAttribute("data-theme")
    const title = mode === "system" ? `Theme: system (${theme})` : `Theme: ${mode}`
    themeBtn.title = title
    themeBtn.setAttribute("aria-label", title)
  }

  let mode = "system"
  try {
    mode = localStorage.getItem("si-theme-mode") || "system"
  } catch {}
  if (mode !== "light" && mode !== "dark" && mode !== "system") mode = "system"
  applyMode(mode)

  themeBtn.addEventListener("click", () => {
    const next = root.dataset.themeMode === "system" ? "light" : root.dataset.themeMode === "light" ? "dark" : "system"
    applyMode(next)
    try {
      localStorage.setItem("si-theme-mode", next)
    } catch {}
  })

  mq.addEventListener("change", () => {
    if (root.dataset.themeMode === "system" || !root.dataset.themeMode) applyMode("system")
  })
}

function tbodyCheckboxes() {
  return Array.from(document.querySelectorAll("#sessionsBody .row-check"))
}

function syncRowSelected() {
  for (const tr of document.querySelectorAll("#sessionsBody tr[data-id]")) {
    const box = tr.querySelector(".row-check")
    tr.classList.toggle("row-selected", Boolean(box && box.checked))
  }
}

async function init() {
  initTheme()
  try {
    const meta = await fetchJson("/api/meta")
    $("dbPath").textContent = meta.db
  } catch {
    $("dbPath").textContent = "cannot reach API"
  }
  $("btnRefresh").addEventListener("click", render)

  let searchTimer = null
  $("fSearch").addEventListener("input", () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(applyFilters, 350)
  })
  $("fAgent").addEventListener("change", applyFilters)
  $("fModel").addEventListener("change", applyFilters)
  $("fFrom").addEventListener("change", applyFilters)
  $("fTo").addEventListener("change", applyFilters)
  $("btnApply").addEventListener("click", applyFilters)
  $("btnClear").addEventListener("click", clearFilters)

  $("btnPrev").addEventListener("click", () => {
    state.offset = Math.max(0, state.offset - state.limit)
    render()
  })
  $("btnNext").addEventListener("click", () => {
    state.offset += state.limit
    render()
  })

  $("checkAll").addEventListener("change", (event) => {
    const checked = event.target.checked
    for (const box of tbodyCheckboxes()) {
      box.checked = checked
      if (checked) selected.add(box.dataset.id)
      else selected.delete(box.dataset.id)
    }
    syncRowSelected()
    updateBulkDelete()
  })

  $("sessionsBody").addEventListener("change", (event) => {
    const box = event.target.closest(".row-check")
    if (!box) return
    if (box.checked) selected.add(box.dataset.id)
    else selected.delete(box.dataset.id)
    $("checkAll").checked = tbodyCheckboxes().length > 0 && tbodyCheckboxes().every((b) => b.checked)
    syncRowSelected()
    updateBulkDelete()
  })

  $("sessionsBody").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-action='delete']")
    if (!btn) return
    const tr = btn.closest("tr")
    const id = tr.dataset.id
    openConfirm({ id, title: tr.querySelector(".session-title").textContent, directory: tr.querySelector(".directory")?.textContent })
  })

  $("btnBulkDelete").addEventListener("click", openBulkConfirm)
  $("btnCancel").addEventListener("click", closeConfirm)
  $("btnDelete").addEventListener("click", () => {
    const ids = bulkDeleteIds ?? (deletingId ? [deletingId] : [])
    closeConfirm()
    if (ids.length) void deleteSessions(ids)
  })
  $("confirmOverlay").addEventListener("click", (event) => {
    if (event.target === $("confirmOverlay")) closeConfirm()
  })
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("confirmOverlay").hidden) closeConfirm()
  })

  void render()
}

init()
