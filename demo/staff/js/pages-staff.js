/* Staff dashboard, staff directory (configurable table), staff profile, and the dialogs they share. */
(function () {
  "use strict";
  const SF = window.SF, { UI, API, fmt, t, L, Out } = SF, { icon, esc } = UI;
  const can = (p, a) => SF.can(p, a);
  const widgetOn = (w) => w.visible && (SF.S.me.isSuper || !w.roles.length || w.roles.some((r) => SF.S.me.roles.includes(r)));

  /* list state survives navigation to a profile and back */
  const st = { q: {}, sort: { key: "", dir: 1 }, page: 1, sel: new Set(), layout: null, filtersOpen: false };
  const CARD_Q = { total: {}, active: { status: "active" }, inactive: { status: "inactive" }, pending: { status: "pending" }, transferred: { card: "transferred" }, new_month: { card: "new_month" } };
  const cardOf = (q) => (q.card ? q.card : q.status && CARD_Q[q.status] ? q.status : !q.status ? "total" : "");

  function statCards(stats, activeKey, clickable) {
    return SF.S.widgets.filter((w) => w.type === "stat" && widgetOn(w)).map((w) => `<button class="stat ${activeKey === w.key ? "on" : ""}" ${clickable ? `data-act="card" data-k="${w.key}"` : `data-act="card" data-k="${w.key}"`}>
      <span class="bub ${w.tone || ""}">${icon(w.icon, "lg")}</span><span style="min-width:0"><span class="v">${stats[w.key] == null ? "–" : stats[w.key]}</span><span class="l" title="${esc(L(w))}">${esc(L(w))}</span></span></button>`).join("");
  }

  /* =============================== DASHBOARD =============================== */
  SF.Pages.dashboard = function (root) {
    if (!can("dashboard", "view")) { root.innerHTML = UI.state("error", t("You do not have access to this page.")); return; }
    const d = API.dashboard(), S = SF.S, scopeTxt = { all: "All hubs and zones", zone: fmt.zone(S.me.zone_id), hub: fmt.hub(S.me.hub_id), self: "Your own record" }[S.me.scope];
    const bars = (map, nameOf) => { const e = Object.keys(map).map((k) => [nameOf(k) || "—", map[k]]).sort((a, b) => b[1] - a[1]), mx = Math.max(1, ...e.map((x) => x[1])); return e.length ? `<div class="bars">${e.map((x) => `<div class="bar"><span title="${esc(x[0])}" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x[0])}</span><span class="trk"><i style="width:${(x[1] / mx) * 100}%"></i></span><b class="num r">${x[1]}</b></div>`).join("")}</div>` : UI.state("empty", "No staff yet"); };
    const panel = { by_hub: () => bars(d.by_hub, fmt.hub), by_position: () => bars(d.by_position, fmt.position),
      pending_list: () => (d.pending.length ? `<div class="tw"><table class="t"><tbody>${d.pending.map((p) => `<tr><td><a class="name" href="#/staff/${p.id}">${esc(p.name)}</a><span class="sub">${esc(fmt.position(p.position_id))} · ${esc(fmt.hub(p.hub_id))}</span></td><td class="r">${can("staff", "approve") ? `<button class="btn sm primary" data-act="approve" data-id="${p.id}">${icon("check", "sm")}Approve</button>` : fmt.status("pending")}</td></tr>`).join("")}</tbody></table></div>` : UI.state("empty", "Nothing is waiting for approval")) + (d.pending_transfers && can("transfers", "view") ? `<div class="card-b"><a class="btn sm" href="#/transfers">${icon("transfer", "sm")}${d.pending_transfers} transfer(s) waiting for approval</a></div>` : ""),
      recent: () => (d.recent === null ? UI.state("empty", "Activity history is not included in your role") : d.recent.length ? `<div class="card-b"><div class="timeline">${d.recent.map((a) => `<div class="tl"><i></i><div><div>${esc(a.summary)}</div><div class="small faint">${esc(fmt.dt(a.at))} · ${esc(a.user_name)}</div></div></div>`).join("")}</div></div>` : UI.state("empty", "No activity yet")) };
    const panels = S.widgets.filter((w) => w.type === "panel" && widgetOn(w));
    root.innerHTML = `<div class="ph"><div><h1>${esc(SF.pageLabel("dashboard"))}</h1><p>${icon("map", "sm")} ${esc(scopeTxt)}</p></div>
      <div class="row">${can("staff", "access") ? `<a class="btn" href="#/staff">${icon("users")}${esc(SF.pageLabel("staff"))}</a>` : ""}</div></div>
      <div class="stats">${statCards(d.stats, "", true) || ""}</div>
      ${!S.widgets.some((w) => widgetOn(w)) ? UI.state("empty", "No dashboard widgets are switched on for your role") : ""}
      <div class="grid g2">${panels.map((w) => `<div class="card"><div class="card-h"><h3>${icon(w.icon)} ${esc(L(w))}</h3></div>${w.key.startsWith("by_") ? `<div class="card-b">${panel[w.key]()}</div>` : panel[w.key]()}</div>`).join("")}</div>`;
    UI.delegate(root, {
      card(b) { if (!can("staff", "access")) return; st.q = Object.assign({}, CARD_Q[b.dataset.k]); st.page = 1; location.hash = "#/staff"; },
      async approve(b) { const ok = await UI.confirm({ title: "Approve staff member", text: "This person becomes an active staff member.", ok: "Approve" }); if (!ok) return; if (SF.run(() => API.staffApprove([b.dataset.id]))) { UI.toast("Approved."); SF.Pages.dashboard(clear(root)); } }
    });
  };
  const clear = (root) => { const n = root.cloneNode(false); root.replaceWith(n); return n; };

  /* =============================== STAFF DIRECTORY =============================== */
  function currentLayout() {
    const S = SF.S, key = "sfhub_layout_" + S.me.user_id;
    if (!st.layout || !S.layouts.some((l) => l.id === st.layout)) { const saved = localStorage.getItem(key); st.layout = S.layouts.some((l) => l.id === saved) ? saved : S.layouts.some((l) => l.id === S.settings.staff.default_layout) ? S.settings.staff.default_layout : (S.layouts[0] || {}).id; }
    localStorage.setItem(key, st.layout || "");
    return S.layouts.find((l) => l.id === st.layout) || { id: "", name: "Default", columns: [{ key: "select", visible: true }, { key: "staff_no", visible: true }, { key: "name", visible: true }, { key: "status", visible: true }, { key: "actions", visible: true }] };
  }
  const colLabel = (c) => c.label || (c.key === "select" ? "Mark" : c.key === "actions" ? "Action" : L(fmt.field(c.key) || { label: c.key }));

  function rowActions(row, redraw) {
    const S = SF.S, removed = !!row.deleted_at, tpl = () => Out.template();
    const done = (r, msg) => { if (r === undefined) return; if (r && r.skipped && r.skipped.length) UI.toast(r.skipped[0], "warn"); else UI.toast(msg); SF.refresh(); redraw(); };
    const impl = {
      view: { ok: can("staff", "view"), run: () => (location.hash = "#/staff/" + row.id) },
      edit: { ok: can("staff", "edit") && !removed, run: () => staffForm(row.id, redraw) },
      transfer: { ok: can("staff", "transfer") && can("transfers", "create") && row.status === "active", run: () => transferDialog(row, redraw) },
      approve: { ok: can("staff", "approve") && row.status === "pending", run: async () => { if (await UI.confirm({ title: "Approve " + row.name + "?", text: "This person becomes an active staff member.", ok: "Approve" })) done(SF.run(() => API.staffApprove([row.id])), "Approved."); } },
      activate: { ok: can("staff", "edit") && row.status === "inactive", run: async () => { if (await UI.confirm({ title: "Activate " + row.name + "?", text: "The staff member will be marked active again.", ok: "Activate" })) done(SF.run(() => API.staffSetStatus([row.id], "active", "")), "Activated."); } },
      deactivate: { ok: can("staff", "edit") && row.status === "active", run: async () => { const c = await UI.confirm({ title: "Deactivate " + row.name + "?", text: "The staff member stays in the list as inactive. Any login session is ended.", reason: true, ok: "Deactivate", danger: true }); if (c) done(SF.run(() => API.staffSetStatus([row.id], "inactive", c.reason)), "Deactivated."); } },
      print: { ok: can("staff", "print"), run: () => { const full = SF.run(() => API.staffGet(row.id)); if (full && SF.run(() => API.logOutput("print", "staff sheet of " + row.name, 1, ""))) Out.staffSheetPrint(tpl(), full); } },
      export: { ok: can("staff", "export"), run: () => { const full = SF.run(() => API.staffGet(row.id)); if (full && SF.run(() => API.logOutput("export", "staff sheet of " + row.name, 1, ""))) { Out.staffSheetXlsx(tpl(), full); UI.toast("Staff sheet downloaded."); } } },
      activity: { ok: can("staff_activity", "view"), run: () => activityDrawer(row) },
      remove: { ok: can("staff", "remove") && !removed, danger: true, run: async () => { const c = await UI.confirm({ title: "Remove " + row.name + "?", text: "The record is moved to the archive, not deleted. History, Staff ID and audit trail are kept, and the record can be restored.", reason: true, ok: "Remove", danger: true }); if (c) done(SF.run(() => API.staffRemove([row.id], c.reason)), "Removed and archived."); } }
    };
    const list = S.actions.filter((a) => a.visible && impl[a.key] && impl[a.key].ok).map((a) => ({ key: a.key, label: t(a.label), icon: a.icon, inline: a.inline, danger: impl[a.key].danger, run: impl[a.key].run }));
    if (removed && can("staff", "remove")) list.push({ key: "restore", label: "Restore", icon: "undo", inline: true, run: async () => { if (await UI.confirm({ title: "Restore " + row.name + "?", text: "The record returns to the list as inactive and gets a Staff ID in its hub again.", ok: "Restore" })) done(SF.run(() => API.staffRestore(row.id)), "Restored as inactive."); } });
    if (removed && can("staff", "delete") && S.settings.staff.allow_permanent_delete) list.push({ key: "delete", label: "Delete permanently", icon: "trash", danger: true, run: async () => { const c = await UI.confirm({ title: "Delete " + row.name + " permanently?", text: "This cannot be undone. The audit log keeps a record of the deletion.", reason: true, ok: "Delete permanently", danger: true }); if (c) done(SF.run(() => API.staffDelete(row.id, c.reason)), "Deleted permanently."); } });
    return list;
  }
  const actsHtml = (acts, id) => { const inl = acts.filter((a) => a.inline), more = acts.filter((a) => !a.inline); return `<div class="acts">${inl.map((a) => `<button class="iconbtn ${a.danger ? "danger" : ""}" data-act="ra" data-id="${id}" data-k="${a.key}" title="${esc(a.label)}" aria-label="${esc(a.label)}">${icon(a.icon)}</button>`).join("")}${more.length ? `<button class="iconbtn" data-act="more" data-id="${id}" title="More actions" aria-label="More actions">${icon("more")}</button>` : ""}</div>`; };

  function list(root) {
    const S = SF.S; let data = { rows: [], stats: {} }, view = [];
    const lay = () => currentLayout();
    const cols = () => lay().columns.filter((c) => c.visible && (c.key === "select" || c.key === "actions" || fmt.field(c.key)));
    const sel = (list2, val, any, k) => `<div class="field"><label>${esc(k)}</label><select data-on="filter" data-k="${any}"><option value="">All</option>${list2.map((o) => `<option value="${esc(o.v)}" ${String(st.q[any] || "") === String(o.v) ? "selected" : ""}>${esc(o.l)}</option>`).join("")}</select></div>`;
    const years = () => { const y = new Date().getFullYear(), a = []; for (let i = y; i >= y - 6; i--) a.push({ v: i, l: i }); return a; };
    const ranks = Array.from(new Set(S.roles.map((r) => r.rank))).sort((a, b) => a - b).map((r) => ({ v: r, l: "Rank " + r }));
    const nFilters = () => Object.keys(st.q).filter((k) => k !== "search" && k !== "card" && st.q[k]).length;

    root.innerHTML = `<div class="ph"><div><h1>${esc(SF.pageLabel("staff"))}</h1><p id="sub"></p></div><div class="row">
        ${can("import", "create") ? `<a class="btn" href="#/import">${icon("upload")}Import</a>` : ""}
        ${can("staff", "export") || can("staff", "print") ? `<button class="btn" data-act="outmenu">${icon("download")}Export / Print ${icon("down", "sm")}</button>` : ""}
        ${can("staff", "create") ? `<button class="btn primary" data-act="add">${icon("plus")}${esc(t("Add Staff"))}</button>` : ""}</div></div>
      <div class="stats" id="stats"></div>
      <div class="card staff-table">
        <div class="toolbar">
          <div class="tsearch"><span>${icon("search")}</span><input type="search" data-on="search" value="${esc(st.q.search || "")}" placeholder="${esc(t("Search name, ID, phone…"))}" aria-label="Search staff"></div>
          <button class="btn" data-act="togglef" id="fbtn"></button>
          <span class="grow"></span>
          <select class="input" style="width:auto" data-on="layout" aria-label="Table layout" title="Saved table layout">${S.layouts.map((l) => `<option value="${l.id}" ${l.id === lay().id ? "selected" : ""}>${esc(l.name)}${l.shared ? "" : " (mine)"}</option>`).join("")}</select>
          <button class="btn" data-act="columns" title="Choose, rename and reorder columns">${icon("columns")}<span class="hide-sm">Columns</span></button>
        </div>
        <div class="filters ${st.filtersOpen ? "" : "hidden"}" id="filters">
          ${sel(UI.opt(S.hubs), 0, "hub", "Hub")}${sel(UI.opt(S.zones), 0, "zone", "Zone")}${sel(UI.opt(S.positions), 0, "position", "Position")}${sel(UI.opt(S.roles), 0, "role", "Role")}${sel(ranks, 0, "rank", "Rank")}
          ${sel([["active", "Active"], ["inactive", "Inactive"], ["pending", "Pending approval"], ["removed", "Removed (archive)"]].map((x) => ({ v: x[0], l: x[1] })), 0, "status", "Staff status")}
          <div class="field"><label>Joined from</label><input type="date" data-on="filter" data-k="join_from" value="${esc(st.q.join_from || "")}"></div>
          <div class="field"><label>Joined to</label><input type="date" data-on="filter" data-k="join_to" value="${esc(st.q.join_to || "")}"></div>
          ${sel(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((m, i) => ({ v: i + 1, l: m })), 0, "month", "Joining month")}${sel(years(), 0, "year", "Joining year")}
          <div class="field" style="justify-content:flex-end"><button class="btn" data-act="clearf">${icon("x")}Clear filters</button></div>
        </div>
        <div id="bulk"></div><div id="body"></div>
      </div>`;

    function load() { const r = SF.run(() => API.staffList(st.q)); if (r) data = r; }
    function sorted() {
      const rows = data.rows.slice(), k = st.sort.key; if (!k) return rows.sort((a, b) => (fmt.hub(a.hub_id) + String(a.staff_no || 0).padStart(8, "0")).localeCompare(fmt.hub(b.hub_id) + String(b.staff_no || 0).padStart(8, "0")));
      const num = k === "staff_no" || k === "rank", val = (r) => (num ? Number(r[k] == null ? 1e9 : r[k]) : k === "joining_date" ? r[k] || "" : fmt.text(r, k).toLowerCase());
      return rows.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * st.sort.dir; });
    }
    function draw() {
      const C = cols(), ps = S.settings.staff.page_size || 25; view = sorted();
      const pages = Math.max(1, Math.ceil(view.length / ps)); if (st.page > pages) st.page = pages;
      const pageRows = view.slice((st.page - 1) * ps, st.page * ps);
      Array.from(st.sel).forEach((id) => { if (!view.some((r) => r.id === id)) st.sel.delete(id); });
      root.querySelector("#sub").textContent = data.stats.total + " staff in your scope" + (data.stats.removed ? " · " + data.stats.removed + " in the archive" : "");
      root.querySelector("#stats").innerHTML = statCards(data.stats, cardOf(st.q), true);
      root.querySelector("#fbtn").innerHTML = icon("filter") + esc(t("Filters")) + (nFilters() ? ` <span class="badge b-ok">${nFilters()}</span>` : "");
      const n = st.sel.size;
      root.querySelector("#bulk").innerHTML = n ? `<div class="bulkbar"><b>${n} selected</b>
        ${can("staff", "approve") ? `<button class="btn sm" data-act="bulk" data-k="approve">${icon("check", "sm")}Approve</button>` : ""}
        ${can("staff", "edit") ? `<button class="btn sm" data-act="bulk" data-k="activate">${icon("power", "sm")}Activate</button><button class="btn sm" data-act="bulk" data-k="deactivate">${icon("ban", "sm")}Deactivate</button>` : ""}
        ${can("staff", "export") ? `<button class="btn sm" data-act="bulk" data-k="export">${icon("sheet", "sm")}Export selected</button>` : ""}
        ${can("staff", "print") ? `<button class="btn sm" data-act="bulk" data-k="print">${icon("printer", "sm")}Print selected</button>` : ""}
        ${can("staff", "remove") ? `<button class="btn sm danger" data-act="bulk" data-k="remove">${icon("trash", "sm")}Remove</button>` : ""}
        ${n < view.length ? `<button class="btn sm ghost" data-act="selall">Select all ${view.length}</button>` : ""}<button class="btn sm ghost" data-act="selnone">Clear</button></div>` : "";
      if (!view.length) { root.querySelector("#body").innerHTML = UI.state("empty", "No staff match", nFilters() || st.q.search || st.q.card ? "Try clearing the search or filters." : "Add the first staff member or import a list."); return; }
      const allOn = pageRows.every((r) => st.sel.has(r.id));
      const th = C.map((c) => c.key === "select" ? `<th class="c" style="width:36px"><input type="checkbox" data-on="selpage" ${allOn ? "checked" : ""} aria-label="Select all on this page"></th>` : c.key === "actions" ? `<th class="r">${esc(colLabel(c))}</th>` : `<th class="sortable" data-act="sort" data-k="${c.key}">${esc(colLabel(c))}${st.sort.key === c.key ? icon(st.sort.dir > 0 ? "up" : "down", "sm") : ""}</th>`).join("");
      const tr = pageRows.map((r) => { const acts = rowActions(r, redraw); return `<tr class="${st.sel.has(r.id) ? "sel" : ""}">${C.map((c) => c.key === "select" ? `<td class="c"><input type="checkbox" data-on="selrow" data-id="${r.id}" ${st.sel.has(r.id) ? "checked" : ""} aria-label="Select ${esc(r.name)}"></td>` : c.key === "actions" ? `<td>${actsHtml(acts, r.id)}</td>` : c.key === "name" ? `<td><a class="name" href="#/staff/${r.id}" style="text-decoration:none;color:inherit">${esc(r.name)}</a>${r.deleted_at ? ' <span class="badge b-bad">Removed</span>' : ""}</td>` : `<td>${fmt.html(r, c.key)}</td>`).join("")}</tr>`; }).join("");
      const kv = C.filter((c) => !["select", "actions", "name", "photo", "status", "staff_no"].includes(c.key)).slice(0, 6);
      const cards = pageRows.map((r) => `<div class="scard ${st.sel.has(r.id) ? "sel" : ""}"><div class="hd">${UI.avatar(r.name, r.photo)}<div class="grow"><a class="name b" href="#/staff/${r.id}" style="text-decoration:none;color:inherit">${esc(r.name)}</a><div class="small faint">${esc(t("Staff ID"))} ${esc(r.staff_no_text || "—")}</div></div>${fmt.status(r.status)}</div>
        <div class="kv">${kv.map((c) => `<div><span>${esc(colLabel(c))}</span>${fmt.html(r, c.key)}</div>`).join("")}</div>
        <div class="ft"><label class="check small"><input type="checkbox" data-on="selrow" data-id="${r.id}" ${st.sel.has(r.id) ? "checked" : ""}> Select</label>${actsHtml(rowActions(r, redraw), r.id)}</div></div>`).join("");
      root.querySelector("#body").innerHTML = `<div class="tw"><table class="t"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div><div class="scards">${cards}</div>
        <div class="pager"><span>Showing ${(st.page - 1) * ps + 1}–${Math.min(view.length, st.page * ps)} of ${view.length}</span><div class="row"><button class="btn sm" data-act="pg" data-d="-1" ${st.page <= 1 ? "disabled" : ""}>${icon("left", "sm")}Previous</button><span>Page ${st.page} of ${pages}</span><button class="btn sm" data-act="pg" data-d="1" ${st.page >= pages ? "disabled" : ""}>Next${icon("right", "sm")}</button></div></div>`;
    }
    function redraw() { load(); draw(); }
    const rowOf = (id) => data.rows.find((r) => r.id === id);
    const output = (kind, rows, what) => {
      if (!rows.length) return UI.toast("There is nothing to " + kind + ".", "warn"); const tpl = Out.template();
      if (!SF.run(() => API.logOutput(kind === "print" ? "print" : "export", what, rows.length, kind === "csv" ? "CSV" : tpl.name))) return;
      if (kind === "print") Out.staffPrint(tpl, rows, { subtitle: what });
      else if (kind === "csv") { const head = tpl.columns.map((c) => c.header); UI.download(Out.fileName(what, "csv"), SF.CSV.build([head].concat(Out.matrix(tpl, rows)))); UI.toast("CSV downloaded."); }
      else Out.staffXlsx(tpl, rows, { subtitle: what, file: what }).then(() => UI.toast("Excel file downloaded (" + rows.length + " rows)."));
    };
    let timer = null;
    UI.delegate(root, {
      search(i) { clearTimeout(timer); timer = setTimeout(() => { st.q.search = i.value; st.page = 1; redraw(); }, 180); },
      filter(i) { if (i.value) st.q[i.dataset.k] = i.value; else delete st.q[i.dataset.k]; if (i.dataset.k === "status") delete st.q.card; st.page = 1; redraw(); },
      togglef() { st.filtersOpen = !st.filtersOpen; root.querySelector("#filters").classList.toggle("hidden", !st.filtersOpen); },
      clearf() { st.q = st.q.search ? { search: st.q.search } : {}; st.page = 1; list(clear(root)); },
      card(b) { const s = st.q.search; st.q = Object.assign({}, CARD_Q[b.dataset.k]); if (s) st.q.search = s; st.page = 1; list(clear(root)); },
      layout(s) { st.layout = s.value; draw(); },
      columns() { columnsEditor(lay().id, (id) => { SF.refresh(); if (id) st.layout = id; list(clear(root)); }); },
      sort(th) { const k = th.dataset.k; if (st.sort.key === k) st.sort.dir *= -1; else st.sort = { key: k, dir: 1 }; draw(); },
      pg(b) { st.page += Number(b.dataset.d); draw(); root.querySelector(".staff-table").scrollIntoView({ block: "start" }); },
      selrow(i) { if (i.checked) st.sel.add(i.dataset.id); else st.sel.delete(i.dataset.id); draw(); },
      selpage(i) { const ps = S.settings.staff.page_size || 25; view.slice((st.page - 1) * ps, st.page * ps).forEach((r) => (i.checked ? st.sel.add(r.id) : st.sel.delete(r.id))); draw(); },
      selall() { view.forEach((r) => st.sel.add(r.id)); draw(); }, selnone() { st.sel.clear(); draw(); },
      add() { staffForm(null, redraw); },
      ra(b) { const r = rowOf(b.dataset.id), a = r && rowActions(r, redraw).find((x) => x.key === b.dataset.k); if (a) a.run(); },
      more(b) { const r = rowOf(b.dataset.id); if (!r) return; UI.menu(b, rowActions(r, redraw).filter((a) => !a.inline).map((a) => ({ label: a.label, icon: a.icon, danger: a.danger, run: a.run }))); },
      outmenu(b) {
        UI.menu(b, [can("staff", "export") && { label: "Excel — current list (" + view.length + ")", icon: "sheet", run: () => output("xlsx", view, "filtered list") }, can("staff", "export") && { label: "CSV — current list", icon: "file", run: () => output("csv", view, "filtered list") },
          can("staff", "print") && { label: "Print current list", icon: "printer", run: () => output("print", view, "filtered list") }, can("export", "access") && "-", can("export", "access") && { label: "Open Export & Print Center", icon: "sliders", run: () => (location.hash = "#/export") }]);
      },
      async bulk(b) {
        const ids = Array.from(st.sel), k = b.dataset.k, rows = view.filter((r) => st.sel.has(r.id)); let r;
        if (k === "export") return output("xlsx", rows, "selected staff");
        if (k === "print") return output("print", rows, "selected staff");
        if (k === "approve") { if (!(await UI.confirm({ title: "Approve " + ids.length + " staff?", text: "Only people who are waiting for approval are changed; the others are skipped.", ok: "Approve" }))) return; r = SF.run(() => API.staffApprove(ids)); }
        if (k === "activate") { if (!(await UI.confirm({ title: "Activate " + ids.length + " staff?", text: "Only inactive staff are changed; the others are skipped.", ok: "Activate" }))) return; r = SF.run(() => API.staffSetStatus(ids, "active", "")); }
        if (k === "deactivate") { const c = await UI.confirm({ title: "Deactivate " + ids.length + " staff?", text: "Only active staff are changed; the others are skipped.", reason: true, ok: "Deactivate", danger: true }); if (!c) return; r = SF.run(() => API.staffSetStatus(ids, "inactive", c.reason)); }
        if (k === "remove") { const c = await UI.confirm({ title: "Remove " + ids.length + " staff?", text: "The records are archived, not deleted, and can be restored.", reason: true, ok: "Remove", danger: true }); if (!c) return; r = SF.run(() => API.staffRemove(ids, c.reason)); }
        if (!r) return;
        if (r.skipped.length) UI.modal({ title: r.done + " changed, " + r.skipped.length + " skipped", icon: "info", body: `<p>These records were not changed:</p><ul>${r.skipped.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`, actions: [{ label: "Close", cls: "primary" }] }); else UI.toast(r.done + " staff updated.");
        st.sel.clear(); SF.refresh(); redraw();
      }
    });
    redraw();
  }

  /* =============================== DIALOGS =============================== */
  function fieldDef(f, creating) {
    const S = SF.S, base = { key: f.key, label: L(f), required: f.required, span: f.type === "textarea" };
    switch (f.type) {
      case "select": return Object.assign(base, { type: "select", options: f.options.map((o) => ({ v: o, l: o })) });
      case "hub": return Object.assign(base, { type: "select", options: UI.opt(S.hubs.filter((h) => h.status === "active" && (S.me.scope === "all" || S.me.isSuper || (S.me.scope === "zone" ? h.zone_id === S.me.zone_id : h.id === S.me.hub_id)))), hint: creating ? "The Staff ID is issued automatically inside this hub." : "" });
      case "position": return Object.assign(base, { type: "select", options: UI.opt(S.positions.filter((p) => p.status === "active")) });
      case "staff": return Object.assign(base, { type: "select", placeholder: "— None —", options: Object.values(SF.names()).sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ v: s.id, l: s.name + " · " + fmt.hub(s.hub_id) })) });
      case "tel": return Object.assign(base, { type: "tel", placeholder: "01XXXXXXXXX" });
      default: return Object.assign(base, { type: f.type });
    }
  }
  function staffForm(id, onDone) {
    const S = SF.S, creating = !id, row = creating ? { joining_date: SF.DB.today(), hub_id: S.me.scope === "hub" ? S.me.hub_id : "" } : SF.run(() => API.staffGet(id)); if (!row) return;
    const defs = [], grantable = S.roles.filter((r) => r.grantable && r.status === "active");
    const body = S.sections.filter((s) => s.kind === "fields").map((s) => {
      const fs = S.fields.filter((f) => f.section === s.key && (creating ? f.can_set : f.can_edit) && (f.visible || f.required)).map((f) => fieldDef(f, creating)); if (!fs.length) return "";
      fs.forEach((d) => defs.push(d)); return `<div class="sect-t">${icon(s.icon)}${esc(L(s))}</div><div class="grid g2">${fs.map((d) => UI.field(d, row[d.key])).join("")}</div>`;
    }).join("") + (creating && grantable.length ? `<div class="sect-t">${icon("shield")}Roles</div><div class="row" id="roleBox">${grantable.map((r) => `<label class="check"><input type="checkbox" value="${r.id}"> <span class="badge b-${r.color}">${esc(r.name)}</span></label>`).join("")}</div><span class="hint small faint">You can assign roles that rank below your own. More than one role is allowed.</span>` : "");
    const willPend = creating && S.settings.staff.new_requires_approval && !can("staff", "approve");
    UI.modal({ title: creating ? "Add staff member" : "Edit — " + row.name, icon: creating ? "userplus" : "edit", size: "wide", sticky: true,
      body: (willPend ? `<div class="note warn">${icon("clock")}<span>New staff you add wait for approval by an authorised person before they become active.</span></div>` : "") + (defs.length ? body : UI.state("empty", "There are no fields you are allowed to edit.")),
      mount(m) { UI.wirePhotos(m.body); },
      actions: [{ label: "Cancel" }, defs.length && { label: creating ? "Add staff member" : "Save changes", cls: "primary", icon: "save", run(m) {
        const v = UI.readForm(m.body, defs);
        const local = {}; defs.forEach((d) => { if (d.required && (v[d.key] === "" || v[d.key] == null)) local[d.key] = d.label + " is required."; });
        if (!UI.showErrors(m.body, local)) return false;
        const roleIds = creating ? Array.from(m.body.querySelectorAll("#roleBox input:checked")).map((x) => x.value) : null;
        const r = SF.run(() => (creating ? API.staffCreate(v, roleIds) : API.staffUpdate(id, v)), m.body); if (!r) return false;
        UI.toast(creating ? "Added with Staff ID " + r.staff_no + (r.status === "pending" ? " — waiting for approval." : ".") : r.changed.length ? "Saved." : "Nothing was changed.");
        SF.refresh(); if (onDone) onDone();
      } }].filter(Boolean) });
  }

  function transferDialog(row, onDone) {
    const S = SF.S, names = Object.values(SF.names()).sort((a, b) => a.name.localeCompare(b.name));
    const pick = !row, canNow = can("transfers", "approve") && S.me.isSuper;
    const defs = [
      pick && { key: "staff_id", label: "Staff member", type: "select", required: true, span: true, options: (SF.run(() => API.staffList({ status: "active" }).rows) || []).map((s) => ({ v: s.id, l: s.name + " · ID " + s.staff_no_text + " · " + fmt.hub(s.hub_id) })) },
      { key: "to_hub", label: "New hub", type: "select", required: true, options: UI.opt(S.hubs.filter((h) => h.status === "active")).map((o) => ({ v: o.v, l: o.l + " — " + fmt.zone((S.hubs.find((h) => h.id === o.v) || {}).zone_id) })), hint: "The zone follows the hub." },
      { key: "to_position", label: "New position", type: "select", required: true, options: UI.opt(S.positions.filter((p) => p.status === "active" || (row && p.id === row.position_id))) },
      { key: "to_manager", label: "New reporting manager", type: "select", placeholder: "— Keep current —", options: names.filter((n) => !row || n.id !== row.id).map((n) => ({ v: n.id, l: n.name + " · " + fmt.hub(n.hub_id) })) },
      { key: "effective_date", label: "Effective date", type: "date", required: true },
      { key: "reason", label: "Reason", type: "textarea", required: true, span: true, placeholder: "Why is this transfer needed?" },
      canNow && { key: "approve_now", label: "Approval", type: "checkbox", checkLabel: "Approve and apply now (Super Admin)", span: true }
    ].filter(Boolean);
    const summary = (r) => (r ? `<div class="card pad"><div class="row">${UI.avatar(r.name, r.photo)}<div class="grow"><b>${esc(r.name)}</b><div class="small muted">Now: ${esc(fmt.hub(r.hub_id))} · ${esc(fmt.zone(r.zone_id))} · ${esc(fmt.position(r.position_id))} · Staff ID ${esc(r.staff_no_text)}</div></div></div></div>` : "");
    UI.modal({ title: "Transfer staff", icon: "transfer", size: "wide", sticky: true,
      body: `<div id="trSum">${summary(row)}</div>${UI.form(defs, row ? { to_hub: row.hub_id, to_position: row.position_id, effective_date: SF.DB.today() } : { effective_date: SF.DB.today() })}
        <div class="note">${icon("info")}<span>When the hub changes, the destination hub issues a new numeric Staff ID on approval. The old hub, position and Staff ID stay in the history and are never overwritten.</span></div>`,
      mount(m) { if (pick) m.body.querySelector('[name="staff_id"]').addEventListener("change", (e) => { const r = SF.run(() => API.staffGet(e.target.value)); m.body.querySelector("#trSum").innerHTML = summary(r); if (r) { m.body.querySelector('[name="to_hub"]').value = r.hub_id; m.body.querySelector('[name="to_position"]').value = r.position_id; } }); },
      actions: [{ label: "Cancel" }, { label: "Submit transfer", cls: "primary", icon: "send", run(m) {
        const v = UI.readForm(m.body, defs); if (row) v.staff_id = row.id;
        if (!v.staff_id) { UI.showErrors(m.body, { staff_id: "Choose a staff member." }); return false; }
        const r = SF.run(() => API.transferCreate(v), m.body); if (!r) return false;
        UI.toast(r.status === "approved" ? "Transfer approved and applied." : "Transfer submitted — waiting for approval."); SF.refresh(); if (onDone) onDone();
      } }] });
  }

  function rolesDialog(row, onDone) {
    const S = SF.S, mine = new Set(row.roles || []);
    UI.modal({ title: "Roles — " + row.name, icon: "shield", sticky: true,
      body: `<p class="muted">A person can hold several roles. Their permissions add up; their rank is the highest-ranking role.</p><div class="ordlist">${S.roles.filter((r) => r.status === "active" || mine.has(r.id)).sort((a, b) => a.rank - b.rank).map((r) => `<label class="ord ${r.grantable ? "" : "off"}"><input type="checkbox" value="${r.id}" ${mine.has(r.id) ? "checked" : ""} ${r.grantable ? "" : "disabled"} style="width:16px;height:16px;accent-color:var(--green-700)"><span class="grow"><span class="badge b-${r.color}">${esc(r.name)}</span> <span class="small faint">Rank ${r.rank} · scope: ${esc(r.scope)}</span></span>${r.grantable ? "" : `<span class="small faint">${icon("lock", "sm")} ranks at or above you</span>`}</label>`).join("")}</div>`,
      actions: [{ label: "Cancel" }, { label: "Save roles", cls: "primary", run(m) { const ids = Array.from(m.body.querySelectorAll("input:checked")).map((x) => x.value); if (!SF.run(() => API.staffSetRoles(row.id, ids))) return false; UI.toast("Roles saved."); SF.refresh(); if (onDone) onDone(); } }] });
  }

  function activityDrawer(row) {
    const list2 = SF.run(() => API.staffActivity(row.id)); if (!list2) return;
    UI.modal({ title: "Activity — " + row.name, icon: "activity", drawer: true, footer: false,
      body: list2.length ? `<div class="timeline">${list2.map((a) => `<div class="tl"><i></i><div><span class="badge b-grey">${esc(a.action)}</span> ${esc(a.summary)}<div class="small faint">${esc(fmt.dt(a.at))} · ${esc(a.user_name)}</div>${a.after && a.action === "UPDATE" ? `<div class="small muted">${Object.keys(a.after).map((k) => `${esc((fmt.field(k) || {}).label || k)}: ${esc(String(a.after[k][0]).slice(0, 40) || "—")} → ${esc(String(a.after[k][1]).slice(0, 40) || "—")}`).join("<br>")}</div>` : ""}</div></div>`).join("")}</div>` : UI.state("empty", "No recorded activity yet") });
  }

  /** column editor for one saved layout: add, remove, rename, reorder, show / hide */
  function columnsEditor(layoutId, onSaved) {
    const S = SF.S, src = S.layouts.find((l) => l.id === layoutId), canShared = can("table", "edit"), own = src && !src.shared && src.owner === S.me.user_id;
    let cols = (src ? src.columns : []).map((c) => Object.assign({}, c)), saveAsNew = !src || (src.shared && !canShared);
    const baseLabel = (k) => (k === "select" ? "Mark / checkbox" : k === "actions" ? "Action buttons" : L(fmt.field(k) || { label: k }));
    const m = UI.modal({ title: "Table columns", icon: "columns", size: "wide", sticky: true, body: '<div id="ce"></div>',
      actions: [{ label: "Cancel" }, { label: "Save layout", cls: "primary", icon: "save", run(mm) {
        mm.body.querySelectorAll("[data-lbl]").forEach((i) => { const c = cols.find((x) => x.key === i.dataset.lbl); if (c) c.label = i.value.trim(); });
        const name = mm.body.querySelector("#ceName").value.trim(), asNew = mm.body.querySelector("#ceNew") ? mm.body.querySelector("#ceNew").checked : saveAsNew, shared = mm.body.querySelector("#ceShared") ? mm.body.querySelector("#ceShared").checked : false;
        const id = SF.run(() => API.layoutSave(asNew ? { name, shared: shared && canShared, columns: cols } : { id: src.id, name, columns: cols })); if (!id) return false;
        UI.toast("Layout saved."); onSaved(id);
      } }] });
    function paint() {
      const avail = S.fields.filter((f) => !cols.some((c) => c.key === f.key)).concat(["select", "actions"].filter((k) => !cols.some((c) => c.key === k)).map((k) => ({ key: k, label: baseLabel(k) })));
      m.body.querySelector("#ce").innerHTML = `<div class="grid g2"><div class="field"><label>Layout name</label><input id="ceName" value="${esc(saveAsNew && src ? src.name + " (my copy)" : src ? src.name : "My layout")}"></div>
        <div class="field"><label>Save as</label><div class="row" style="min-height:36px">${src && (canShared || own) ? `<label class="check"><input type="checkbox" id="ceNew" ${saveAsNew ? "checked" : ""}> a new layout</label>` : `<span class="small muted">${icon("info", "sm")} Saved as your personal layout${src && src.shared ? " (shared layouts are managed by administrators)" : ""}.</span>`}${canShared ? `<label class="check"><input type="checkbox" id="ceShared"> share new layout with everyone</label>` : ""}</div></div></div>
        <div class="ordlist">${cols.map((c, i) => `<div class="ord ${c.visible ? "" : "off"}"><button class="iconbtn plain" data-act="up" data-i="${i}" ${i ? "" : "disabled"} aria-label="Move up">${icon("up", "sm")}</button><button class="iconbtn plain" data-act="dn" data-i="${i}" ${i < cols.length - 1 ? "" : "disabled"} aria-label="Move down">${icon("down", "sm")}</button>
          <span class="grow"><input data-lbl="${esc(c.key)}" value="${esc(c.label || "")}" placeholder="${esc(baseLabel(c.key))}" aria-label="Column heading"></span><span class="small faint hide-sm">${esc(baseLabel(c.key))}</span>
          ${UI.sw(`data-on="vis" data-i="${i}" aria-label="Show column"`, c.visible)}<button class="iconbtn plain danger" data-act="del" data-i="${i}" title="Remove column from this layout" aria-label="Remove column">${icon("trash", "sm")}</button></div>`).join("")}</div>
        <div class="row"><select class="input" id="ceAdd" style="max-width:280px"><option value="">+ Add a column…</option>${avail.map((f) => `<option value="${esc(f.key)}">${esc(f.label)}</option>`).join("")}</select>
        ${can("fields", "create") ? `<a class="btn sm ghost" href="#/fields" data-act="gofields">${icon("plus", "sm")}Create a custom field</a>` : ""}</div>
        <p class="small faint">Type in a row to rename the column heading. Required fields, and which roles may see or edit a field, are set in the Profile Builder.</p>`;
    }
    const keep = () => m.body.querySelectorAll("[data-lbl]").forEach((i) => { const c = cols.find((x) => x.key === i.dataset.lbl); if (c) c.label = i.value; });
    UI.delegate(m.body, {
      up(b) { keep(); const i = +b.dataset.i; [cols[i - 1], cols[i]] = [cols[i], cols[i - 1]]; paint(); }, dn(b) { keep(); const i = +b.dataset.i; [cols[i + 1], cols[i]] = [cols[i], cols[i + 1]]; paint(); },
      del(b) { keep(); cols.splice(+b.dataset.i, 1); paint(); }, vis(i) { keep(); cols[+i.dataset.i].visible = i.checked; paint(); }, gofields() { m.close(); location.hash = "#/fields"; }
    });
    m.body.addEventListener("change", (e) => { if (e.target.id === "ceAdd" && e.target.value) { keep(); cols.push({ key: e.target.value, label: "", visible: true }); paint(); } if (e.target.id === "ceNew") saveAsNew = e.target.checked; });
    paint();
  }

  /* =============================== PROFILE =============================== */
  function profile(root, id) {
    const S = SF.S, row = SF.run(() => API.staffGet(id));
    if (!row) { root.innerHTML = UI.state("error", "Staff member not found", "The record does not exist or is outside your hub / zone.") + `<div style="text-align:center"><a class="btn" href="#/staff">${esc(t("Back to list"))}</a></div>`; return; }
    const again = () => profile(clear(root), id), acts = rowActions(row, again).filter((a) => a.key !== "view");
    const roleObjs = (row.roles || []).map(fmt.role).filter(Boolean), hidden = new Set(row._hidden || []);
    const kv = (f) => `<div><span>${esc(L(f))}</span>${hidden.has(f.key) ? `<b class="faint">${icon("lock", "sm")} ${esc(t("Restricted"))}</b>` : `<b>${f.type === "staff" ? esc(row.manager_name || fmt.name(row[f.key])) || `<span class="faint">${esc(t("Not provided"))}</span>` : f.type === "rank" ? (row.rank == null ? "—" : t("Rank") + " " + row.rank) : (fmt.text(row, f.key) ? fmt.html(row, f.key) : `<span class="faint">${esc(t("Not provided"))}</span>`)}</b>`}</div>`;
    const sectionBody = {
      fields(s) { const fs = S.fields.filter((f) => f.section === s.key && f.visible && f.type !== "photo"), hid = (row._hidden || []).length && s.key === "personal" ? "" : ""; return fs.length ? `<div class="card-b"><div class="kvs">${fs.map(kv).join("")}</div>${hid}</div>` : `<div class="card-b muted small">No fields in this section.</div>`; },
      roles() { return `<div class="card-b stack">${hidden.has("roles") ? `<span class="faint">${icon("lock", "sm")} ${esc(t("Restricted"))}</span>` : roleObjs.length ? `<div class="tw"><table class="t"><thead><tr><th>Role</th><th>${esc(t("Rank"))}</th><th>${esc(t("Scope"))}</th></tr></thead><tbody>${roleObjs.sort((a, b) => a.rank - b.rank).map((r, i) => `<tr><td><span class="badge b-${r.color}">${esc(r.name)}</span>${i === 0 && roleObjs.length > 1 ? ' <span class="small faint">highest rank</span>' : ""}</td><td class="num">${r.rank}</td><td>${esc({ all: "All hubs and zones", zone: "Own zone", hub: "Own hub", self: "Own record only" }[r.scope])}</td></tr>`).join("")}</tbody></table></div>` : `<span class="muted">${esc(t("No roles assigned"))}</span>`}
        ${can("staff", "edit") && !row.deleted_at ? `<div><button class="btn sm" data-act="roles">${icon("shield", "sm")}Manage roles</button></div>` : ""}</div>`; },
      portal() { const a = row.account; return `<div class="card-b stack">${a === undefined ? `<span class="faint">${icon("lock", "sm")} ${esc(t("Restricted"))}</span>` : a ? `<div class="kvs"><div><span>${esc(t("Username"))}</span><b>${esc(a.username)}</b></div><div><span>${esc(t("Portals"))}</span><b class="chips">${a.portals.map((p) => `<span class="badge b-info">${esc((SF.PORTALS.find((x) => x.key === p) || {}).label || p)}</span>`).join("") || "—"}</b></div><div><span>${esc(t("Login account"))}</span><b>${a.status === "active" ? '<span class="badge b-ok">Enabled</span>' : '<span class="badge b-grey">Disabled</span>'}</b></div><div><span>${esc(t("Last sign-in"))}</span><b>${esc(fmt.dt(a.last_login)) || "—"}</b></div></div>` : `<span class="muted">${esc(t("No login account"))}</span>`}
        ${can("users", "edit") || (can("users", "create") && !a) ? `<div><a class="btn sm" href="#/users">${icon("key", "sm")}Manage login and portal access</a></div>` : ""}</div>`; },
      documents() { return `<div class="card-b stack">${row.documents.length ? `<div class="tw"><table class="t"><tbody>${row.documents.map((x) => `<tr><td>${icon("file")} <b>${esc(x.name)}</b><span class="sub">${esc(x.kind)} · ${Math.max(1, Math.round(x.size / 1024))} KB · ${esc(fmt.dt(x.uploaded_at))}</span></td><td><div class="acts">${x.has_file ? `<button class="iconbtn" data-act="docget" data-id="${x.id}" title="Download">${icon("download")}</button>` : ""}${can("staff", "edit") && !row.deleted_at ? `<button class="iconbtn danger" data-act="docdel" data-id="${x.id}" title="Remove document">${icon("trash")}</button>` : ""}</div></td></tr>`).join("")}</tbody></table></div>` : `<span class="muted">${esc(t("No documents yet."))}</span>`}
        ${can("staff", "edit") && !row.deleted_at ? `<div class="row"><select class="input" id="docKind" style="width:auto"><option>NID copy</option><option>Photo</option><option>CV</option><option>Certificate</option><option>Driving licence</option><option>Other</option></select><label class="btn sm">${icon("upload", "sm")}Add document<input type="file" id="docFile" accept=".pdf,.png,.jpg,.jpeg" hidden></label><span class="small faint">PDF, PNG or JPG — under 400 KB in this demo</span></div>` : ""}</div>`; },
      activity() { return `<div class="card-b stack"><div><h4 class="muted">${esc(t("Assignment history"))}</h4><div class="tw"><table class="t"><thead><tr><th>From</th><th>To</th><th>Hub</th><th>Position</th><th>${esc(t("Staff ID"))}</th><th>Change</th></tr></thead><tbody>${row.assignments.map((a) => `<tr><td>${esc(fmt.date(a.from))}</td><td>${a.to ? esc(fmt.date(a.to)) : `<span class="badge b-ok">${esc(t("current"))}</span>`}</td><td>${esc(fmt.hub(a.hub_id))}</td><td>${esc(fmt.position(a.position_id))}</td><td class="num">${esc(a.staff_no == null ? "" : a.staff_no)}</td><td>${esc(a.change)}</td></tr>`).join("")}</tbody></table></div></div>
        <div><h4 class="muted">${esc(t("Staff ID history"))}</h4><div class="chips">${row.id_history.map((x) => `<span class="badge ${x.released_at ? "b-grey" : "b-ok"}">${esc(fmt.hub(x.hub_id))} · ID ${x.number} · ${esc(fmt.date(x.assigned_at))}${x.released_at ? " → " + esc(fmt.date(x.released_at)) : " · " + esc(t("current"))}</span>`).join("")}</div></div>
        ${can("staff_activity", "view") ? `<div><button class="btn sm" data-act="activity">${icon("activity", "sm")}${esc(t("View Activity"))}</button></div>` : ""}</div>`; }
    };
    root.innerHTML = `<div class="row between"><a class="btn ghost" href="#/staff" ${S.me.scope === "self" ? "hidden" : ""}>${icon("left")}${esc(t("Back to list"))}</a><span></span>
        <div class="row">${acts.filter((a) => a.inline || ["print", "export"].includes(a.key)).map((a) => `<button class="btn ${a.key === "edit" ? "primary" : ""}" data-act="pa" data-k="${a.key}">${icon(a.icon)}<span class="${a.key === "edit" ? "" : "hide-sm"}">${esc(a.label)}</span></button>`).join("")}${acts.some((a) => !a.inline && !["print", "export"].includes(a.key)) ? `<button class="btn" data-act="pmore" aria-label="More actions">${icon("more")}</button>` : ""}</div></div>
      ${row.deleted_at ? `<div class="note bad">${icon("alert")}<span>This record was removed on ${esc(fmt.dt(row.deleted_at))} and is kept in the archive. Reason: ${esc(row.deleted_reason || "—")}</span></div>` : ""}
      ${row.status === "pending" ? `<div class="note warn">${icon("clock")}<span>Waiting for approval by an authorised person.</span></div>` : ""}
      <div class="card pad"><div class="row" style="align-items:flex-start;gap:16px">${UI.avatar(row.name, row.photo, "lg")}<div class="grow stack" style="gap:6px"><div class="row"><h1>${esc(row.name)}</h1>${fmt.status(row.status)}</div>
        <div class="muted">${icon("idcard", "sm")} ${esc(t("Staff ID"))} <b class="num">${esc(row.staff_no_text || "—")}</b> · ${icon("building", "sm")} ${esc(fmt.hub(row.hub_id))} · ${icon("map", "sm")} ${esc(fmt.zone(row.zone_id))} · ${icon("briefcase", "sm")} ${esc(fmt.position(row.position_id))}</div>
        <div class="chips">${roleObjs.sort((a, b) => a.rank - b.rank).map((r) => `<span class="badge b-${r.color}">${esc(r.name)} · ${esc(t("Rank"))} ${r.rank}</span>`).join("") || `<span class="small faint">${esc(t("No roles assigned"))}</span>`}</div></div></div></div>
      <div class="stack">${S.sections.filter((s) => s.visible).map((s) => `<section class="card"><div class="card-h"><h3>${icon(s.icon)} ${esc(L(s))}</h3></div>${(sectionBody[s.kind] || sectionBody.fields)(s)}</section>`).join("")}</div>`;
    UI.delegate(root, {
      pa(b) { const a = acts.find((x) => x.key === b.dataset.k); if (a) a.run(); },
      pmore(b) { UI.menu(b, acts.filter((a) => !a.inline && !["print", "export"].includes(a.key)).map((a) => ({ label: a.label, icon: a.icon, danger: a.danger, run: a.run }))); },
      roles() { rolesDialog(row, again); }, activity() { activityDrawer(row); },
      docget(b) { const x = SF.run(() => API.documentGet(b.dataset.id)); if (x && x.data) fetch(x.data).then((r) => r.blob()).then((bl) => UI.download(x.name, bl)); },
      async docdel(b) { if (await UI.confirm({ title: "Remove this document?", text: "The file is removed from the profile. The audit log keeps a note.", ok: "Remove", danger: true })) if (SF.run(() => API.documentRemove(b.dataset.id))) { UI.toast("Document removed."); again(); } }
    });
    const df = root.querySelector("#docFile");
    if (df) df.addEventListener("change", () => { const f = df.files[0]; if (!f) return; if (f.size > 400000) return UI.toast("This demo keeps files in the browser, so each document must be under 400 KB.", "err"); const rd = new FileReader(); rd.onload = () => { if (SF.run(() => API.documentAdd(id, { name: f.name, kind: root.querySelector("#docKind").value, size: f.size, data: rd.result }))) { UI.toast("Document added."); again(); } }; rd.readAsDataURL(f); });
  }

  SF.Pages.staff = (root, arg) => (arg ? profile(root, arg) : list(root));
  SF.Pages.staff_activity = (root) => { root.innerHTML = UI.state("empty", "Open a staff profile and choose “View Activity”."); };
  SF.Staff = { transferDialog, staffForm, columnsEditor, activityDrawer, clear, statCards };
})();
