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

async function render() {
  const tbody = $("sessionsBody")
  tbody.innerHTML = `<tr><td colspan="9" class="empty-td muted">loading…</td></tr>`
  try {
    const data = await fetchJson(`/api/sessions?${paramFilter()}`)
    state.total = data.total
    $("statTotal").textContent = `${data.total} session${data.total === 1 ? "" : "s"}`
    $("pageInfo").textContent = `${data.offset + 1}–${data.offset + data.sessions.length} of ${data.total}`
    $("btnPrev").disabled = data.offset <= 0
    $("btnNext").disabled = data.offset + data.sessions.length >= data.total
    $("checkAll").checked = data.sessions.length > 0 && data.sessions.every((s) => selected.has(s.id))
    updateBulkDelete()

    if (data.sessions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty-td muted">no sessions match</td></tr>`
      return
    }
    tbody.innerHTML = buildHierarchyRows([...(data.parents || []), ...data.sessions])
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-td">${esc(error.message)}</td></tr>`
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
  const padStyle = sub ? ` style="padding-left:${46 + Math.max(0, depth - 1) * 22}px"` : ""
  const checked = selected.has(s.id) ? " checked" : ""
  return `<tr class="${sub ? "sub-row" : "main-row"}${selected.has(s.id) ? " row-selected" : ""}" data-id="${esc(s.id)}">
    <td class="col-check-td">
      <input type="checkbox" class="row-check" data-id="${esc(s.id)}"${checked}>
    </td>
    <td${padStyle}>
      <div class="title-cell">
        ${sub ? '<span class="sub-arrow">↳</span>' : ""}
        <a class="session-title" href="/session/${esc(s.id)}" target="_blank">${esc(s.title || "(untitled)")}</a>
        ${sub ? '<span class="chip-sub">sub</span>' : ""}
      </div>
      <div class="title-meta">${esc(s.id)}${orphan ? ` · <span class="sub-parent-hint">parent ${esc(s.parentId)}</span>` : ""}</div>
    </td>
    <td><span class="directory">${esc(s.directory || "—")}</span></td>
    <td>${esc(s.agent ?? "—")}</td>
    <td><code title="${esc(modelLabel(s.model))}">${esc(modelLabel(s.model))}</code></td>
    <td>${fmtTime(s.timeUpdated)}</td>
    <td>${s.messageCount}</td>
    <td>${fmtCost(s.cost)}</td>
    <td>
      <div class="row-actions">
        <a class="action-btn" href="/session/${esc(s.id)}" target="_blank" rel="noopener">open</a>
        <a class="action-btn" href="/session/${esc(s.id)}?export=1" target="_blank" rel="noopener" download>export</a>
        <button class="action-btn danger" data-action="delete">delete</button>
      </div>
    </td>
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
    `Delete <strong>${esc(session.title || "(untitled)")}</strong>?<div class="session-dir">${esc(session.id)} · ${esc(session.directory || "")}</div>` +
    `<div class="confirm-sub">Sub-sessions (children) of this session will be deleted too.</div>`
  $("confirmOverlay").hidden = false
}

function openBulkConfirm() {
  const ids = Array.from(selected)
  if (ids.length === 0) return
  bulkDeleteIds = ids
  deletingId = null
  $("confirmTitle").textContent = "Delete sessions"
  $("confirmText").innerHTML =
    `Delete <strong>${ids.length}</strong> selected session${ids.length === 1 ? "" : "s"}?` +
    `<div class="confirm-sub">Sub-sessions (children) of each selected session will be deleted too.</div>`
  $("confirmOverlay").hidden = false
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
  btn.textContent = n === 0 ? "delete selected" : `delete selected (${n})`
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

function initTheme() {
  const themeBtn = $("themeToggle")
  if (!themeBtn) return
  const applyTheme = (theme) => {
    document.documentElement.dataset.theme = theme
    themeBtn.textContent = theme === "light" ? "dark" : "light"
  }
  let initial = "dark"
  try {
    initial = localStorage.getItem("si-theme") || "dark"
  } catch {}
  applyTheme(initial === "light" ? "light" : "dark")
  themeBtn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light"
    applyTheme(next)
    try {
      localStorage.setItem("si-theme", next)
    } catch {}
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

  void render()
}

init()