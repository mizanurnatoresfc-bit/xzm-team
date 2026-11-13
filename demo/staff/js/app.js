/* App shell: state, language, formatters, router, sidebar, top bar, output (Excel / print) helpers. */
(function () {
  "use strict";
  const SF = window.SF, { UI, API, PORTALS, CATALOG: CAT } = SF, { icon, esc } = UI;

  /* ---------------- language (assigned by policy, not chosen by the user) ---------------- */
  const BN = {
    "Staff Directory": "স্টাফ তালিকা", "Add Staff": "স্টাফ যোগ করুন", "Search name, ID, phone…": "নাম, আইডি, মোবাইল খুঁজুন…", "Search staff or pages…": "স্টাফ বা পেজ খুঁজুন…", "Filters": "ফিল্টার",
    "Active": "সক্রিয়", "Inactive": "নিষ্ক্রিয়", "Pending approval": "অনুমোদনের অপেক্ষায়", "Removed": "বাদ দেওয়া", "My Profile": "আমার প্রোফাইল", "Sign out": "সাইন আউট", "Change password": "পাসওয়ার্ড পরিবর্তন",
    "Edit": "সম্পাদনা", "Print": "প্রিন্ট", "Transfer": "বদলি", "Restricted": "দেখার অনুমতি নেই", "Rank": "র‍্যাঙ্ক", "Not provided": "দেওয়া হয়নি", "No roles assigned": "কোনো রোল দেওয়া হয়নি",
    "Language is set by company policy": "ভাষা কোম্পানির নীতি অনুযায়ী নির্ধারিত", "Staff ID": "স্টাফ আইডি", "Back to list": "তালিকায় ফিরুন", "Export Staff Sheet": "স্টাফ শিট এক্সপোর্ট", "View Activity": "কার্যক্রম দেখুন",
    "Login account": "লগইন অ্যাকাউন্ট", "No login account": "লগইন অ্যাকাউন্ট নেই", "Username": "ইউজারনেম", "Portals": "পোর্টাল", "Last sign-in": "সর্বশেষ লগইন", "No documents yet.": "এখনো কোনো ডকুমেন্ট নেই।",
    "Assignment history": "দায়িত্বের ইতিহাস", "Staff ID history": "স্টাফ আইডির ইতিহাস", "current": "বর্তমান", "Collapse menu": "মেনু ছোট করুন", "You do not have access to this page.": "এই পেজ দেখার অনুমতি আপনার নেই।",
    "Demo — fictional data stored only in this browser.": "ডেমো — কাল্পনিক তথ্য, শুধু এই ব্রাউজারে সংরক্ষিত।", "Yes": "হ্যাঁ", "No": "না", "Scope": "পরিধি", "Joining": "যোগদান", "Transfer history": "বদলির ইতিহাস"
  };
  const t = (s) => (SF.S && SF.S.me.lang === "bn" && BN[s]) || s;
  const L = (o) => (SF.S && SF.S.me.lang === "bn" && o.label_bn) || o.label;

  /* ---------------- formatters ---------------- */
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const byId = (list, id) => (SF.S[list] || []).find((x) => x.id === id);
  const fmt = {
    date(s, f) {
      if (!s) return ""; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (!m) return s;
      switch (f) { case "DD/MM/YYYY": return m[3] + "/" + m[2] + "/" + m[1]; case "MM/DD/YYYY": return m[2] + "/" + m[3] + "/" + m[1]; case "YYYY-MM-DD": return m[1] + "-" + m[2] + "-" + m[3]; case "DD-MMM-YYYY": return m[3] + "-" + MON[m[2] - 1] + "-" + m[1]; default: return m[3] + " " + MON[m[2] - 1] + " " + m[1]; }
    },
    dt(iso) { if (!iso) return ""; const d = new Date(iso); return String(d.getDate()).padStart(2, "0") + " " + MON[d.getMonth()] + " " + d.getFullYear() + ", " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); },
    hub: (id) => (byId("hubs", id) || {}).name || "", zone: (id) => (byId("zones", id) || {}).name || "", position: (id) => (byId("positions", id) || {}).name || "",
    role: (id) => byId("roles", id),
    statusLabel: (s) => ({ active: t("Active"), inactive: t("Inactive"), pending: t("Pending approval"), removed: t("Removed") }[s] || s),
    status: (s) => `<span class="badge ${{ active: "b-ok", inactive: "b-grey", pending: "b-warn", removed: "b-bad" }[s] || "b-grey"}">${esc(fmt.statusLabel(s))}</span>`,
    roles: (ids) => (ids || []).map((id) => { const r = fmt.role(id); return r ? `<span class="badge b-${r.color}">${esc(r.name)}</span>` : ""; }).join(" "),
    name: (id) => (SF.names()[id] || {}).name || "",
    field: (key) => SF.S.fields.find((f) => f.key === key),
    /** plain text of one field of a staff row (for search, export, print) */
    text(row, key, dateFmt) {
      const f = fmt.field(key); if (!f) return ""; const v = row[key];
      if (row._hidden && row._hidden.includes(key)) return "";
      switch (f.type) {
        case "staffno": return row.staff_no_text || ""; case "hub": return fmt.hub(v); case "zone": return fmt.zone(v); case "position": return fmt.position(v); case "staff": return fmt.name(v);
        case "date": return fmt.date(v, dateFmt); case "roles": return (row.roles || []).map((id) => (fmt.role(id) || {}).name).filter(Boolean).join(", "); case "rank": return row.rank == null ? "" : String(row.rank);
        case "status": return fmt.statusLabel(v); case "photo": return v ? "Yes" : ""; case "checkbox": return v ? "Yes" : "No"; default: return v == null ? "" : String(v);
      }
    },
    html(row, key) {
      const f = fmt.field(key); if (!f) return "";
      if (f.type === "roles") return `<div class="chips">${fmt.roles(row.roles) || '<span class="faint">—</span>'}</div>`;
      if (f.type === "status") return fmt.status(row.status);
      if (f.type === "photo") return UI.avatar(row.name, row.photo);
      if (f.type === "rank") return row.rank == null ? '<span class="faint">—</span>' : `<span class="num">${esc(row.rank)}</span>`;
      if (f.type === "staffno") return `<span class="num b">${esc(row.staff_no_text)}</span>`;
      const s = fmt.text(row, key); return s ? esc(s) : '<span class="faint">—</span>';
    }
  };
  let nameCache = null;
  SF.names = () => { if (!nameCache) { nameCache = {}; try { API.staffNames().forEach((s) => (nameCache[s.id] = s)); } catch (e) { /* no access */ } } return nameCache; };

  /* ---------------- state ---------------- */
  SF.can = (page, action) => SF.S.perms.includes(page + ":" + (action || "access"));
  SF.refresh = () => { SF.S = API.boot(); nameCache = null; document.documentElement.lang = SF.S.me.lang; };
  SF.reload = () => { SF.refresh(); renderShell(); route(); };
  function kick(msg) { const p = sessionStorage.getItem("sfhub_portal") || "staff"; sessionStorage.setItem("sfhub_flash", msg || ""); sessionStorage.removeItem("sfhub_session"); location.href = PORTALS.find((x) => x.key === p).file; }
  /** run an action; shows API errors; returns undefined on failure */
  SF.run = function (fn, formRoot) {
    try { return fn(); }
    catch (e) {
      if (e && e.code === 401) return kick(e.message);
      if (e && e.fields && formRoot) { UI.showErrors(formRoot, e.fields); UI.toast(e.message, "err"); return undefined; }
      UI.toast((e && e.message) || "Something went wrong.", "err"); if (!(e instanceof API.ApiError)) console.error(e); return undefined;
    }
  };
  SF.runAsync = async function (fn, formRoot) { try { return await fn(); } catch (e) { return SF.run(() => { throw e; }, formRoot); } };

  /* ---------------- shell ---------------- */
  SF.Pages = {};
  const pageLabel = (key) => { const n = SF.S.nav.find((x) => x.page === key); return n ? L(n) : (CAT.pages[key] || {}).label || key; };
  function navItems() {
    const S = SF.S, me = S.me, vis = (n) => n.visible && (me.isSuper || !n.roles.length || n.roles.some((r) => me.roles.includes(r))) && (n.type !== "page" || SF.can(n.page, "access"));
    const out = [];
    S.nav.filter((n) => n.type === "group" && vis(n)).forEach((g) => {
      const kids = S.nav.filter((n) => n.parent === g.id && n.type !== "group" && vis(n)); if (!kids.length) return;
      out.push({ g }); kids.forEach((k) => { out.push({ n: k }); S.nav.filter((s) => s.parent === k.id && vis(s)).forEach((s) => out.push({ n: s, sub: true })); });
    });
    return out;
  }
  function renderShell() {
    const S = SF.S, me = S.me, portal = PORTALS.find((p) => p.key === me.portal), cur = (location.hash.replace(/^#\/?/, "").split("/")[0]) || "";
    let pend = 0; if (SF.can("transfers", "view")) { try { pend = API.transferList({ status: "pending" }).length; } catch (e) { pend = 0; } }
    const nav = navItems().map((x) => {
      if (x.g) return `<div class="grp">${esc(L(x.g))}</div>`;
      const n = x.n, label = n.page === "staff" && me.scope === "self" ? t("My Profile") : L(n), href = n.type === "link" ? esc(n.url) : "#/" + n.page;
      return `<a href="${href}" ${n.type === "link" ? 'target="_blank" rel="noopener"' : ""} class="${x.sub ? "sub " : ""}${n.type === "page" && n.page === cur ? "on" : ""}" title="${esc(label)}" data-nav>${x.sub ? "" : icon(n.icon || "file")}<span>${esc(label)}</span>${n.page === "transfers" && pend ? `<b class="cnt">${pend}</b>` : ""}</a>`;
    }).join("");
    const collapsed = localStorage.getItem("sfhub_collapsed") === "1";
    document.getElementById("app").innerHTML = `
      <div class="shell ${collapsed ? "collapsed" : ""}" id="shell">
        <aside class="side" aria-label="Main menu">
          <div class="brand"><span class="mark">${esc(S.settings.company.short || "SF")}</span><div><b>${esc(S.settings.company.product || "Hubwise ERP")}</b><span>${esc(portal.label)}</span></div></div>
          <nav class="nav">${nav || '<div class="grp">No pages assigned</div>'}</nav>
          <div class="side-foot"><button data-act="collapse" title="${esc(t("Collapse menu"))}">${icon("sidebar")}<span>${esc(t("Collapse menu"))}</span></button></div>
        </aside>
        <div class="scrim" data-act="closenav"></div>
        <div class="main">
          <div class="demo-strip">${icon("info", "sm")}<span>${esc(t("Demo — fictional data stored only in this browser."))}</span></div>
          <header class="top">
            <button class="iconbtn" data-act="menu" aria-label="Menu">${icon("menu")}</button>
            <div class="crumb" id="crumb"></div>
            <div class="gsearch"><span>${icon("search")}</span><input id="gsearch" type="search" placeholder="${esc(t("Search staff or pages…"))}" autocomplete="off" aria-label="Global search"><div class="gresults hidden" id="gresults"></div></div>
            <span class="badge b-grey hide-sm" title="${esc(t("Language is set by company policy"))}">${icon("language", "sm")} ${me.lang === "bn" ? "বাংলা" : "English"}</span>
            <button class="userbtn" data-act="usermenu" aria-label="Account menu">${UI.avatar(me.name, me.photo)}<div><b>${esc(me.name)}</b><small>${esc(me.roles.map((r) => (fmt.role(r) || {}).name).join(" · ") || "—")}</small></div></button>
          </header>
          <main id="view"></main>
        </div>
      </div>`;
  }
  function wireShell() {
    const app = document.getElementById("app");
    UI.delegate(app, {
      collapse() { const sh = document.getElementById("shell"); sh.classList.toggle("collapsed"); localStorage.setItem("sfhub_collapsed", sh.classList.contains("collapsed") ? "1" : "0"); },
      menu() { const sh = document.getElementById("shell"); if (window.innerWidth <= 1023) sh.classList.toggle("navopen"); else { sh.classList.toggle("collapsed"); localStorage.setItem("sfhub_collapsed", sh.classList.contains("collapsed") ? "1" : "0"); } },
      closenav() { document.getElementById("shell").classList.remove("navopen"); },
      usermenu(b) {
        const me = SF.S.me;
        UI.menu(b, [{ head: me.username + " · " + PORTALS.find((p) => p.key === me.portal).label }, SF.can("staff", "view") && { label: t("My Profile"), icon: "user", run: () => (location.hash = "#/staff/" + me.staff_id) },
          { label: t("Change password"), icon: "key", run: changePassword }, "-", { label: t("Sign out"), icon: "logout", danger: true, run: () => { API.logout(); kick("You have signed out."); } }]);
      }
    });
    app.addEventListener("click", (e) => { if (e.target.closest("[data-nav]")) document.getElementById("shell").classList.remove("navopen"); });
    /* global search: staff (within the caller's scope) and pages */
    let timer = null;
    app.addEventListener("input", (e) => {
      if (e.target.id !== "gsearch") return; clearTimeout(timer);
      timer = setTimeout(() => {
        const q = e.target.value.trim(), box = document.getElementById("gresults"); if (q.length < 2) return box.classList.add("hidden");
        const pages = navItems().filter((x) => x.n && x.n.type === "page" && L(x.n).toLowerCase().includes(q.toLowerCase())).slice(0, 4);
        let staff = []; if (SF.can("staff", "view")) staff = SF.run(() => API.staffList({ search: q }).rows.slice(0, 7)) || [];
        box.innerHTML = (staff.map((s) => `<a href="#/staff/${s.id}">${UI.avatar(s.name, s.photo)}<div><b>${esc(s.name)}</b><div class="small muted">${esc([s.staff_no_text && "ID " + s.staff_no_text, fmt.hub(s.hub_id), fmt.position(s.position_id)].filter(Boolean).join(" · "))}</div></div></a>`).join("") +
          pages.map((x) => `<a href="#/${x.n.page}">${icon(x.n.icon || "file")}<b>${esc(L(x.n))}</b></a>`).join("")) || '<div class="none">No matches</div>';
        box.classList.remove("hidden");
      }, 160);
    });
    document.addEventListener("click", (e) => { const box = document.getElementById("gresults"); if (box && !e.target.closest(".gsearch")) box.classList.add("hidden"); if (box && e.target.closest(".gresults a")) { box.classList.add("hidden"); document.getElementById("gsearch").value = ""; } });
  }
  function changePassword() {
    const defs = [{ key: "old", label: "Current password", type: "password", required: true }, { key: "password", label: "New password", type: "password", required: true, hint: "At least 8 characters, with a letter and a number." }, { key: "again", label: "Repeat new password", type: "password", required: true }];
    UI.modal({ title: "Change password", icon: "key", size: "narrow", body: UI.form(defs, {}, "g1"), actions: [{ label: "Cancel" }, { label: "Change password", cls: "primary", async run(m) {
      const v = UI.readForm(m.body, defs); if (v.password !== v.again) { UI.showErrors(m.body, { again: "The two passwords are not the same." }); return false; }
      const ok = await SF.runAsync(() => API.changePassword(v.old, v.password), m.body); if (!ok) return false; UI.toast("Password changed.");
    } }] });
  }

  /* ---------------- router ---------------- */
  function home() {
    const me = SF.S.me; if (me.scope === "self" && SF.can("staff", "view")) return "staff/" + me.staff_id;
    const first = navItems().find((x) => x.n && x.n.type === "page"); return first ? first.n.page : "";
  }
  function route() {
    UI.closeMenu();
    let h = location.hash.replace(/^#\/?/, ""); if (!h) { const d = home(); if (d) { location.replace("#/" + d); return; } }
    const key = h.split("/")[0], arg = h.split("/").slice(1).join("/"), view = document.getElementById("view");
    try { API.ping(); } catch (e) { return kick(e.message); }
    document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#/" + key));
    const page = document.createElement("div"); page.className = "page"; view.innerHTML = ""; view.appendChild(page);
    const portal = PORTALS.find((p) => p.key === SF.S.me.portal).label;
    document.getElementById("crumb").innerHTML = `${esc(CAT.pages[key] ? pageLabel(key) : "Home")}<small>${esc(portal)}</small>`;
    document.title = (CAT.pages[key] ? pageLabel(key) + " — " : "") + (SF.S.settings.company.product || "Hubwise ERP");
    if (!h) { page.innerHTML = UI.state("empty", "No pages are assigned to your account.", "Ask a Super Admin to give your role access to a page."); return; }
    if (!SF.Pages[key] || !CAT.pages[key]) { page.innerHTML = UI.state("error", "Page not found", "The address does not match any page."); return; }
    if (!SF.can(key, "access")) { page.innerHTML = UI.state("error", t("You do not have access to this page."), "Your role or login portal does not include “" + pageLabel(key) + "”."); return; }
    if (SF.S.me.scope === "self" && key === "staff" && !arg) { location.replace("#/staff/" + SF.S.me.staff_id); return; }
    try { SF.Pages[key](page, arg); }
    catch (e) { if (e && e.code === 401) return kick(e.message); console.error(e); page.innerHTML = UI.state("error", "This page could not be shown", (e && e.message) || ""); }
    window.scrollTo(0, 0);
  }
  SF.route = route;

  /* ---------------- output: Excel, CSV, print ---------------- */
  const Out = {
    template(id) { const T = SF.S.templates; return T.find((x) => x.id === id) || T.find((x) => x.id === SF.S.settings.exporter.default_template) || T[0]; },
    matrix(tpl, rows) {
      return rows.map((r, i) => tpl.columns.map((c) => (c.key === "sl" ? i + 1 : fmt.text(r, c.key, tpl.date_format))));
    },
    fileName(base, ext) { return (SF.S.settings.exporter.file_prefix || "staff") + "-" + base.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() + "-" + SF.DB.today() + "." + ext; },
    async staffXlsx(tpl, rows, meta) {
      const body = Out.matrix(tpl, rows), head = tpl.columns.map((c) => c.header || (fmt.field(c.key) || {}).label || c.key), top = [];
      top.push([{ v: tpl.company || SF.S.settings.company.name, s: 3 }]); top.push([{ v: [tpl.title, meta.subtitle].filter(Boolean).join(" — "), s: 4 }]);
      if (tpl.show_generated) top.push([{ v: "Generated " + fmt.dt(new Date().toISOString()) + " by " + SF.S.me.name + " · " + rows.length + " record(s)", s: 4 }]);
      top.push([]);
      const widths = head.map((h, i) => Math.min(40, Math.max(String(h).length, ...body.slice(0, 300).map((r) => String(r[i] == null ? "" : r[i]).length)) + 3));
      const logo = tpl.logo ? await SF.XLSX.logoFrom(tpl.logo, Math.max(0, head.length - 1)) : null;
      const blob = SF.XLSX.build({ sheetName: tpl.sheet_name, rows: top.concat([head.map((h) => ({ v: h, s: 2 }))], body.map((r) => r.map((v) => ({ v, s: 1 })))), widths, headerRow: top.length, font: tpl.font, fontSize: tpl.font_size, align: tpl.align, headerAlign: tpl.header_align,
        page: { orientation: tpl.orientation, size: tpl.page_size, header: tpl.header_text, footer: tpl.footer_text, pageNumbers: tpl.page_numbers }, logo });
      UI.download(Out.fileName(meta.file || "list", "xlsx"), blob);
    },
    /** generic sheet for other lists (transfers, audit, zonal …) */
    simpleXlsx(name, title, head, body, file) {
      const widths = head.map((h, i) => Math.min(50, Math.max(String(h).length, ...body.slice(0, 300).map((r) => String(r[i] == null ? "" : r[i]).length)) + 3));
      const rows = [[{ v: SF.S.settings.company.name, s: 3 }], [{ v: title + " · generated " + fmt.dt(new Date().toISOString()), s: 4 }], [], head.map((h) => ({ v: h, s: 2 }))].concat(body.map((r) => r.map((v) => ({ v, s: 1 }))));
      UI.download(Out.fileName(file || name, "xlsx"), SF.XLSX.build({ sheetName: name, rows, widths, headerRow: 3, page: { orientation: "landscape", size: "A4", pageNumbers: true } }));
    },
    printHtml(html, o) {
      o = o || {}; let root = document.getElementById("printRoot"); if (!root) { root = UI.el('<div id="printRoot"></div>'); document.body.appendChild(root); }
      let st = document.getElementById("printStyle"); if (!st) { st = document.createElement("style"); st.id = "printStyle"; document.head.appendChild(st); }
      const q = (s) => '"' + String(s || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
      st.textContent = `@page{size:${o.size || "A4"} ${o.orientation || "portrait"};margin:14mm 10mm 14mm 10mm;${o.header ? `@top-center{content:${q(o.header)};font:9pt sans-serif;color:#444}` : ""}${o.footer ? `@bottom-left{content:${q(o.footer)};font:8pt sans-serif;color:#444}` : ""}${o.pageNumbers ? '@bottom-right{content:"Page " counter(page) " of " counter(pages);font:8pt sans-serif;color:#444}' : ""}}
        #printRoot{font-family:${q(o.font || "Arial")},sans-serif;font-size:${o.fontSize || 10}pt;color:#000}`;
      root.innerHTML = html;
      const imgs = Array.from(root.querySelectorAll("img")), go = () => { window.print(); };
      Promise.all(imgs.map((im) => (im.complete ? 1 : new Promise((r) => { im.onload = im.onerror = r; })))).then(() => setTimeout(go, 50));
    },
    printHead(tpl, subtitle, count) {
      return `<div class="pr-h">${tpl.logo ? `<img src="${esc(tpl.logo)}" alt="">` : ""}<div style="flex:1"><div style="font-size:1.35em;font-weight:700">${esc(tpl.company || SF.S.settings.company.name)}</div><div>${esc([tpl.title, subtitle].filter(Boolean).join(" — "))}</div></div>
        ${tpl.show_generated ? `<div style="text-align:right;font-size:.85em;color:#444">Printed ${esc(fmt.dt(new Date().toISOString()))}<br>by ${esc(SF.S.me.name)}${count != null ? " · " + count + " record(s)" : ""}</div>` : ""}</div>`;
    },
    staffPrint(tpl, rows, meta) {
      const body = Out.matrix(tpl, rows), head = tpl.columns.map((c) => c.header || (fmt.field(c.key) || {}).label || c.key);
      Out.printHtml(Out.printHead(tpl, meta.subtitle, rows.length) + `<table class="pr-t"><thead><tr>${head.map((h) => `<th style="text-align:${tpl.header_align};background:#e7f3ec">${esc(h)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((v) => `<td style="text-align:${tpl.align}">${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
        { size: tpl.page_size, orientation: tpl.orientation, header: tpl.header_text, footer: tpl.footer_text, pageNumbers: tpl.page_numbers, font: tpl.font, fontSize: Math.max(7, tpl.font_size - 2) });
    },
    /** single staff sheet: every visible section and field of one person */
    sheetData(row, dateFmt) {
      return SF.S.sections.filter((s) => s.visible && s.kind === "fields").map((s) => ({ title: s.label, items: SF.S.fields.filter((f) => f.section === s.key && f.visible && f.type !== "photo").map((f) => [f.label, fmt.text(row, f.key, dateFmt)]) })).filter((s) => s.items.length);
    },
    staffSheetXlsx(tpl, row) {
      const rows = [[{ v: tpl.company || SF.S.settings.company.name, s: 3 }], [{ v: "Staff Sheet — " + row.name + " (Staff ID " + row.staff_no_text + ", " + fmt.hub(row.hub_id) + ")", s: 4 }], [{ v: "Generated " + fmt.dt(new Date().toISOString()) + " by " + SF.S.me.name, s: 4 }], []];
      Out.sheetData(row, tpl.date_format).forEach((s) => { rows.push([{ v: s.title, s: 2 }, { v: "", s: 2 }]); s.items.forEach((it) => rows.push([{ v: it[0], s: 1 }, { v: it[1], s: 1 }])); rows.push([]); });
      UI.download(Out.fileName("sheet-" + row.name, "xlsx"), SF.XLSX.build({ sheetName: "Staff Sheet", rows, widths: [30, 46], headerRow: -1, font: tpl.font, fontSize: tpl.font_size, align: "left", headerAlign: "left", page: { orientation: "portrait", size: tpl.page_size, footer: tpl.footer_text, pageNumbers: tpl.page_numbers } }));
    },
    staffSheetPrint(tpl, row) {
      const secs = Out.sheetData(row, tpl.date_format);
      Out.printHtml(Out.printHead(Object.assign({}, tpl, { title: "Staff Sheet" }), row.name, null) + `<div style="display:flex;gap:14px;align-items:center;margin-bottom:10px">${row.photo ? `<img src="${esc(row.photo)}" style="width:70px;height:70px;object-fit:cover;border:1px solid #888">` : ""}<div><div style="font-size:1.3em;font-weight:700">${esc(row.name)}</div><div>Staff ID ${esc(row.staff_no_text)} · ${esc(fmt.hub(row.hub_id))} · ${esc(fmt.position(row.position_id))}</div></div></div>` +
        secs.map((s) => `<h3 style="margin:12px 0 4px;font-size:1.05em;border-bottom:1px solid #000">${esc(s.title)}</h3><div class="pr-kv">${s.items.map((it) => `<div><span>${esc(it[0])}</span><b>${esc(it[1] || "—")}</b></div>`).join("")}</div>`).join(""),
        { size: tpl.page_size, orientation: "portrait", footer: tpl.footer_text, pageNumbers: tpl.page_numbers, font: tpl.font, fontSize: tpl.font_size - 1 });
    }
  };

  /* ---------------- start ---------------- */
  SF.start = async function () {
    const app = document.getElementById("app");
    app.innerHTML = UI.state("loading", "Loading…");
    try { await API.init(); } catch (e) { app.innerHTML = UI.state("error", "The demo could not start", e.message); return; }
    if (!API.hasSession()) return kick("");
    try { SF.refresh(); } catch (e) { return kick(e.message); }
    sessionStorage.setItem("sfhub_portal", SF.S.me.portal);
    renderShell(); wireShell(); route();
    window.addEventListener("hashchange", route);
    setInterval(() => { try { API.ping(); } catch (e) { kick(e.message); } }, 20000);
    window.addEventListener("afterprint", () => { const r = document.getElementById("printRoot"); if (r) r.innerHTML = ""; });
  };

  Object.assign(SF, { t, L, fmt, Out, pageLabel, kick, renderShell });
})();
