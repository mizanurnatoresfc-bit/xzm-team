/* Demo data store. The whole "database" is one JSON document in localStorage, so the demo runs
   with no server. Table names mirror the planned PostgreSQL tables (see supabase/migrations).
   Every write goes through DB.tx(): re-read, change, save — or roll back if anything throws. */
(function () {
  "use strict";
  const SF = (window.SF = window.SF || {});
  const KEY = "sfhub_staff_demo_v1";
  let data = null;

  const uid = (p) => p + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  const pad2 = (n) => String(n).padStart(2, "0");
  const dstr = (d) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  const today = () => dstr(new Date());
  const nowIso = () => new Date().toISOString();

  /* What can be permission-controlled. Pages are code, so this list is code; which role may do
     what on each page, and who sees which menu, is data (roles.perms, nav, pages). */
  const CATALOG = {
    actions: [["access", "Page Access"], ["view", "View"], ["create", "Create"], ["edit", "Edit"], ["delete", "Delete"], ["remove", "Remove"], ["export", "Export"], ["print", "Print"], ["approve", "Approve"], ["transfer", "Transfer"], ["settings", "Settings Access"]],
    modules: [
      { key: "staff", label: "Staff Management", pages: [
        { key: "dashboard", label: "Staff Dashboard", icon: "dashboard", acts: ["access", "view"] },
        { key: "staff", label: "Staff Directory", icon: "users", acts: ["access", "view", "create", "edit", "delete", "remove", "export", "print", "approve", "transfer", "settings"] },
        { key: "staff_activity", label: "Staff Activity History", icon: "activity", acts: ["access", "view"], hidden: true }] },
      { key: "transfers", label: "Transfer Management", pages: [
        { key: "transfers", label: "Transfers", icon: "transfer", acts: ["access", "view", "create", "approve", "export", "print"] }] },
      { key: "importer", label: "Employee Import", pages: [
        { key: "import", label: "Import Center", icon: "upload", acts: ["access", "view", "create", "delete", "export"] }] },
      { key: "exporter", label: "Export & Print", pages: [
        { key: "export", label: "Export & Print Center", icon: "printer", acts: ["access", "view", "export", "print", "settings"] }] },
      { key: "zonal", label: "Zonal Manager Activity", pages: [
        { key: "zonal", label: "Zonal Manager Activity", icon: "map", acts: ["access", "view", "create", "edit", "delete", "export", "print", "approve"] }] },
      { key: "control", label: "Super Admin Control Center", pages: [
        { key: "roles", label: "Roles & Permissions", icon: "shield", acts: ["access", "view", "create", "edit", "delete"] },
        { key: "users", label: "Users & Portal Access", icon: "key", acts: ["access", "view", "create", "edit"] },
        { key: "org", label: "Hubs, Zones & Positions", icon: "building", acts: ["access", "view", "create", "edit", "delete"] },
        { key: "fields", label: "Profile Builder", icon: "idcard", acts: ["access", "view", "create", "edit", "delete"] },
        { key: "table", label: "Staff Table Columns", icon: "columns", acts: ["access", "view", "edit"] },
        { key: "nav", label: "Sidebar & Pages", icon: "sidebar", acts: ["access", "view", "create", "edit", "delete"] },
        { key: "widgets", label: "Widgets & Action Buttons", icon: "widget", acts: ["access", "view", "edit"] },
        { key: "language", label: "Language Policy", icon: "language", acts: ["access", "view", "edit"] },
        { key: "idpolicy", label: "Staff ID Policy", icon: "hash", acts: ["access", "view", "edit"] },
        { key: "impexp", label: "Import / Export Settings", icon: "sliders", acts: ["access", "view", "edit"] },
        { key: "system", label: "System Configuration", icon: "settings", acts: ["access", "view", "edit"] }] },
      { key: "security", label: "Security & Audit", pages: [
        { key: "audit", label: "Audit Log", icon: "history", acts: ["access", "view", "export"] },
        { key: "logins", label: "Logins & Sessions", icon: "lock", acts: ["access", "view", "edit"] },
        { key: "backup", label: "Backup & Restore", icon: "database", acts: ["access", "export", "settings"] }] }
    ]
  };
  CATALOG.pages = {};
  CATALOG.modules.forEach((m) => m.pages.forEach((p) => { p.module = m.key; CATALOG.pages[p.key] = p; }));
  CATALOG.allKeys = () => { const k = []; CATALOG.modules.forEach((m) => { k.push("mod:" + m.key); m.pages.forEach((p) => p.acts.forEach((a) => k.push(p.key + ":" + a))); }); return k; };

  const PORTALS = [
    { key: "super", label: "Super Admin Portal", file: "super-admin.html", icon: "shield" },
    { key: "admin", label: "Admin Portal", file: "admin.html", icon: "briefcase" },
    { key: "staff", label: "Staff & Management Portal", file: "portal.html", icon: "users" }
  ];

  /* ---------------- rules shared by the API and the seed ---------------- */
  const Core = {
    fmtNo(d, n) { if (n == null || n === "") return ""; const p = d.settings.idpolicy || {}; return String(n).padStart(p.min_digits || 1, "0"); },
    /** Next free number for a hub. Numbers only; never hands out a number that is in use, and
        (unless the policy allows reuse) never one that was ever used in that hub. */
    nextStaffNo(d, hubId) {
      const pol = d.settings.idpolicy;
      let seq = d.id_sequences.find((s) => s.hub_id === hubId);
      if (!seq) { seq = { hub_id: hubId, next: pol.start }; d.id_sequences.push(seq); }
      const recs = d.staff_ids.filter((x) => x.hub_id === hubId);
      const taken = new Set(recs.filter((x) => (pol.reuse_released ? !x.released_at : true)).map((x) => x.number));
      let n = pol.reuse_released ? pol.start : Math.max(seq.next, pol.start);
      while (taken.has(n)) n++;
      if (n >= seq.next) seq.next = n + 1;
      return n;
    },
    assignStaffNo(d, staff, hubId, at, reason) {
      const pol = d.settings.idpolicy;
      d.staff_ids.filter((x) => x.staff_id === staff.id && !x.released_at).forEach((x) => { x.released_at = at; });
      let n = null;
      if (pol.restore_on_return) {
        const old = d.staff_ids.filter((x) => x.staff_id === staff.id && x.hub_id === hubId).sort((a, b) => (a.assigned_at < b.assigned_at ? 1 : -1))[0];
        if (old && !d.staff_ids.some((x) => x.hub_id === hubId && x.number === old.number && !x.released_at)) n = old.number;
      }
      if (n == null) n = Core.nextStaffNo(d, hubId);
      if (d.staff_ids.some((x) => x.hub_id === hubId && x.number === n && !x.released_at)) throw new Error("Staff ID " + n + " is already in use in this hub.");
      d.staff_ids.push({ id: uid("sid"), staff_id: staff.id, hub_id: hubId, number: n, assigned_at: at, released_at: null, reason: reason || "" });
      staff.staff_no = n;
      return n;
    },
    hubZone(d, hubId) { const h = d.hubs.find((x) => x.id === hubId); return h ? h.zone_id : null; },
    openAssignment(d, staff, from, change) {
      d.assignments.filter((a) => a.staff_id === staff.id && !a.to).forEach((a) => { a.to = from; });
      d.assignments.push({ id: uid("asg"), staff_id: staff.id, hub_id: staff.hub_id, zone_id: staff.zone_id, position_id: staff.position_id, manager_id: staff.manager_id || null, staff_no: staff.staff_no, from: from, to: null, change: change });
    },
    /** Applies an approved transfer. History rows are closed, never rewritten. */
    applyTransfer(d, tr, approverUserId, at) {
      const s = d.staff.find((x) => x.id === tr.staff_id);
      if (!s) throw new Error("Staff member not found.");
      const hubChanged = tr.to_hub && tr.to_hub !== s.hub_id;
      s.hub_id = tr.to_hub || s.hub_id;
      s.zone_id = Core.hubZone(d, s.hub_id);
      if (tr.to_position) s.position_id = tr.to_position;
      if (tr.to_manager !== undefined && tr.to_manager !== "") s.manager_id = tr.to_manager;
      if (hubChanged) Core.assignStaffNo(d, s, s.hub_id, tr.effective_date, "Transfer");
      tr.to_staff_no = s.staff_no; tr.to_zone = s.zone_id;
      tr.status = "approved"; tr.approved_by = approverUserId; tr.approved_at = at || nowIso();
      s.transferred_at = tr.effective_date;
      Core.openAssignment(d, s, tr.effective_date, "transfer");
    },
    audit(d, user, action, entity, entityId, summary, before, after) {
      d.audit_logs.push({ id: uid("aud"), at: nowIso(), user_id: user ? user.id : null, user_name: user ? user.username : "system", action, entity, entity_id: entityId || null, summary: summary || "", before: before === undefined ? null : before, after: after === undefined ? null : after });
    }
  };

  const DB = {
    KEY, uid, today, nowIso, dstr,
    get data() { return data; },
    exists() { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } },
    load() { const raw = localStorage.getItem(KEY); data = raw ? JSON.parse(raw) : null; return data; },
    save() {
      if (data.audit_logs.length > 1500) data.audit_logs = data.audit_logs.slice(-1500);
      if (data.login_history.length > 500) data.login_history = data.login_history.slice(-500);
      try { localStorage.setItem(KEY, JSON.stringify(data)); }
      catch (e) { throw new Error("The browser storage for this demo is full. Remove some photos or documents, or reset the demo data."); }
    },
    tx(fn) {
      DB.load();
      try { const r = fn(data); DB.save(); return r; }
      catch (e) { DB.load(); throw e; }
    },
    replace(obj) { data = obj; DB.save(); },
    wipe() { localStorage.removeItem(KEY); data = null; }
  };
  window.addEventListener("storage", (e) => { if (e.key === KEY) DB.load(); });

  SF.DB = DB; SF.Core = Core; SF.CATALOG = CATALOG; SF.PORTALS = PORTALS;
})();
