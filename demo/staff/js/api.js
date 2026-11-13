/* The demo's "server". The pages never touch SF.DB directly: every read and write goes through
   SF.API, which checks the session, the portal, the role permissions, the data scope and the
   field rules again — whatever the screen shows or hides. In production these same rules live
   in PostgreSQL (row level security + functions); here they run in the browser, so this file is
   a faithful model of the rules, not a security boundary. */
(function () {
  "use strict";
  const SF = window.SF, { DB, Core, CATALOG: CAT, PORTALS } = SF;
  const SKEY = "sfhub_session";

  class ApiError extends Error { constructor(code, msg, fields) { super(msg); this.code = code; this.fields = fields || null; } }
  const deny = (m) => { throw new ApiError(403, m || "You do not have permission to do this."); };
  const bad = (m, fields) => { throw new ApiError(422, m, fields); };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  /* ---------- password hashing (PBKDF2-SHA256, per-user salt) ---------- */
  const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const randHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
  async function hashPw(pw, saltHex) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
    const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
    return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 120000 }, key, 256));
  }
  const pwRule = (pw) => (typeof pw === "string" && pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw)) || bad("Password must be at least 8 characters and contain a letter and a number.", { password: "At least 8 characters, with a letter and a number." });

  /* ---------- small validators ---------- */
  const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + "T00:00:00")) && DB.dstr(new Date(s + "T00:00:00")) === s;
  function normPhone(v) {
    let p = String(v == null ? "" : v).replace(/\D/g, "");
    if (p.length === 13 && p.startsWith("880")) p = p.slice(2);
    if (p.length === 10 && p[0] === "1") p = "0" + p; // spreadsheets drop the leading zero
    return p;
  }
  const validPhone = (p) => /^01[3-9]\d{8}$/.test(p);
  function looseDate(v) {
    if (v == null || v === "") return "";
    if (typeof v === "number" || /^\d{4,5}(\.\d+)?$/.test(String(v))) { const n = Number(v); if (n > 20000 && n < 80000) return DB.dstr(new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000 + 43200000)); }
    const s = String(v).trim(); let m;
    if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) v = m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
    else if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/))) v = m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0");
    else return null;
    return validDate(v) ? v : null;
  }

  /* ---------- who is calling ---------- */
  function build(d, u, s) {
    const staff = d.staff.find((x) => x.id === u.staff_id) || null;
    const roles = d.staff_roles.filter((r) => r.staff_id === u.staff_id).map((r) => d.roles.find((x) => x.id === r.role_id)).filter((r) => r && r.status === "active");
    const perms = new Set(); roles.forEach((r) => Object.keys(r.perms || {}).forEach((k) => r.perms[k] && perms.add(k)));
    const ord = { self: 0, hub: 1, zone: 2, all: 3 };
    const scope = roles.reduce((a, r) => (ord[r.scope] > ord[a] ? r.scope : a), "self");
    return { d, user: u, session: s, staff, roles, perms, isSuper: roles.some((r) => r.is_super), rank: roles.length ? Math.min.apply(null, roles.map((r) => r.rank)) : 99, scope };
  }
  function ctx(noTouch) {
    const d = DB.data, tok = sessionStorage.getItem(SKEY);
    if (!d || !tok) throw new ApiError(401, "Please sign in.");
    const s = d.sessions.find((x) => x.id === tok), now = Date.now(), sec = d.settings.security;
    if (!s || s.revoked_at) throw new ApiError(401, "Your session has ended. Please sign in again.");
    if (new Date(s.expires_at).getTime() < now) throw new ApiError(401, "Your session has expired. Please sign in again.");
    if (now - new Date(s.last_seen).getTime() > sec.idle_minutes * 60000) { s.revoked_at = DB.nowIso(); s.end_reason = "idle"; DB.save(); throw new ApiError(401, "You were signed out after " + sec.idle_minutes + " minutes without activity."); }
    const u = d.users.find((x) => x.id === s.user_id);
    if (!u || u.status !== "active") throw new ApiError(401, "This account is not active.");
    if (!u.portals.includes(s.portal)) throw new ApiError(401, "Your access to this portal was removed.");
    const me = build(d, u, s);
    if (!me.staff || me.staff.status !== "active") throw new ApiError(401, "This account is not active.");
    if (!noTouch && now - new Date(s.last_seen).getTime() > 60000) { s.last_seen = DB.nowIso(); DB.save(); }
    return me;
  }
  function can(me, page, action) {
    const pg = CAT.pages[page]; if (!pg) return false;
    const pc = me.d.pages[page] || { enabled: true, portals: ["super", "admin", "staff"] };
    if (!pc.enabled || !pc.portals.includes(me.session.portal)) return false;
    if (!pg.acts.includes(action || "access")) return false;
    if (me.isSuper) return true;
    return me.perms.has("mod:" + pg.module) && me.perms.has(page + ":access") && (!action || action === "access" || me.perms.has(page + ":" + action));
  }
  const need = (me, page, action) => { if (!can(me, page, action)) deny("Not allowed: " + (CAT.pages[page] ? CAT.pages[page].label : page) + " → " + (action || "access") + "."); };
  function inScope(me, s) {
    if (me.isSuper || me.scope === "all") return true;
    if (me.scope === "zone") return s.zone_id === me.staff.zone_id;
    if (me.scope === "hub") return s.hub_id === me.staff.hub_id;
    return s.id === me.staff.id;
  }
  function hubInScope(me, hubId) {
    if (me.isSuper || me.scope === "all") return true;
    if (me.scope === "zone") return Core.hubZone(me.d, hubId) === me.staff.zone_id;
    return me.scope === "hub" && hubId === me.staff.hub_id;
  }
  const VIRTUAL = ["roles", "rank", "staffno", "status", "zone"];
  function canSeeField(me, f, s) {
    if (f.archived) return false;
    if (me.isSuper || !f.view_roles.length) return true;
    if (s && me.staff && s.id === me.staff.id) return true;
    return me.roles.some((r) => f.view_roles.includes(r.id));
  }
  function canEditField(me, f, creating) {
    if (f.archived || VIRTUAL.includes(f.type)) return false;
    if (f.locked && !creating) return false;
    if (me.isSuper) return true;
    if (f.view_roles.length && !me.roles.some((r) => f.view_roles.includes(r.id))) return false;
    return !f.edit_roles.length || me.roles.some((r) => f.edit_roles.includes(r.id));
  }
  const staffRoles = (d, id) => d.staff_roles.filter((r) => r.staff_id === id).map((r) => d.roles.find((x) => x.id === r.role_id)).filter(Boolean).sort((a, b) => a.rank - b.rank);
  const staffRank = (d, id) => { const r = staffRoles(d, id); return r.length ? r[0].rank : null; };

  /** What the caller is allowed to see of one staff record. Restricted fields are left out here,
      on the "server" side, so they never reach the page at all. */
  function present(me, s) {
    const d = me.d, o = { id: s.id, deleted_at: s.deleted_at, deleted_reason: s.deleted_reason, transferred_at: s.transferred_at, created_at: s.created_at, import_job: s.import_job || null, _hidden: [] };
    d.fields.forEach((f) => {
      if (f.archived) return;
      if (!canSeeField(me, f, s)) return o._hidden.push(f.key);
      if (f.type === "roles") o.roles = staffRoles(d, s.id).map((r) => r.id);
      else if (f.type === "rank") o.rank = staffRank(d, s.id);
      else o[f.key] = f.builtin ? s[f.key] : (s.custom || {})[f.key];
    });
    o.staff_no_text = has(o, "staff_no") ? Core.fmtNo(d, s.staff_no) : "";
    if (can(me, "users", "view") || (me.staff && me.staff.id === s.id)) {
      const u = d.users.find((x) => x.staff_id === s.id);
      o.account = u ? { id: u.id, username: u.username, portals: u.portals.slice(), status: u.status, last_login: u.last_login } : null;
    }
    return o;
  }
  function getStaff(me, id, opts) {
    const s = me.d.staff.find((x) => x.id === id);
    if (!s || !inScope(me, s)) throw new ApiError(404, "Staff member not found, or outside your hub / zone.");
    if (s.deleted_at && !(opts && opts.removedOk)) bad("This staff member has been removed.");
    return s;
  }
  function superCount(d, exceptStaff) {
    return d.users.filter((u) => u.status === "active" && u.portals.includes("super") && u.staff_id !== exceptStaff).filter((u) => {
      const s = d.staff.find((x) => x.id === u.staff_id);
      return s && s.status === "active" && staffRoles(d, u.staff_id).some((r) => r.is_super && r.status === "active");
    }).length;
  }
  const guardLastSuper = (d, staffId) => { if (staffRoles(d, staffId).some((r) => r.is_super) && superCount(d, staffId) === 0) bad("This is the last active Super Admin. Give another person Super Admin access first."); };
  function endSessions(d, staffId, why) { const u = d.users.find((x) => x.staff_id === staffId); if (u) d.sessions.filter((s) => s.user_id === u.id && !s.revoked_at).forEach((s) => { s.revoked_at = DB.nowIso(); s.end_reason = why; }); }
  /** Rank rule: you may only hand out (or take away) roles that rank below your own. */
  function roleGrantable(me, r) { return me.isSuper || (!r.is_super && r.rank > me.rank); }

  /* ---------- staff validation ---------- */
  function validateStaff(me, d, input, existing) {
    const errors = {}, vals = {}, custom = Object.assign({}, existing ? existing.custom : {}), creating = !existing;
    d.fields.forEach((f) => {
      if (f.archived || VIRTUAL.includes(f.type)) return;
      const cur = existing ? (f.builtin ? existing[f.key] : (existing.custom || {})[f.key]) : undefined;
      let v = has(input, f.key) ? input[f.key] : cur;
      if (v === undefined || v === null) v = f.type === "checkbox" ? false : "";
      if (typeof v === "string") v = v.trim();
      const changed = has(input, f.key) && String(v) !== String(cur == null ? (f.type === "checkbox" ? false : "") : cur);
      const editable = canEditField(me, f, creating);
      if (changed && !editable) {
        if (f.locked && !creating) { errors[f.key] = f.label + " can only be changed through a transfer."; return; }
        deny('You are not allowed to change "' + f.label + '".');
      }
      if (!editable && !creating) return;
      if (!editable && creating) { if (f.builtin) vals[f.key] = f.type === "checkbox" ? false : ""; return; }
      const empty = v === "" || v === false;
      if (f.required && empty) { errors[f.key] = f.label + " is required."; return; }
      if (!empty) {
        if (f.type === "tel") { v = normPhone(v); if (!validPhone(v)) errors[f.key] = "Enter a valid 11-digit mobile number (01XXXXXXXXX)."; }
        else if (f.type === "email") { if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) errors[f.key] = "Enter a valid email address."; }
        else if (f.type === "date") { if (!validDate(v)) errors[f.key] = "Enter a valid date."; }
        else if (f.type === "number") { if (!isFinite(Number(v))) errors[f.key] = "Enter a number."; else v = Number(v); }
        else if (f.type === "select") { if (f.options.length && !f.options.includes(v)) errors[f.key] = "Choose one of: " + f.options.join(", ") + "."; }
        else if (f.type === "photo") { if (!/^data:image\/(png|jpeg);base64,/.test(v) || v.length > 90000) errors[f.key] = "Use a PNG or JPG picture (it is resized automatically)."; }
        else if (f.type === "hub") { const h = d.hubs.find((x) => x.id === v); if (!h || h.status !== "active") errors[f.key] = "Choose an active hub."; else if (creating && !hubInScope(me, v)) errors[f.key] = "You can only add staff to a hub you manage."; }
        else if (f.type === "position") { const p = d.positions.find((x) => x.id === v); if (!p || (changed && p.status !== "active")) errors[f.key] = "Choose an active position."; }
        else if (f.type === "staff") { const m = d.staff.find((x) => x.id === v); if (!m || m.deleted_at) errors[f.key] = "Choose an existing staff member."; else if (existing && m.id === existing.id) errors[f.key] = "A person cannot report to themselves."; }
        else if (f.type === "text" && String(v).length > 200) errors[f.key] = "Too long (200 characters at most).";
        else if (f.type === "textarea" && String(v).length > 1000) errors[f.key] = "Too long (1000 characters at most).";
      }
      if (f.builtin) vals[f.key] = v; else custom[f.key] = v;
    });
    if (vals.phone && !errors.phone) {
      const dup = d.staff.find((x) => !x.deleted_at && x.phone === vals.phone && (!existing || x.id !== existing.id));
      if (dup) errors.phone = "This phone number already belongs to " + dup.name + ".";
    }
    return { vals, custom, errors };
  }
  function diff(before, after, d) {
    const o = {};
    Object.keys(after).forEach((k) => { const a = before[k] == null ? "" : before[k], b = after[k] == null ? "" : after[k]; if (JSON.stringify(a) !== JSON.stringify(b)) o[k] = k === "photo" ? ["(photo)", "(photo)"] : [a, b]; });
    return o;
  }
  function createStaff(me, d, v, roleIds, status, extra) {
    const s = Object.assign({ id: DB.uid("st"), photo: "", email: "", manager_id: null, staff_no: null, custom: v.custom, transferred_at: null, created_at: DB.nowIso(), created_by: me.user.id, deleted_at: null, deleted_reason: "", status }, v.vals, extra || {});
    s.zone_id = Core.hubZone(d, s.hub_id);
    d.staff.push(s);
    Core.assignStaffNo(d, s, s.hub_id, s.joining_date || DB.today(), "Joining");
    Core.openAssignment(d, s, s.joining_date || DB.today(), "joining");
    (roleIds || []).forEach((rid) => d.staff_roles.push({ id: DB.uid("sr"), staff_id: s.id, role_id: rid, assigned_at: DB.nowIso(), assigned_by: me.user.id }));
    return s;
  }
  function checkRoleIds(me, d, roleIds) {
    return Array.from(new Set(roleIds || [])).map((rid) => {
      const r = d.roles.find((x) => x.id === rid && x.status === "active"); if (!r) bad("Unknown or inactive role.");
      if (!roleGrantable(me, r)) deny('You cannot assign the role "' + r.name + '" — it ranks at or above your own.');
      return r.id;
    });
  }

  /* ---------- wrappers ---------- */
  const read = (fn) => function () { const me = ctx(); return fn.apply(null, [me, me.d].concat(Array.from(arguments))); };
  const write = (name, fn) => function () {
    const args = Array.from(arguments);
    try { return DB.tx(() => { const me = ctx(); return fn.apply(null, [me, me.d].concat(args)); }); }
    catch (e) {
      if (e && e.code === 403) { try { DB.tx((d) => { const me = ctx(); Core.audit(d, me.user, "DENIED", "security", null, name + ": " + e.message); }); } catch (x) { /* not signed in */ } }
      throw e;
    }
  };

  const API = { ApiError, normPhone, looseDate };

  /* =============================== AUTH =============================== */
  API.init = async function () {
    if (!window.crypto || !crypto.subtle) throw new Error("This demo needs a secure page (http://localhost or https).");
    if (!DB.exists()) DB.replace(SF.seed()); else DB.load();
    const d = DB.data, todo = d.users.filter((u) => u.seed_pw);
    for (const u of todo) { u.salt = randHex(16); u.hash = await hashPw(u.seed_pw, u.salt); delete u.seed_pw; }
    if (todo.length) DB.save();
  };
  API.publicInfo = function () { const d = DB.data; return { company: d.settings.company, hints: !!d.settings.security.show_login_hints, lang: d.settings.language }; };
  API.login = async function (portal, username, password) {
    DB.load();
    const uname = String(username || "").trim().toLowerCase(), generic = "Incorrect username or password, or this account is not assigned to this portal.";
    if (!PORTALS.some((p) => p.key === portal)) bad("Unknown portal.");
    const found = DB.data.users.find((x) => x.username === uname);
    const okPw = found ? (await hashPw(String(password || ""), found.salt)) === found.hash : (await hashPw("x", "00"), false);
    return DB.tx((d) => {
      const u = d.users.find((x) => x.username === uname), sec = d.settings.security;
      const hist = (success, reason) => d.login_history.push({ id: DB.uid("lg"), at: DB.nowIso(), username: uname, user_id: u ? u.id : null, portal, success, reason: reason || "", ua: navigator.userAgent.slice(0, 120) });
      const fail = (reason, msg) => { hist(false, reason); return { ok: false, message: msg || generic }; };
      if (!u) return fail("unknown user");
      if (u.locked_until && new Date(u.locked_until) > new Date()) return fail("locked", "This account is locked after too many failed attempts. Try again in " + Math.ceil((new Date(u.locked_until) - Date.now()) / 60000) + " minute(s), or ask a Super Admin to unlock it.");
      if (!okPw) {
        u.failed = (u.failed || 0) + 1;
        if (u.failed >= sec.max_failed) { u.locked_until = new Date(Date.now() + sec.lock_minutes * 60000).toISOString(); u.failed = 0; Core.audit(d, u, "LOCKOUT", "user", u.id, "Account locked after repeated failed sign-ins"); return fail("wrong password — locked", "Too many failed attempts. This account is now locked for " + sec.lock_minutes + " minutes."); }
        return fail("wrong password");
      }
      const st = d.staff.find((x) => x.id === u.staff_id);
      if (u.status !== "active" || !st || st.status !== "active") return fail("account not active");
      if (!u.portals.includes(portal)) return fail("portal not assigned");
      if (portal === "super" && !staffRoles(d, u.staff_id).some((r) => r.is_super && r.status === "active")) return fail("not a super admin");
      u.failed = 0; u.locked_until = null; u.last_login = DB.nowIso();
      const s = { id: randHex(24), user_id: u.id, portal, created_at: DB.nowIso(), last_seen: DB.nowIso(), expires_at: new Date(Date.now() + sec.session_hours * 3600000).toISOString(), revoked_at: null, end_reason: "", ua: navigator.userAgent.slice(0, 120) };
      d.sessions.push(s); if (d.sessions.length > 200) d.sessions = d.sessions.slice(-200);
      sessionStorage.setItem(SKEY, s.id); hist(true, "");
      Core.audit(d, u, "LOGIN", "session", null, "Signed in through the " + PORTALS.find((p) => p.key === portal).label);
      return { ok: true, must_change: !!u.must_change };
    });
  };
  API.logout = function () {
    try { DB.tx((d) => { const tok = sessionStorage.getItem(SKEY), s = d.sessions.find((x) => x.id === tok); if (s && !s.revoked_at) { s.revoked_at = DB.nowIso(); s.end_reason = "signed out"; const u = d.users.find((x) => x.id === s.user_id); Core.audit(d, u, "LOGOUT", "session", null, "Signed out"); } }); } catch (e) { /* ignore */ }
    sessionStorage.removeItem(SKEY);
  };
  API.hasSession = () => !!sessionStorage.getItem(SKEY);
  /** session check that does not count as user activity (used by the idle timer) */
  API.ping = () => { ctx(true); return true; };
  API.sessionPortal = () => { try { return ctx(true).session.portal; } catch (e) { return null; } };
  API.changePassword = async function (oldPw, newPw) {
    const me = ctx(); pwRule(newPw);
    if ((await hashPw(String(oldPw || ""), me.user.salt)) !== me.user.hash) bad("The current password is not correct.", { old: "Not correct." });
    const salt = randHex(16), hash = await hashPw(newPw, salt);
    return DB.tx((d) => { const m = ctx(), u = d.users.find((x) => x.id === m.user.id); u.salt = salt; u.hash = hash; u.must_change = false; Core.audit(d, u, "PASSWORD", "user", u.id, "Changed own password"); return true; });
  };

  /* =============================== BOOTSTRAP =============================== */
  function resolveLang(me) {
    const L = me.d.settings.language;
    if (me.staff && L.position[me.staff.position_id]) return L.position[me.staff.position_id];
    const r = me.roles.slice().sort((a, b) => a.rank - b.rank).find((x) => L.role[x.id]); if (r) return L.role[r.id];
    return L.portal[me.session.portal] || L.default || "en";
  }
  API.boot = read((me, d) => {
    const perms = []; CAT.modules.forEach((m) => m.pages.forEach((p) => p.acts.forEach((a) => { if (can(me, p.key, a)) perms.push(p.key + ":" + a); })));
    const st = d.settings;
    return clone({
      me: { user_id: me.user.id, username: me.user.username, portals: me.user.portals, portal: me.session.portal, staff_id: me.staff.id, name: me.staff.name, photo: me.staff.photo, hub_id: me.staff.hub_id, zone_id: me.staff.zone_id,
        roles: me.roles.map((r) => r.id), rank: me.rank, isSuper: me.isSuper, scope: me.scope, lang: resolveLang(me), expires_at: me.session.expires_at },
      perms,
      zones: d.zones, hubs: d.hubs, positions: d.positions,
      roles: d.roles.map((r) => ({ id: r.id, name: r.name, rank: r.rank, color: r.color, scope: r.scope, is_super: r.is_super, system: r.system, status: r.status, grantable: roleGrantable(me, r) })),
      sections: d.sections.slice().sort((a, b) => a.order - b.order),
      fields: d.fields.filter((f) => canSeeField(me, f)).sort((a, b) => a.order - b.order).map((f) => Object.assign({}, f, { can_edit: canEditField(me, f, false), can_set: canEditField(me, f, true) })),
      layouts: d.layouts.filter((l) => l.shared || l.owner === me.user.id),
      nav: d.nav.slice().sort((a, b) => a.order - b.order), pages: d.pages,
      widgets: d.widgets.slice().sort((a, b) => a.order - b.order), actions: d.actions.slice().sort((a, b) => a.order - b.order),
      templates: can(me, "export", "view") || can(me, "staff", "export") || can(me, "staff", "print") ? d.export_templates : [],
      settings: { company: st.company, idpolicy: st.idpolicy, staff: st.staff, exporter: st.exporter, importer: st.importer, security: { idle_minutes: st.security.idle_minutes } }
    });
  });

  /* =============================== STAFF =============================== */
  function filterStaff(me, d, q, skipStatus) {
    q = q || {};
    const txt = String(q.search || "").trim().toLowerCase(), month = DB.today().slice(0, 7);
    const hubN = {}, posN = {}; d.hubs.forEach((h) => (hubN[h.id] = h.name.toLowerCase())); d.positions.forEach((p) => (posN[p.id] = p.name.toLowerCase()));
    return d.staff.filter((s) => {
      if (!inScope(me, s)) return false;
      if (q.hub && s.hub_id !== q.hub) return false;
      if (q.zone && s.zone_id !== q.zone) return false;
      if (q.position && s.position_id !== q.position) return false;
      if (q.role && !d.staff_roles.some((r) => r.staff_id === s.id && r.role_id === q.role)) return false;
      if (q.rank && String(staffRank(d, s.id)) !== String(q.rank)) return false;
      if (q.join_from && (s.joining_date || "") < q.join_from) return false;
      if (q.join_to && (s.joining_date || "9") > q.join_to) return false;
      if (q.month && (s.joining_date || "").slice(5, 7) !== String(q.month).padStart(2, "0")) return false;
      if (q.year && (s.joining_date || "").slice(0, 4) !== String(q.year)) return false;
      if (q.ids && !q.ids.includes(s.id)) return false;
      if (txt) {
        const hay = [s.name, s.phone, Core.fmtNo(d, s.staff_no), s.email, hubN[s.hub_id], posN[s.position_id]].join(" ").toLowerCase();
        if (!txt.split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      if (skipStatus) return true;
      if (q.card === "transferred") return !s.deleted_at && !!s.transferred_at;
      if (q.card === "new_month") return !s.deleted_at && (s.joining_date || "").slice(0, 7) === month;
      if (q.status) return s.status === q.status;
      return !s.deleted_at;
    });
  }
  API.staffList = read((me, d, q) => {
    need(me, "staff", "view");
    const base = filterStaff(me, d, q, true).filter((s) => !s.deleted_at), month = DB.today().slice(0, 7);
    const stats = { total: base.length, active: 0, inactive: 0, pending: 0, transferred: 0, new_month: 0, removed: filterStaff(me, d, q, true).length - base.length };
    base.forEach((s) => { if (stats[s.status] !== undefined) stats[s.status]++; if (s.transferred_at) stats.transferred++; if ((s.joining_date || "").slice(0, 7) === month) stats.new_month++; });
    return clone({ rows: filterStaff(me, d, q).map((s) => present(me, s)), stats });
  });
  API.staffGet = read((me, d, id) => {
    need(me, "staff", "view");
    const s = getStaff(me, id, { removedOk: true }), o = present(me, s);
    o.assignments = d.assignments.filter((a) => a.staff_id === id).sort((a, b) => (a.from < b.from ? 1 : -1));
    o.id_history = d.staff_ids.filter((x) => x.staff_id === id).sort((a, b) => (a.assigned_at < b.assigned_at ? 1 : -1));
    o.transfers = d.transfers.filter((t) => t.staff_id === id).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    o.documents = d.documents.filter((x) => x.staff_id === id && !x.deleted_at).map((x) => ({ id: x.id, name: x.name, kind: x.kind, size: x.size, uploaded_at: x.uploaded_at, has_file: !!x.data }));
    const names = {}; d.staff.forEach((x) => (names[x.id] = x.name)); o.manager_name = s.manager_id ? names[s.manager_id] : "";
    o.role_log = d.staff_roles.filter((r) => r.staff_id === id);
    return clone(o);
  });
  API.staffNames = read((me, d) => !can(me, "staff", "view") || me.scope === "self" ? [{ id: me.staff.id, name: me.staff.name, hub_id: me.staff.hub_id, staff_no: Core.fmtNo(d, me.staff.staff_no) }] : d.staff.filter((s) => !s.deleted_at && s.status !== "pending").map((s) => ({ id: s.id, name: s.name, hub_id: s.hub_id, staff_no: Core.fmtNo(d, s.staff_no) })));
  API.dashboard = read((me, d) => {
    need(me, "dashboard", "view");
    const list = d.staff.filter((s) => inScope(me, s) && !s.deleted_at), by = (k) => { const m = {}; list.forEach((s) => (m[s[k]] = (m[s[k]] || 0) + 1)); return m; };
    const ids = new Set(list.map((s) => s.id)), month = DB.today().slice(0, 7);
    const stats = { total: list.length, active: 0, inactive: 0, pending: 0, transferred: 0, new_month: 0 };
    list.forEach((s) => { if (stats[s.status] !== undefined) stats[s.status]++; if (s.transferred_at) stats.transferred++; if ((s.joining_date || "").slice(0, 7) === month) stats.new_month++; });
    return clone({
      stats,
      by_hub: by("hub_id"), by_position: by("position_id"),
      pending: list.filter((s) => s.status === "pending").map((s) => ({ id: s.id, name: s.name, hub_id: s.hub_id, position_id: s.position_id, joining_date: s.joining_date })),
      pending_transfers: d.transfers.filter((t) => t.status === "pending" && ids.has(t.staff_id)).length,
      recent: can(me, "staff_activity", "view") ? d.audit_logs.filter((a) => (a.entity === "staff" || a.entity === "transfer") && (!a.entity_id || a.entity !== "staff" || ids.has(a.entity_id))).slice(-8).reverse().map((a) => ({ at: a.at, user_name: a.user_name, action: a.action, summary: a.summary })) : null
    });
  });

  API.staffCreate = write("staffCreate", (me, d, input, roleIds) => {
    need(me, "staff", "create");
    const v = validateStaff(me, d, input, null);
    if (Object.keys(v.errors).length) bad("Please correct the highlighted fields.", v.errors);
    const rids = checkRoleIds(me, d, roleIds);
    const status = !d.settings.staff.new_requires_approval || can(me, "staff", "approve") ? "active" : "pending";
    const s = createStaff(me, d, v, rids, status);
    Core.audit(d, me.user, "CREATE", "staff", s.id, "Added " + s.name + " — Staff ID " + Core.fmtNo(d, s.staff_no) + (status === "pending" ? " (waiting for approval)" : ""), null, { name: s.name, hub_id: s.hub_id, position_id: s.position_id, status });
    return { id: s.id, status, staff_no: Core.fmtNo(d, s.staff_no) };
  });
  API.staffUpdate = write("staffUpdate", (me, d, id, input) => {
    need(me, "staff", "edit");
    const s = getStaff(me, id), before = Object.assign({}, s, s.custom), v = validateStaff(me, d, input, s);
    if (Object.keys(v.errors).length) bad("Please correct the highlighted fields.", v.errors);
    Object.assign(s, v.vals); s.custom = v.custom; s.updated_at = DB.nowIso(); s.updated_by = me.user.id;
    const ch = diff(before, Object.assign({}, v.vals, v.custom), d);
    if (Object.keys(ch).length) Core.audit(d, me.user, "UPDATE", "staff", s.id, "Edited " + s.name + ": " + Object.keys(ch).join(", "), null, ch);
    return { changed: Object.keys(ch) };
  });
  API.staffSetRoles = write("staffSetRoles", (me, d, id, roleIds) => {
    need(me, "staff", "edit");
    const s = getStaff(me, id), cur = d.staff_roles.filter((r) => r.staff_id === id), want = Array.from(new Set(roleIds || []));
    const add = want.filter((r) => !cur.some((c) => c.role_id === r)), drop = cur.filter((c) => !want.includes(c.role_id));
    if (me.staff.id === id && !me.isSuper) deny("You cannot change your own roles.");
    checkRoleIds(me, d, add);
    drop.forEach((c) => { const r = d.roles.find((x) => x.id === c.role_id); if (r && !roleGrantable(me, r)) deny('You cannot remove the role "' + r.name + '" — it ranks at or above your own.'); });
    if (drop.some((c) => (d.roles.find((x) => x.id === c.role_id) || {}).is_super) && superCount(d, id) === 0) bad("This is the last active Super Admin. Give another person Super Admin access first.");
    d.staff_roles = d.staff_roles.filter((r) => !drop.includes(r));
    add.forEach((rid) => d.staff_roles.push({ id: DB.uid("sr"), staff_id: id, role_id: rid, assigned_at: DB.nowIso(), assigned_by: me.user.id }));
    const u = d.users.find((x) => x.staff_id === id);
    if (u && u.portals.includes("super") && !staffRoles(d, id).some((r) => r.is_super)) u.portals = u.portals.filter((p) => p !== "super");
    const nm = (rid) => (d.roles.find((x) => x.id === rid) || {}).name;
    if (add.length || drop.length) Core.audit(d, me.user, "ROLES", "staff", id, "Roles of " + s.name + " changed" + (add.length ? " — added: " + add.map(nm).join(", ") : "") + (drop.length ? " — removed: " + drop.map((c) => nm(c.role_id)).join(", ") : ""));
    return true;
  });
  function eachStaff(me, ids, fn) { const out = { done: 0, skipped: [] }; ids.forEach((id) => { const s = getStaff(me, id, { removedOk: true }); const why = fn(s); if (why) out.skipped.push(s.name + " — " + why); else out.done++; }); return out; }
  API.staffSetStatus = write("staffSetStatus", (me, d, ids, status, reason) => {
    need(me, "staff", "edit");
    if (!["active", "inactive"].includes(status)) bad("Unknown status.");
    if (status === "inactive" && !String(reason || "").trim()) bad("A reason is required to deactivate staff.");
    return eachStaff(me, ids, (s) => {
      if (s.deleted_at) return "removed";
      if (s.status === "pending") return "waiting for approval — use Approve";
      if (s.status === status) return "already " + status;
      if (status === "inactive") { if (s.id === me.staff.id) return "you cannot deactivate yourself"; guardLastSuper(d, s.id); endSessions(d, s.id, "staff deactivated"); }
      s.status = status; s.updated_at = DB.nowIso(); s.updated_by = me.user.id;
      Core.audit(d, me.user, status === "active" ? "ACTIVATE" : "DEACTIVATE", "staff", s.id, (status === "active" ? "Activated " : "Deactivated ") + s.name + (reason ? " — " + reason : ""));
    });
  });
  API.staffApprove = write("staffApprove", (me, d, ids) => {
    need(me, "staff", "approve");
    return eachStaff(me, ids, (s) => {
      if (s.status !== "pending" || s.deleted_at) return "not waiting for approval";
      s.status = "active"; s.approved_by = me.user.id; s.approved_at = DB.nowIso();
      Core.audit(d, me.user, "APPROVE", "staff", s.id, "Approved new staff member " + s.name);
    });
  });
  API.staffRemove = write("staffRemove", (me, d, ids, reason) => {
    need(me, "staff", "remove");
    if (!String(reason || "").trim()) bad("A reason is required to remove staff.");
    return eachStaff(me, ids, (s) => {
      if (s.deleted_at) return "already removed";
      if (s.id === me.staff.id) return "you cannot remove yourself";
      guardLastSuper(d, s.id);
      if (d.transfers.some((t) => t.staff_id === s.id && t.status === "pending")) return "has a transfer waiting for approval";
      s.prev_status = s.status; s.status = "removed"; s.deleted_at = DB.nowIso(); s.deleted_by = me.user.id; s.deleted_reason = reason.trim();
      d.staff_ids.filter((x) => x.staff_id === s.id && !x.released_at).forEach((x) => { x.released_at = DB.today(); });
      d.assignments.filter((a) => a.staff_id === s.id && !a.to).forEach((a) => { a.to = DB.today(); });
      const u = d.users.find((x) => x.staff_id === s.id); if (u) { u.status = "disabled"; endSessions(d, s.id, "staff removed"); }
      Core.audit(d, me.user, "REMOVE", "staff", s.id, "Removed " + s.name + " (kept in the archive) — " + reason.trim());
    });
  });
  API.staffRestore = write("staffRestore", (me, d, id) => {
    need(me, "staff", "remove");
    const s = getStaff(me, id, { removedOk: true }); if (!s.deleted_at) bad("This staff member is not removed.");
    s.deleted_at = null; s.deleted_reason = ""; s.status = "inactive";
    Core.assignStaffNo(d, s, s.hub_id, DB.today(), "Restored"); Core.openAssignment(d, s, DB.today(), "restored");
    Core.audit(d, me.user, "RESTORE", "staff", s.id, "Restored " + s.name + " as inactive — Staff ID " + Core.fmtNo(d, s.staff_no));
    return true;
  });
  API.staffDelete = write("staffDelete", (me, d, id, reason) => {
    need(me, "staff", "delete");
    if (!d.settings.staff.allow_permanent_delete) deny("Permanent deletion is switched off in System Configuration.");
    const s = getStaff(me, id, { removedOk: true }); if (!s.deleted_at) bad("Remove the staff member first. Only removed records can be deleted permanently.");
    if (!String(reason || "").trim()) bad("A reason is required.");
    d.staff = d.staff.filter((x) => x.id !== id); d.staff_roles = d.staff_roles.filter((x) => x.staff_id !== id);
    d.users = d.users.filter((x) => x.staff_id !== id); d.documents = d.documents.filter((x) => x.staff_id !== id);
    d.staff.forEach((x) => { if (x.manager_id === id) x.manager_id = null; });
    Core.audit(d, me.user, "DELETE", "staff", id, "Permanently deleted " + s.name + " — " + reason.trim() + ". Staff ID and transfer history rows are kept.", { name: s.name, phone: s.phone, hub_id: s.hub_id, staff_no: s.staff_no });
    return true;
  });
  API.documentAdd = write("documentAdd", (me, d, staffId, doc) => {
    need(me, "staff", "edit"); const s = getStaff(me, staffId);
    if (!doc || !String(doc.name || "").trim()) bad("Choose a file.");
    if (doc.size > 400000) bad("This demo keeps files in the browser, so each document must be under 400 KB.");
    if (!/\.(pdf|png|jpe?g)$/i.test(doc.name)) bad("Only PDF, PNG or JPG files are accepted.");
    d.documents.push({ id: DB.uid("doc"), staff_id: staffId, name: doc.name.slice(0, 120), kind: String(doc.kind || "Other").slice(0, 40), size: doc.size, data: doc.data || "", uploaded_at: DB.nowIso(), uploaded_by: me.user.id, deleted_at: null });
    Core.audit(d, me.user, "DOCUMENT", "staff", staffId, "Added document “" + doc.name + "” (" + (doc.kind || "Other") + ") for " + s.name);
    return true;
  });
  API.documentGet = read((me, d, id) => { need(me, "staff", "view"); const x = d.documents.find((y) => y.id === id && !y.deleted_at); if (!x) bad("Document not found."); getStaff(me, x.staff_id, { removedOk: true }); return { name: x.name, data: x.data }; });
  API.documentRemove = write("documentRemove", (me, d, id) => {
    need(me, "staff", "edit"); const x = d.documents.find((y) => y.id === id && !y.deleted_at); if (!x) bad("Document not found.");
    const s = getStaff(me, x.staff_id); x.deleted_at = DB.nowIso(); x.data = "";
    Core.audit(d, me.user, "DOCUMENT", "staff", s.id, "Removed document “" + x.name + "” of " + s.name); return true;
  });
  API.staffActivity = read((me, d, id) => {
    need(me, "staff_activity", "view"); getStaff(me, id, { removedOk: true });
    const tids = new Set(d.transfers.filter((t) => t.staff_id === id).map((t) => t.id));
    return clone(d.audit_logs.filter((a) => (a.entity === "staff" && a.entity_id === id) || (a.entity === "transfer" && tids.has(a.entity_id))).reverse());
  });

  /* =============================== TRANSFERS =============================== */
  API.transferList = read((me, d, q) => {
    need(me, "transfers", "view"); q = q || {};
    const nm = {}; d.staff.forEach((s) => (nm[s.id] = s)); const un = {}; d.users.forEach((u) => (un[u.id] = (nm[u.staff_id] || {}).name || u.username));
    return clone(d.transfers.filter((t) => {
      const s = nm[t.staff_id]; if (!s) return false;
      if (!(inScope(me, s) || hubInScope(me, t.to_hub) || hubInScope(me, t.from_hub))) return false;
      if (q.status && t.status !== q.status) return false;
      if (q.hub && t.from_hub !== q.hub && t.to_hub !== q.hub) return false;
      if (q.zone && t.from_zone !== q.zone && t.to_zone !== q.zone) return false;
      if (q.from && t.effective_date < q.from) return false;
      if (q.to && t.effective_date > q.to) return false;
      if (q.staff_id && t.staff_id !== q.staff_id) return false;
      return true;
    }).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).map((t) => Object.assign({}, t, { staff_name: nm[t.staff_id].name, requested_name: un[t.requested_by] || "", approved_name: un[t.approved_by] || "", from_manager_name: (nm[t.from_manager] || {}).name || "", to_manager_name: (nm[t.to_manager] || {}).name || "",
      can_decide: t.status === "pending" && can(me, "transfers", "approve") && (me.isSuper || t.requested_by !== me.user.id) })));
  });
  API.transferCreate = write("transferCreate", (me, d, inp) => {
    need(me, "transfers", "create");
    const s = getStaff(me, inp.staff_id), e = {};
    if (s.status !== "active") bad("Only active staff can be transferred. " + s.name + " is " + s.status + ".");
    if (d.transfers.some((t) => t.staff_id === s.id && t.status === "pending")) bad(s.name + " already has a transfer waiting for approval.");
    const toHub = inp.to_hub || s.hub_id, toPos = inp.to_position || s.position_id, toMgr = inp.to_manager === undefined || inp.to_manager === "" ? s.manager_id : inp.to_manager;
    const h = d.hubs.find((x) => x.id === toHub); if (!h || h.status !== "active") e.to_hub = "Choose an active hub.";
    const p = d.positions.find((x) => x.id === toPos); if (!p || (toPos !== s.position_id && p.status !== "active")) e.to_position = "Choose an active position.";
    if (toMgr) { const m = d.staff.find((x) => x.id === toMgr); if (!m || m.deleted_at) e.to_manager = "Choose an existing staff member."; else if (m.id === s.id) e.to_manager = "A person cannot report to themselves."; }
    if (!validDate(inp.effective_date || "")) e.effective_date = "Enter the effective date.";
    if (!String(inp.reason || "").trim()) e.reason = "A reason is required.";
    if (!Object.keys(e).length && toHub === s.hub_id && toPos === s.position_id && (toMgr || null) === (s.manager_id || null)) e.to_hub = "Nothing changes — choose a different hub, position or reporting manager.";
    if (Object.keys(e).length) bad("Please correct the highlighted fields.", e);
    const tr = { id: DB.uid("tr"), staff_id: s.id, from_hub: s.hub_id, to_hub: toHub, from_zone: s.zone_id, to_zone: h.zone_id, from_position: s.position_id, to_position: toPos, from_manager: s.manager_id || null, to_manager: toMgr || null,
      from_staff_no: s.staff_no, to_staff_no: null, effective_date: inp.effective_date, reason: inp.reason.trim(), status: "pending", requested_by: me.user.id, approved_by: null, approved_at: null, decision_note: "", created_at: DB.nowIso() };
    d.transfers.push(tr);
    Core.audit(d, me.user, "TRANSFER_REQUEST", "transfer", tr.id, "Transfer requested for " + s.name + ": " + hubName(d, tr.from_hub) + " → " + hubName(d, tr.to_hub));
    if (inp.approve_now) {
      if (!can(me, "transfers", "approve")) deny("You cannot approve transfers.");
      if (!me.isSuper) deny("The person who requests a transfer cannot approve it. Another authorised person must approve.");
      Core.applyTransfer(d, tr, me.user.id); Core.audit(d, me.user, "TRANSFER_APPROVE", "transfer", tr.id, "Transfer of " + s.name + " approved and applied — new Staff ID " + Core.fmtNo(d, tr.to_staff_no) + " at " + hubName(d, tr.to_hub));
    }
    return { id: tr.id, status: tr.status };
  });
  const hubName = (d, id) => (d.hubs.find((h) => h.id === id) || {}).name || "—";
  API.transferDecide = write("transferDecide", (me, d, id, decision, note) => {
    need(me, "transfers", "approve");
    const tr = d.transfers.find((t) => t.id === id); if (!tr) bad("Transfer not found.");
    const s = d.staff.find((x) => x.id === tr.staff_id);
    if (!s || !(inScope(me, s) || hubInScope(me, tr.to_hub))) deny("This transfer is outside your hub / zone.");
    if (tr.status !== "pending") bad("This transfer was already " + tr.status + ".");
    if (tr.requested_by === me.user.id && !me.isSuper) deny("The person who requests a transfer cannot approve or reject it.");
    if (decision === "approve") {
      if (s.status !== "active") bad(s.name + " is no longer active; the transfer cannot be applied.");
      tr.decision_note = String(note || "").trim(); Core.applyTransfer(d, tr, me.user.id);
      Core.audit(d, me.user, "TRANSFER_APPROVE", "transfer", tr.id, "Transfer of " + s.name + " approved — " + hubName(d, tr.from_hub) + " (ID " + Core.fmtNo(d, tr.from_staff_no) + ") → " + hubName(d, tr.to_hub) + " (ID " + Core.fmtNo(d, tr.to_staff_no) + ")");
    } else if (decision === "reject") {
      if (!String(note || "").trim()) bad("A reason is required to reject a transfer.");
      tr.status = "rejected"; tr.approved_by = me.user.id; tr.approved_at = DB.nowIso(); tr.decision_note = note.trim();
      Core.audit(d, me.user, "TRANSFER_REJECT", "transfer", tr.id, "Transfer of " + s.name + " rejected — " + note.trim());
    } else bad("Unknown decision.");
    return { status: tr.status, to_staff_no: Core.fmtNo(d, tr.to_staff_no) };
  });

  /* =============================== IMPORT =============================== */
  function checkImportRows(me, d, rows) {
    const set = d.settings.importer, seen = { phone: {}, nid: {} }, out = [];
    const find = (list, v) => { const t = String(v || "").trim().toLowerCase(); return t ? list.find((x) => x.name.toLowerCase() === t || String(x.code || "").toLowerCase() === t) : null; };
    rows.forEach((raw, i) => {
      const r = { row: raw.__row || i + 2, errors: [], input: {}, role_ids: [], label: "" }, inp = {};
      d.fields.forEach((f) => {
        if (f.archived || VIRTUAL.includes(f.type) || f.type === "photo" || !has(raw, f.key)) return;
        let v = raw[f.key]; v = v == null ? "" : String(v).trim();
        if (v === "") return;
        if (f.type === "hub") { const h = find(d.hubs, v); if (!h) return r.errors.push("Unknown hub “" + v + "”"); v = h.id; }
        else if (f.type === "position") { const p = find(d.positions, v); if (!p) return r.errors.push("Unknown position “" + v + "”"); v = p.id; }
        else if (f.type === "staff") { const m = d.staff.find((x) => !x.deleted_at && (x.name.toLowerCase() === v.toLowerCase() || x.phone === normPhone(v))); if (!m) return r.errors.push("Unknown reporting manager “" + v + "”"); v = m.id; }
        else if (f.type === "date") { const dt = looseDate(raw[f.key]); if (!dt) return r.errors.push(f.label + ": “" + v + "” is not a valid date (use DD/MM/YYYY)"); v = dt; }
        else if (f.type === "tel") v = normPhone(v);
        else if (f.type === "select") { const o = f.options.find((x) => x.toLowerCase() === v.toLowerCase()); if (o) v = o; }
        else if (f.type === "checkbox") v = /^(yes|y|true|1)$/i.test(v);
        inp[f.key] = v;
      });
      if (has(raw, "roles") && String(raw.roles || "").trim()) String(raw.roles).split(/[,;+]/).map((x) => x.trim()).filter(Boolean).forEach((n) => {
        const ro = d.roles.find((x) => x.name.toLowerCase() === n.toLowerCase() && x.status === "active");
        if (!ro) r.errors.push("Unknown role “" + n + "”"); else if (!roleGrantable(me, ro)) r.errors.push("You may not assign the role “" + ro.name + "”"); else r.role_ids.push(ro.id);
      });
      let v; try { v = validateStaff(me, d, inp, null); } catch (e) { r.errors.push(e.message); v = { errors: {}, vals: {}, custom: {} }; }
      Object.keys(v.errors).forEach((k) => r.errors.push(v.errors[k]));
      set.duplicate_keys.forEach((k) => { const val = inp[k]; if (!val) return;
        if (seen[k][val]) r.errors.push("Duplicate in this file: same " + (k === "phone" ? "phone number" : "National ID") + " as row " + seen[k][val]); else seen[k][val] = r.row;
        if (k !== "phone") { const dup = d.staff.find((x) => !x.deleted_at && x[k] && x[k] === val); if (dup) r.errors.push("Already in the system: " + dup.name + " has the same National ID"); }
      });
      r.errors = Array.from(new Set(r.errors)); r.input = inp; r.v = v; r.label = inp.name || "(no name)";
      out.push(r);
    });
    return out;
  }
  API.importCheck = read((me, d, rows) => {
    need(me, "import", "create");
    if (!Array.isArray(rows) || !rows.length) bad("The file has no data rows.");
    if (rows.length > d.settings.importer.max_rows) bad("This file has " + rows.length + " rows. The limit is " + d.settings.importer.max_rows + " per import (Import / Export Settings).");
    return clone(checkImportRows(me, d, rows).map((r) => ({ row: r.row, label: r.label, errors: r.errors, input: r.input, role_ids: r.role_ids })));
  });
  API.importCommit = write("importCommit", (me, d, job) => {
    need(me, "import", "create");
    const rows = job.rows || []; if (!rows.length) bad("The file has no data rows.");
    if (rows.length > d.settings.importer.max_rows) bad("Too many rows for one import.");
    const res = checkImportRows(me, d, rows), badRows = res.filter((r) => r.errors.length), good = res.filter((r) => !r.errors.length);
    if (badRows.length && !job.skip_invalid) bad(badRows.length + " row(s) have errors. Nothing was imported. Correct the file, or choose to import only the valid rows.");
    if (!good.length) bad("No valid rows to import.");
    const jid = DB.uid("imp"), status = d.settings.importer.default_status === "active" && can(me, "staff", "approve") ? "active" : "pending", ids = [];
    good.forEach((r) => { const s = createStaff(me, d, r.v, r.role_ids, status, { import_job: jid }); ids.push(s.id); });
    d.import_jobs.push({ id: jid, file_name: String(job.file_name || "import").slice(0, 120), at: DB.nowIso(), by: me.user.id, by_name: me.staff.name, total: rows.length, imported: good.length, failed: badRows.length,
      status: badRows.length ? "partial" : "completed", imported_as: status, mapping: job.mapping || {}, staff_ids: ids, errors: badRows.map((r) => ({ row: r.row, label: r.label, messages: r.errors })), rolled_back_at: null, rollback_note: "" });
    Core.audit(d, me.user, "IMPORT", "import", jid, "Imported " + good.length + " of " + rows.length + " rows from “" + job.file_name + "” as " + status + (badRows.length ? " — " + badRows.length + " row(s) rejected" : ""));
    return { id: jid, imported: good.length, failed: badRows.length, status };
  });
  API.importJobs = read((me, d) => { need(me, "import", "view"); return clone(d.import_jobs.slice().reverse()); });
  API.importRollback = write("importRollback", (me, d, jobId, reason) => {
    need(me, "import", "delete");
    const j = d.import_jobs.find((x) => x.id === jobId); if (!j) bad("Import not found.");
    if (j.status === "rolled_back") bad("This import was already rolled back.");
    if (!String(reason || "").trim()) bad("A reason is required.");
    const kept = [], gone = [], hubs = new Set();
    j.staff_ids.forEach((id) => {
      const s = d.staff.find((x) => x.id === id); if (!s) return;
      if (s.updated_at || s.status === "active" && j.imported_as !== "active" || d.transfers.some((t) => t.staff_id === id) || d.users.some((u) => u.staff_id === id) || d.documents.some((x) => x.staff_id === id && !x.deleted_at)) return kept.push(s.name);
      gone.push(id); hubs.add(s.hub_id);
    });
    d.staff = d.staff.filter((s) => !gone.includes(s.id)); d.staff_roles = d.staff_roles.filter((r) => !gone.includes(r.staff_id));
    d.staff_ids = d.staff_ids.filter((x) => !gone.includes(x.staff_id)); d.assignments = d.assignments.filter((a) => !gone.includes(a.staff_id));
    hubs.forEach((hid) => { const seq = d.id_sequences.find((x) => x.hub_id === hid), mx = d.staff_ids.filter((x) => x.hub_id === hid).reduce((m, x) => Math.max(m, x.number), d.settings.idpolicy.start - 1); if (seq) seq.next = mx + 1; });
    j.status = "rolled_back"; j.rolled_back_at = DB.nowIso(); j.rollback_note = reason.trim() + (kept.length ? " — kept (already approved, edited or used): " + kept.join(", ") : ""); j.rolled_back = gone.length;
    Core.audit(d, me.user, "IMPORT_ROLLBACK", "import", j.id, "Rolled back import “" + j.file_name + "”: " + gone.length + " record(s) withdrawn" + (kept.length ? ", " + kept.length + " kept" : "") + " — " + reason.trim());
    return { removed: gone.length, kept };
  });

  /* =============================== EXPORT / PRINT =============================== */
  API.logOutput = write("logOutput", (me, d, kind, what, count, template) => {
    const page = what === "transfers" ? "transfers" : what === "zonal" ? "zonal" : what === "audit" ? "audit" : what === "import" ? "import" : "staff";
    if (kind === "print") { if (!(can(me, page, "print") || can(me, "export", "print"))) deny("You are not allowed to print this."); }
    else if (!(can(me, page, "export") || (page === "staff" && can(me, "export", "export")))) deny("You are not allowed to export this.");
    Core.audit(d, me.user, kind === "print" ? "PRINT" : "EXPORT", page, null, (kind === "print" ? "Printed " : "Exported ") + count + " record(s): " + what + (template ? " — template “" + template + "”" : ""));
    return true;
  });
  API.templateSave = write("templateSave", (me, d, t) => {
    need(me, "export", "settings");
    const e = {}; if (!String(t.name || "").trim()) e.name = "Name is required.";
    if (!Array.isArray(t.columns) || !t.columns.length) bad("Choose at least one column.");
    if (!String(t.sheet_name || "").trim() || /[\\\/\?\*\[\]:]/.test(t.sheet_name) || t.sheet_name.length > 31) e.sheet_name = "1–31 characters, without \\ / ? * [ ] :";
    if (t.logo && (!/^data:image\/(png|jpeg);base64,/.test(t.logo) || t.logo.length > 140000)) e.logo = "Use a small PNG or JPG logo (under 100 KB).";
    if (Object.keys(e).length) bad("Please correct the highlighted fields.", e);
    const rec = { id: t.id || DB.uid("tpl"), name: t.name.trim(), company: String(t.company || ""), title: String(t.title || ""), logo: t.logo || "", sheet_name: t.sheet_name.trim(), date_format: ["DD/MM/YYYY", "DD-MMM-YYYY", "YYYY-MM-DD", "MM/DD/YYYY"].includes(t.date_format) ? t.date_format : "DD/MM/YYYY",
      font: ["Calibri", "Arial", "Times New Roman", "Verdana", "Nirmala UI"].includes(t.font) ? t.font : "Calibri", font_size: Math.min(16, Math.max(8, Number(t.font_size) || 11)), align: ["left", "center", "right"].includes(t.align) ? t.align : "left", header_align: ["left", "center", "right"].includes(t.header_align) ? t.header_align : "center",
      orientation: t.orientation === "portrait" ? "portrait" : "landscape", page_size: ["A4", "A3", "Letter", "Legal"].includes(t.page_size) ? t.page_size : "A4", header_text: String(t.header_text || ""), footer_text: String(t.footer_text || ""), page_numbers: !!t.page_numbers, show_generated: !!t.show_generated,
      columns: t.columns.map((c) => ({ key: String(c.key), header: String(c.header || "").slice(0, 60) })) };
    const i = d.export_templates.findIndex((x) => x.id === rec.id); if (i >= 0) d.export_templates[i] = rec; else d.export_templates.push(rec);
    Core.audit(d, me.user, i >= 0 ? "UPDATE" : "CREATE", "export_template", rec.id, "Saved export template “" + rec.name + "”");
    return rec.id;
  });
  API.templateRemove = write("templateRemove", (me, d, id) => {
    need(me, "export", "settings");
    if (d.export_templates.length <= 1) bad("At least one export template must remain.");
    const t = d.export_templates.find((x) => x.id === id); if (!t) bad("Template not found.");
    d.export_templates = d.export_templates.filter((x) => x.id !== id);
    if (d.settings.exporter.default_template === id) d.settings.exporter.default_template = d.export_templates[0].id;
    Core.audit(d, me.user, "DELETE", "export_template", id, "Deleted export template “" + t.name + "”"); return true;
  });

  /* =============================== ZONAL MANAGER ACTIVITY =============================== */
  const zoneOk = (me, zid) => me.isSuper || me.scope === "all" || (me.scope === "zone" && me.staff.zone_id === zid);
  API.zonalData = read((me, d, q) => {
    need(me, "zonal", "view"); q = q || {};
    const nm = {}; d.staff.forEach((s) => (nm[s.id] = s.name)); const un = {}; d.users.forEach((u) => (un[u.id] = nm[u.staff_id] || u.username));
    const zones = d.zones.filter((z) => zoneOk(me, z.id));
    const zid = q.zone && zones.some((z) => z.id === q.zone) ? q.zone : null;
    const inZ = (z) => (zid ? z === zid : zones.some((x) => x.id === z));
    const inD = (dt) => (!q.from || dt >= q.from) && (!q.to || dt <= q.to);
    const acts = d.zonal_activities.filter((a) => !a.deleted_at && inZ(a.zone_id) && inD(a.date) && (!q.hub || a.hub_id === q.hub)).sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((a) => Object.assign({}, a, { manager_name: nm[a.manager_id] || "", created_name: un[a.created_by] || "", updated_name: un[a.updated_by] || "", reviewed_name: un[a.reviewed_by] || "", can_edit: can(me, "zonal", "edit") && (me.isSuper || me.scope === "all" || a.created_by === me.user.id) }));
    const staff = d.staff.filter((s) => !s.deleted_at && inZ(s.zone_id) && (!q.hub || s.hub_id === q.hub));
    const managers = d.staff.filter((s) => !s.deleted_at && d.staff_roles.some((r) => r.staff_id === s.id && (d.roles.find((x) => x.id === r.role_id) || {}).scope === "zone")).filter((s) => inZ(s.zone_id)).map((s) => ({ id: s.id, name: s.name, zone_id: s.zone_id }));
    return clone({ zones, activities: acts, managers,
      staff: staff.map((s) => ({ id: s.id, name: s.name, hub_id: s.hub_id, position_id: s.position_id, status: s.status, staff_no: Core.fmtNo(d, s.staff_no), manager: nm[s.manager_id] || "" })),
      transfers: d.transfers.filter((t) => (inZ(t.from_zone) || inZ(t.to_zone)) && inD(t.effective_date) && (!q.hub || t.from_hub === q.hub || t.to_hub === q.hub)).sort((a, b) => (a.effective_date < b.effective_date ? 1 : -1)).map((t) => Object.assign({}, t, { staff_name: nm[t.staff_id] || "", approved_name: un[t.approved_by] || "" })) });
  });
  API.zonalSave = write("zonalSave", (me, d, a) => {
    const ex = a.id ? d.zonal_activities.find((x) => x.id === a.id && !x.deleted_at) : null;
    need(me, "zonal", ex ? "edit" : "create");
    if (a.id && !ex) bad("Record not found.");
    if (ex && !(me.isSuper || me.scope === "all" || ex.created_by === me.user.id)) deny("You can only edit records you created.");
    const e = {}, hub = d.hubs.find((h) => h.id === a.hub_id);
    if (!hub) e.hub_id = "Choose a hub."; else if (!zoneOk(me, hub.zone_id)) deny("That hub is outside your zone.");
    if (!validDate(a.date || "")) e.date = "Enter a date."; else if (a.date > DB.today() && a.type !== "task") e.date = "Activities and reports cannot be dated in the future.";
    if (!["activity", "report", "task"].includes(a.type)) e.type = "Choose a type.";
    if (!String(a.title || "").trim()) e.title = "Title is required.";
    const allowed = a.type === "report" ? ["pending", "submitted"] : ["pending", "completed"];
    if (!allowed.includes(a.status)) e.status = "Choose a status.";
    if (Object.keys(e).length) bad("Please correct the highlighted fields.", e);
    const mgr = d.staff.find((s) => s.id === a.manager_id && !s.deleted_at && s.zone_id === hub.zone_id) || (me.staff.zone_id === hub.zone_id ? me.staff : null);
    const vals = { zone_id: hub.zone_id, hub_id: hub.id, manager_id: mgr ? mgr.id : null, date: a.date, type: a.type, title: a.title.trim().slice(0, 140), details: String(a.details || "").trim().slice(0, 2000), status: a.status };
    if (ex) { Object.assign(ex, vals, { updated_by: me.user.id, updated_at: DB.nowIso() }); Core.audit(d, me.user, "UPDATE", "zonal_activity", ex.id, "Edited zonal record “" + ex.title + "”"); return ex.id; }
    const rec = Object.assign({ id: DB.uid("za"), created_by: me.user.id, created_at: DB.nowIso(), updated_by: null, updated_at: null, deleted_at: null }, vals);
    d.zonal_activities.push(rec); Core.audit(d, me.user, "CREATE", "zonal_activity", rec.id, "Added zonal " + rec.type + " “" + rec.title + "” for " + hub.name); return rec.id;
  });
  API.zonalStatus = write("zonalStatus", (me, d, id, status) => {
    const a = d.zonal_activities.find((x) => x.id === id && !x.deleted_at); if (!a) bad("Record not found.");
    if (status === "reviewed") { need(me, "zonal", "approve"); if (a.status === "pending") bad("Only completed or submitted records can be marked as reviewed."); a.reviewed_by = me.user.id; a.reviewed_at = DB.nowIso(); }
    else { need(me, "zonal", "edit"); if (!(me.isSuper || me.scope === "all" || a.created_by === me.user.id)) deny("You can only update records you created."); if (!zoneOk(me, a.zone_id)) deny("Outside your zone.");
      if (!(a.type === "report" ? ["pending", "submitted"] : ["pending", "completed"]).includes(status)) bad("Unknown status."); a.status = status; a.updated_by = me.user.id; a.updated_at = DB.nowIso(); }
    Core.audit(d, me.user, "STATUS", "zonal_activity", a.id, "Zonal record “" + a.title + "” marked " + status); return true;
  });
  API.zonalRemove = write("zonalRemove", (me, d, id, reason) => {
    need(me, "zonal", "delete"); const a = d.zonal_activities.find((x) => x.id === id && !x.deleted_at); if (!a) bad("Record not found.");
    if (!zoneOk(me, a.zone_id)) deny("Outside your zone."); if (!String(reason || "").trim()) bad("A reason is required.");
    a.deleted_at = DB.nowIso(); a.deleted_by = me.user.id; Core.audit(d, me.user, "REMOVE", "zonal_activity", a.id, "Removed zonal record “" + a.title + "” — " + reason.trim()); return true;
  });

  /* =============================== CONTROL CENTER =============================== */
  API.rolesFull = read((me, d) => { need(me, "roles", "view"); return clone(d.roles.map((r) => Object.assign({}, r, { members: d.staff_roles.filter((x) => x.role_id === r.id).length })).sort((a, b) => a.rank - b.rank)); });
  API.roleSave = write("roleSave", (me, d, r) => {
    const ex = r.id ? d.roles.find((x) => x.id === r.id) : null; need(me, "roles", ex ? "edit" : "create");
    if (r.id && !ex) bad("Role not found.");
    const e = {}, name = String(r.name || "").trim(), rank = Number(r.rank);
    if (!name) e.name = "Name is required."; else if (d.roles.some((x) => x.id !== r.id && x.name.toLowerCase() === name.toLowerCase())) e.name = "Another role already has this name.";
    if (!Number.isInteger(rank) || rank < 1 || rank > 99) e.rank = "Rank must be a whole number from 1 to 99.";
    else if (ex && ex.is_super ? rank !== 1 : rank < 2) e.rank = ex && ex.is_super ? "Super Admin always has rank 1." : "Rank 1 is reserved for Super Admin.";
    if (!["all", "zone", "hub", "self"].includes(r.scope)) e.scope = "Choose a data scope.";
    if (Object.keys(e).length) bad("Please correct the highlighted fields.", e);
    if (!me.isSuper && (rank <= me.rank || (ex && ex.rank <= me.rank))) deny("You can only manage roles that rank below your own.");
    if (ex && ex.is_super && (r.status === "inactive" || r.scope !== "all")) bad("The Super Admin role cannot be deactivated or limited.");
    if (ex && r.status === "inactive" && ex.status === "active" && d.staff_roles.some((x) => x.role_id === ex.id)) { /* allowed: members simply lose its permissions */ }
    const vals = { name, rank, color: ["ok", "info", "warn", "bad", "violet", "grey"].includes(r.color) ? r.color : "grey", scope: r.scope, status: r.status === "inactive" ? "inactive" : "active" };
    if (ex) { const b = { name: ex.name, rank: ex.rank, scope: ex.scope, status: ex.status }; Object.assign(ex, vals); Core.audit(d, me.user, "UPDATE", "role", ex.id, "Edited role “" + ex.name + "”", b, vals); return ex.id; }
    const rec = Object.assign({ id: DB.uid("r"), is_super: false, system: false, perms: {} }, vals);
    if (r.copy_from) { const src = d.roles.find((x) => x.id === r.copy_from); if (src && !src.is_super) Object.keys(src.perms).forEach((k) => { if (me.isSuper || me.perms.has(k)) rec.perms[k] = 1; }); }
    d.roles.push(rec); Core.audit(d, me.user, "CREATE", "role", rec.id, "Created role “" + rec.name + "” (rank " + rank + ")"); return rec.id;
  });
  API.roleSetPerms = write("roleSetPerms", (me, d, roleId, changes) => {
    need(me, "roles", "edit");
    const r = d.roles.find((x) => x.id === roleId); if (!r) bad("Role not found.");
    if (r.is_super) bad("Super Admin always holds every permission.");
    if (!me.isSuper && r.rank <= me.rank) deny("You can only manage roles that rank below your own.");
    const valid = new Set(CAT.allKeys()), on = [], off = [];
    Object.keys(changes || {}).forEach((k) => {
      if (!valid.has(k)) bad("Unknown permission: " + k);
      if (changes[k]) { if (!me.isSuper && !me.perms.has(k)) deny("You cannot grant a permission you do not hold yourself (" + k + ")."); if (!r.perms[k]) { r.perms[k] = 1; on.push(k); } }
      else if (r.perms[k]) { delete r.perms[k]; off.push(k); }
    });
    if (on.length || off.length) Core.audit(d, me.user, "PERMISSIONS", "role", r.id, "Permissions of “" + r.name + "” changed" + (on.length ? " — granted: " + on.join(", ") : "") + (off.length ? " — withdrawn: " + off.join(", ") : ""));
    return { on: on.length, off: off.length };
  });
  API.roleRemove = write("roleRemove", (me, d, id) => {
    need(me, "roles", "delete"); const r = d.roles.find((x) => x.id === id); if (!r) bad("Role not found.");
    if (r.system || r.is_super) bad("Built-in roles cannot be deleted. You can deactivate or rename them.");
    if (!me.isSuper && r.rank <= me.rank) deny("You can only manage roles that rank below your own.");
    const n = d.staff_roles.filter((x) => x.role_id === id).length; if (n) bad(n + " staff member(s) still hold this role. Remove it from them first, or deactivate the role.");
    d.roles = d.roles.filter((x) => x.id !== id); d.fields.forEach((f) => { f.view_roles = f.view_roles.filter((x) => x !== id); f.edit_roles = f.edit_roles.filter((x) => x !== id); });
    d.nav.forEach((n2) => (n2.roles = n2.roles.filter((x) => x !== id))); delete d.settings.language.role[id];
    Core.audit(d, me.user, "DELETE", "role", id, "Deleted role “" + r.name + "”", { name: r.name, rank: r.rank, perms: Object.keys(r.perms) }); return true;
  });

  API.usersList = read((me, d) => {
    need(me, "users", "view");
    return clone(d.users.map((u) => { const s = d.staff.find((x) => x.id === u.staff_id) || {}; return { id: u.id, username: u.username, staff_id: u.staff_id, name: s.name || "(deleted)", staff_status: s.status, hub_id: s.hub_id, portals: u.portals, status: u.status, last_login: u.last_login, locked: !!(u.locked_until && new Date(u.locked_until) > new Date()), roles: staffRoles(d, u.staff_id).map((r) => r.id), rank: staffRank(d, u.staff_id), must_change: !!u.must_change }; }));
  });
  API.userSave = async function (inp) {
    let salt = null, hash = null;
    if (inp.password) { pwRule(inp.password); salt = randHex(16); hash = await hashPw(inp.password, salt); }
    return write("userSave", (me, d) => {
      const ex = inp.id ? d.users.find((x) => x.id === inp.id) : null; need(me, "users", ex ? "edit" : "create");
      if (inp.id && !ex) bad("Account not found.");
      const e = {}, staffId = ex ? ex.staff_id : inp.staff_id, s = d.staff.find((x) => x.id === staffId && !x.deleted_at);
      if (!s) e.staff_id = "Choose a staff member."; else if (!ex && d.users.some((u) => u.staff_id === staffId)) e.staff_id = "This person already has a login account.";
      const uname = String(inp.username || "").trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9._-]{2,30}$/.test(uname)) e.username = "3–31 characters: letters, numbers, dot, dash or underscore."; else if (d.users.some((u) => u.username === uname && (!ex || u.id !== ex.id))) e.username = "This username is taken.";
      if (!ex && !inp.password) e.password = "Set a first password.";
      const portals = Array.from(new Set(inp.portals || [])).filter((p) => PORTALS.some((x) => x.key === p));
      if (!portals.length && inp.status !== "disabled") e.portals = "Assign at least one login portal, or disable the account.";
      if (Object.keys(e).length) bad("Please correct the highlighted fields.", e);
      const tRank = staffRank(d, staffId) || 99, tSuper = staffRoles(d, staffId).some((r) => r.is_super);
      if (!me.isSuper && (tSuper || tRank <= me.rank) ) deny("You can only manage accounts of people who rank below you.");
      if (portals.includes("super")) { if (!me.isSuper) deny("Only a Super Admin can give access to the Super Admin Portal."); if (!tSuper) bad("The Super Admin Portal is only for people who hold the Super Admin role. Assign the role first.", { portals: "Needs the Super Admin role." }); }
      const status = inp.status === "disabled" ? "disabled" : "active";
      if (ex && tSuper && (status === "disabled" || !portals.includes("super")) && superCount(d, staffId) === 0) bad("This is the last active Super Admin. Give another person Super Admin access first.");
      if (ex && ex.id === me.user.id && status === "disabled") bad("You cannot disable your own account.");
      if (ex) {
        const b = { username: ex.username, portals: ex.portals.slice(), status: ex.status };
        ex.username = uname; ex.portals = portals; ex.status = status;
        if (inp.unlock) { ex.locked_until = null; ex.failed = 0; }
        if (hash) { ex.salt = salt; ex.hash = hash; ex.must_change = !!inp.must_change; endSessions(d, staffId, "password reset"); }
        if (status === "disabled") endSessions(d, staffId, "account disabled");
        d.sessions.filter((x) => x.user_id === ex.id && !x.revoked_at && !portals.includes(x.portal)).forEach((x) => { x.revoked_at = DB.nowIso(); x.end_reason = "portal access removed"; });
        Core.audit(d, me.user, "UPDATE", "user", ex.id, "Login account “" + uname + "” updated" + (hash ? " (password reset)" : "") + (inp.unlock ? " (unlocked)" : ""), b, { username: uname, portals, status });
        return ex.id;
      }
      const u = { id: DB.uid("u"), username: uname, staff_id: staffId, portals, status, salt, hash, failed: 0, locked_until: null, last_login: null, created_at: DB.nowIso(), must_change: !!inp.must_change };
      d.users.push(u); Core.audit(d, me.user, "CREATE", "user", u.id, "Created login account “" + uname + "” for " + s.name + " — portals: " + portals.join(", ")); return u.id;
    })();
  };

  /* generic reference tables: zones, hubs, positions */
  API.orgSave = write("orgSave", (me, d, table, r) => {
    if (!["zones", "hubs", "positions"].includes(table)) bad("Unknown table.");
    const ex = r.id ? d[table].find((x) => x.id === r.id) : null; need(me, "org", ex ? "edit" : "create"); if (r.id && !ex) bad("Record not found.");
    const e = {}, name = String(r.name || "").trim(), code = String(r.code || "").trim().toUpperCase();
    if (!name) e.name = "Name is required."; else if (d[table].some((x) => x.id !== r.id && x.name.toLowerCase() === name.toLowerCase())) e.name = "This name is already used.";
    if (table !== "positions") { if (!/^[A-Z0-9]{2,6}$/.test(code)) e.code = "2–6 letters or numbers."; else if (d[table].some((x) => x.id !== r.id && x.code === code)) e.code = "This code is already used."; }
    if (table === "hubs" && !d.zones.some((z) => z.id === r.zone_id && z.status === "active")) e.zone_id = "Choose an active zone.";
    if (Object.keys(e).length) bad("Please correct the highlighted fields.", e);
    const status = r.status === "inactive" ? "inactive" : "active";
    if (ex && status === "inactive" && ex.status === "active") {
      const used = table === "hubs" ? d.staff.filter((s) => !s.deleted_at && s.hub_id === ex.id).length : table === "positions" ? d.staff.filter((s) => !s.deleted_at && s.position_id === ex.id).length : d.hubs.filter((h) => h.zone_id === ex.id && h.status === "active").length;
      if (used) bad((table === "zones" ? used + " active hub(s) are" : used + " staff member(s) are") + " still assigned here. Move them first.");
    }
    const vals = table === "positions" ? { name, status } : table === "zones" ? { name, code, status } : { name, code, status, zone_id: r.zone_id };
    const label = table === "hubs" ? "hub" : table === "zones" ? "zone" : "position";
    if (ex) {
      const zoneMoved = table === "hubs" && ex.zone_id !== r.zone_id;
      Object.assign(ex, vals);
      if (zoneMoved) d.staff.forEach((s) => { if (s.hub_id === ex.id) s.zone_id = ex.zone_id; });
      Core.audit(d, me.user, "UPDATE", label, ex.id, "Edited " + label + " “" + name + "”" + (zoneMoved ? " (moved to another zone; its staff follow)" : "")); return ex.id;
    }
    const rec = Object.assign({ id: DB.uid(table[0]) }, vals); d[table].push(rec);
    Core.audit(d, me.user, "CREATE", label, rec.id, "Created " + label + " “" + name + "”"); return rec.id;
  });
  API.orgRemove = write("orgRemove", (me, d, table, id) => {
    if (!["zones", "hubs", "positions"].includes(table)) bad("Unknown table."); need(me, "org", "delete");
    const r = d[table].find((x) => x.id === id); if (!r) bad("Record not found.");
    const everUsed = table === "hubs" ? d.staff.some((s) => s.hub_id === id) || d.staff_ids.some((x) => x.hub_id === id) || d.transfers.some((t) => t.from_hub === id || t.to_hub === id)
      : table === "positions" ? d.staff.some((s) => s.position_id === id) || d.assignments.some((a) => a.position_id === id) : d.hubs.some((h) => h.zone_id === id);
    if (everUsed) bad("“" + r.name + "” is used by staff records or history, so it cannot be deleted. Deactivate it instead.");
    d[table] = d[table].filter((x) => x.id !== id);
    Core.audit(d, me.user, "DELETE", table === "hubs" ? "hub" : table === "zones" ? "zone" : "position", id, "Deleted “" + r.name + "” (never used)"); return true;
  });

  /* profile builder */
  const FIELD_TYPES = ["text", "textarea", "number", "date", "select", "tel", "email", "checkbox"];
  API.fieldSave = write("fieldSave", (me, d, f) => {
    const ex = f.id ? d.fields.find((x) => x.id === f.id) : null; need(me, "fields", ex ? "edit" : "create"); if (f.id && !ex) bad("Field not found.");
    const e = {}, label = String(f.label || "").trim();
    if (!label) e.label = "Label is required."; else if (d.fields.some((x) => x.id !== f.id && !x.archived && x.label.toLowerCase() === label.toLowerCase())) e.label = "Another field already has this label.";
    const sec = d.sections.find((s) => s.key === f.section && s.kind === "fields"); if (!sec) e.section = "Choose a section.";
    if (!ex && !FIELD_TYPES.includes(f.type)) e.type = "Choose a field type.";
    const type = ex ? ex.type : f.type, options = type === "select" ? Array.from(new Set((Array.isArray(f.options) ? f.options : String(f.options || "").split(/\n|,/)).map((x) => String(x).trim()).filter(Boolean))) : [];
    if (type === "select" && !options.length) e.options = "Add at least one choice.";
    if (Object.keys(e).length) bad("Please correct the highlighted fields.", e);
    const rids = (a) => (Array.isArray(a) ? a.filter((x) => d.roles.some((r) => r.id === x)) : []);
    const vals = { label, label_bn: String(f.label_bn || "").trim(), section: f.section, visible: f.visible !== false, options, view_roles: rids(f.view_roles), edit_roles: rids(f.edit_roles) };
    if (ex) {
      const coreReq = ["name", "phone", "hub_id", "position_id", "joining_date"].includes(ex.key);
      vals.required = coreReq ? true : !!f.required && !VIRTUAL.includes(ex.type) && ex.type !== "photo";
      if (coreReq || VIRTUAL.includes(ex.type)) { vals.view_roles = coreReq || ex.key === "staff_no" || ex.key === "status" ? [] : vals.view_roles; vals.edit_roles = coreReq ? [] : vals.edit_roles; }
      if (ex.builtin && ["name", "staff_no", "hub_id", "status"].includes(ex.key)) vals.visible = true;
      Object.assign(ex, vals); Core.audit(d, me.user, "UPDATE", "field", ex.id, "Edited profile field “" + label + "”"); return ex.id;
    }
    let key = "c_" + label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24); if (key === "c_") key = "c_field"; let k = key, n = 2; while (d.fields.some((x) => x.key === k)) k = key + "_" + n++;
    const rec = Object.assign({ id: DB.uid("f"), key: k, type, builtin: false, required: !!f.required, archived: false, locked: false, order: d.fields.reduce((m, x) => Math.max(m, x.order), 0) + 1 }, vals);
    d.fields.push(rec); Core.audit(d, me.user, "CREATE", "field", rec.id, "Created custom field “" + label + "” (" + type + ")"); return rec.id;
  });
  API.fieldRemove = write("fieldRemove", (me, d, id) => {
    need(me, "fields", "delete"); const f = d.fields.find((x) => x.id === id); if (!f) bad("Field not found.");
    if (f.builtin) bad("Built-in fields cannot be deleted. Hide the field instead.");
    f.archived = true; f.required = false;
    d.layouts.forEach((l) => (l.columns = l.columns.filter((c) => c.key !== f.key))); d.export_templates.forEach((t) => (t.columns = t.columns.filter((c) => c.key !== f.key)));
    Core.audit(d, me.user, "DELETE", "field", id, "Deleted custom field “" + f.label + "” (values already entered are kept in the archive)"); return true;
  });
  API.sectionSave = write("sectionSave", (me, d, s) => {
    const ex = s.id ? d.sections.find((x) => x.id === s.id) : null; need(me, "fields", ex ? "edit" : "create"); if (s.id && !ex) bad("Section not found.");
    const label = String(s.label || "").trim(); if (!label) bad("Please correct the highlighted fields.", { label: "Label is required." });
    if (ex) { ex.label = label; ex.label_bn = String(s.label_bn || "").trim(); ex.visible = s.visible !== false; Core.audit(d, me.user, "UPDATE", "section", ex.id, "Edited profile section “" + label + "”"); return ex.id; }
    const rec = { id: DB.uid("sec"), key: "s_" + Date.now().toString(36), label, label_bn: String(s.label_bn || "").trim(), kind: "fields", icon: "list", order: d.sections.reduce((m, x) => Math.max(m, x.order), 0) + 1, visible: true, builtin: false };
    d.sections.push(rec); Core.audit(d, me.user, "CREATE", "section", rec.id, "Created profile section “" + label + "”"); return rec.id;
  });
  API.sectionRemove = write("sectionRemove", (me, d, id) => {
    need(me, "fields", "delete"); const s = d.sections.find((x) => x.id === id); if (!s) bad("Section not found.");
    if (s.builtin) bad("Built-in sections cannot be deleted. Hide the section instead.");
    if (d.fields.some((f) => f.section === s.key && !f.archived)) bad("Move or delete the fields in this section first.");
    d.sections = d.sections.filter((x) => x.id !== id); Core.audit(d, me.user, "DELETE", "section", id, "Deleted profile section “" + s.label + "”"); return true;
  });
  /** one endpoint for every "move up / move down" list */
  API.reorder = write("reorder", (me, d, table, ids) => {
    const page = { sections: "fields", fields: "fields", nav: "nav", widgets: "widgets", actions: "widgets" }[table]; if (!page) bad("Unknown list."); need(me, page, "edit");
    ids.forEach((id, i) => { const r = d[table].find((x) => x.id === id); if (r) r.order = i + 1; });
    Core.audit(d, me.user, "REORDER", table, null, "Changed the order of " + table); return true;
  });

  /* table layouts */
  API.layoutSave = write("layoutSave", (me, d, l) => {
    need(me, "staff", "view");
    const ex = l.id ? d.layouts.find((x) => x.id === l.id) : null, shared = ex ? ex.shared : !!l.shared;
    if (shared) need(me, "table", "edit"); else if (ex && ex.owner !== me.user.id) deny("This layout belongs to someone else.");
    const name = String(l.name || "").trim(); if (!name) bad("Please correct the highlighted fields.", { name: "Name is required." });
    const okKeys = new Set(["select", "actions"].concat(d.fields.filter((f) => !f.archived).map((f) => f.key))), seen = new Set();
    const cols = (l.columns || []).filter((c) => okKeys.has(c.key) && !seen.has(c.key) && seen.add(c.key)).map((c) => ({ key: c.key, label: String(c.label || "").trim().slice(0, 40), visible: c.visible !== false }));
    if (!cols.some((c) => c.visible && c.key !== "select" && c.key !== "actions")) bad("Keep at least one visible column.");
    if (ex) { ex.name = name; ex.columns = cols; Core.audit(d, me.user, "UPDATE", "layout", ex.id, "Saved table layout “" + name + "”"); return ex.id; }
    const rec = { id: DB.uid("lay"), name, shared, owner: shared ? null : me.user.id, columns: cols }; d.layouts.push(rec);
    Core.audit(d, me.user, "CREATE", "layout", rec.id, "Created " + (shared ? "shared" : "personal") + " table layout “" + name + "”"); return rec.id;
  });
  API.layoutRemove = write("layoutRemove", (me, d, id) => {
    const l = d.layouts.find((x) => x.id === id); if (!l) bad("Layout not found.");
    if (l.shared) need(me, "table", "edit"); else if (l.owner !== me.user.id) deny("This layout belongs to someone else.");
    if (d.settings.staff.default_layout === id) bad("This is the default layout. Choose another default first.");
    d.layouts = d.layouts.filter((x) => x.id !== id); Core.audit(d, me.user, "DELETE", "layout", id, "Deleted table layout “" + l.name + "”"); return true;
  });

  /* sidebar, pages, widgets, action buttons */
  API.navSave = write("navSave", (me, d, n) => {
    const ex = n.id ? d.nav.find((x) => x.id === n.id) : null; need(me, "nav", ex ? "edit" : "create"); if (n.id && !ex) bad("Menu item not found.");
    const e = {}, label = String(n.label || "").trim(), type = ex ? ex.type : n.type;
    if (!label) e.label = "Label is required.";
    if (!["group", "page", "link"].includes(type)) e.type = "Choose a type.";
    if (type === "page" && !CAT.pages[n.page]) e.page = "Choose a page.";
    if (type === "link" && !/^https:\/\/[^\s]+$/.test(String(n.url || ""))) e.url = "Enter a full https:// address.";
    const parent = type === "group" ? null : d.nav.find((x) => x.id === n.parent && x.id !== n.id && (x.type === "group" || (x.type !== "group" && d.nav.some((g) => g.id === x.parent && g.type === "group"))));
    if (type !== "group" && !parent) e.parent = "Choose where this item sits.";
    if (Object.keys(e).length) bad("Please correct the highlighted fields.", e);
    const vals = { label, label_bn: String(n.label_bn || "").trim(), icon: String(n.icon || ""), page: type === "page" ? n.page : "", url: type === "link" ? n.url : "", parent: parent ? parent.id : null, visible: n.visible !== false, roles: (n.roles || []).filter((x) => d.roles.some((r) => r.id === x)) };
    if (ex) { Object.assign(ex, vals); Core.audit(d, me.user, "UPDATE", "nav", ex.id, "Edited menu item “" + label + "”"); return ex.id; }
    const rec = Object.assign({ id: DB.uid("nav"), type, order: d.nav.reduce((m, x) => Math.max(m, x.order), 0) + 1, builtin: false }, vals); d.nav.push(rec);
    Core.audit(d, me.user, "CREATE", "nav", rec.id, "Added menu item “" + label + "”"); return rec.id;
  });
  API.navRemove = write("navRemove", (me, d, id) => {
    need(me, "nav", "delete"); const n = d.nav.find((x) => x.id === id); if (!n) bad("Menu item not found.");
    if (n.builtin) bad("Built-in menu items cannot be deleted. Hide the item instead.");
    if (d.nav.some((x) => x.parent === id)) bad("Move or delete the items inside it first.");
    d.nav = d.nav.filter((x) => x.id !== id); Core.audit(d, me.user, "DELETE", "nav", id, "Deleted menu item “" + n.label + "”"); return true;
  });
  API.pageSave = write("pageSave", (me, d, key, cfg) => {
    need(me, "nav", "edit"); if (!CAT.pages[key]) bad("Unknown page.");
    const portals = (cfg.portals || []).filter((p) => PORTALS.some((x) => x.key === p)), enabled = cfg.enabled !== false;
    if (["nav", "roles", "users"].includes(key) && (!enabled || !portals.includes("super"))) bad("This page must stay available in the Super Admin Portal, otherwise nobody could switch it back on.");
    d.pages[key] = { enabled, portals }; Core.audit(d, me.user, "CONFIGURE", "page", key, "Page “" + CAT.pages[key].label + "”: " + (enabled ? "enabled" : "disabled") + ", portals: " + (portals.join(", ") || "none")); return true;
  });
  API.widgetSave = write("widgetSave", (me, d, table, r) => {
    need(me, "widgets", "edit"); if (!["widgets", "actions"].includes(table)) bad("Unknown list.");
    const ex = d[table].find((x) => x.id === r.id); if (!ex) bad("Item not found.");
    const label = String(r.label || "").trim(); if (!label) bad("Label is required.");
    ex.label = label; ex.visible = r.visible !== false; if (r.icon && SF.UI.ICONS.includes(r.icon)) ex.icon = r.icon;
    if (table === "widgets") { ex.label_bn = String(r.label_bn || "").trim(); ex.roles = (r.roles || []).filter((x) => d.roles.some((y) => y.id === x)); } else ex.inline = !!r.inline;
    Core.audit(d, me.user, "CONFIGURE", table === "widgets" ? "widget" : "action", ex.id, (table === "widgets" ? "Dashboard widget “" : "Action button “") + label + "” updated"); return true;
  });

  /* settings groups */
  API.settingsGet = read((me, d, group) => {
    const page = { language: "language", idpolicy: "idpolicy", importer: "impexp", exporter: "impexp", security: "system", company: "system", staff: "system" }[group]; if (!page) bad("Unknown settings group."); need(me, page, "view");
    const out = clone(d.settings[group]);
    if (group === "idpolicy") out.hubs = d.hubs.map((h) => { const recs = d.staff_ids.filter((x) => x.hub_id === h.id); return { hub_id: h.id, issued: recs.length, in_use: recs.filter((x) => !x.released_at).length, highest: recs.reduce((m, x) => Math.max(m, x.number), 0), next: Math.max((d.id_sequences.find((s) => s.hub_id === h.id) || { next: d.settings.idpolicy.start }).next, d.settings.idpolicy.start) }; });
    return out;
  });
  API.settingsSet = write("settingsSet", (me, d, group, v) => {
    const page = { language: "language", idpolicy: "idpolicy", importer: "impexp", exporter: "impexp", security: "system", company: "system", staff: "system" }[group]; if (!page) bad("Unknown settings group."); need(me, page, "edit");
    const cur = d.settings[group], before = clone(cur), int = (x, lo, hi, name) => { const n = Number(x); if (!Number.isInteger(n) || n < lo || n > hi) bad(name + " must be a whole number from " + lo + " to " + hi + "."); return n; };
    const langOk = (x) => ["en", "bn"].includes(x);
    if (group === "idpolicy") {
      const start = int(v.start, 1, 100000, "Starting number");
      Object.assign(cur, { start, min_digits: int(v.min_digits, 1, 8, "Minimum digits"), reuse_released: !!v.reuse_released, restore_on_return: !!v.restore_on_return });
    } else if (group === "language") {
      if (!langOk(v.default)) bad("Choose the default language.");
      const clean = (m, list) => { const o = {}; Object.keys(m || {}).forEach((k) => { if (langOk(m[k]) && list.some((x) => (x.id || x.key) === k)) o[k] = m[k]; }); return o; };
      Object.assign(cur, { default: v.default, portal: clean(v.portal, PORTALS), role: clean(v.role, d.roles), position: clean(v.position, d.positions) });
    } else if (group === "security") {
      Object.assign(cur, { max_failed: int(v.max_failed, 3, 20, "Failed attempts"), lock_minutes: int(v.lock_minutes, 1, 1440, "Lock time"), idle_minutes: int(v.idle_minutes, 5, 720, "Idle time"), session_hours: int(v.session_hours, 1, 24, "Session length"), show_login_hints: !!v.show_login_hints });
    } else if (group === "company") {
      if (!String(v.name || "").trim()) bad("Company name is required.");
      Object.assign(cur, { name: v.name.trim().slice(0, 80), short: String(v.short || "SF").trim().slice(0, 3).toUpperCase() || "SF", product: String(v.product || "").trim().slice(0, 40), address: String(v.address || "").trim().slice(0, 160) });
    } else if (group === "staff") {
      if (v.default_layout && !d.layouts.some((l) => l.id === v.default_layout && l.shared)) bad("Choose a shared layout as the default.");
      Object.assign(cur, { new_requires_approval: !!v.new_requires_approval, allow_permanent_delete: !!v.allow_permanent_delete, page_size: int(v.page_size, 5, 200, "Rows per page"), default_layout: v.default_layout || cur.default_layout });
    } else if (group === "importer") {
      Object.assign(cur, { duplicate_keys: ["phone"].concat(v.check_nid ? ["nid"] : []), max_rows: int(v.max_rows, 1, 5000, "Maximum rows"), default_status: v.default_status === "active" ? "active" : "pending", skip_blank_rows: true });
    } else if (group === "exporter") {
      if (!d.export_templates.some((t) => t.id === v.default_template)) bad("Choose an existing template.");
      Object.assign(cur, { default_template: v.default_template, file_prefix: String(v.file_prefix || "staff").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20) || "staff" });
    }
    Core.audit(d, me.user, "CONFIGURE", "settings", group, "Changed settings: " + group, before, clone(cur)); return true;
  });

  /* =============================== SECURITY & AUDIT =============================== */
  API.auditList = read((me, d, q) => {
    need(me, "audit", "view"); q = q || {}; const t = String(q.search || "").toLowerCase();
    return clone(d.audit_logs.filter((a) => (!q.action || a.action === q.action) && (!q.from || a.at.slice(0, 10) >= q.from) && (!q.to || a.at.slice(0, 10) <= q.to) && (!q.user || a.user_name === q.user) && (!t || (a.summary + " " + a.user_name + " " + a.action + " " + a.entity).toLowerCase().includes(t))).reverse());
  });
  API.loginData = read((me, d) => {
    need(me, "logins", "view"); const un = {}; d.users.forEach((u) => (un[u.id] = u.username));
    return clone({ history: d.login_history.slice().reverse(), sessions: d.sessions.slice().reverse().map((s) => ({ id: s.id.slice(0, 8), key: s.id === sessionStorage.getItem(SKEY) ? "current" : s.id, username: un[s.user_id] || "?", portal: s.portal, created_at: s.created_at, last_seen: s.last_seen, expires_at: s.expires_at, revoked_at: s.revoked_at, end_reason: s.end_reason, active: !s.revoked_at && new Date(s.expires_at) > new Date(), ua: s.ua })) });
  });
  API.sessionRevoke = write("sessionRevoke", (me, d, key) => {
    need(me, "logins", "edit"); const s = d.sessions.find((x) => x.id === key); if (!s) bad("Session not found."); if (s.revoked_at) bad("This session has already ended.");
    s.revoked_at = DB.nowIso(); s.end_reason = "ended by " + me.user.username; const u = d.users.find((x) => x.id === s.user_id);
    Core.audit(d, me.user, "SESSION_END", "session", null, "Ended a session of “" + (u ? u.username : "?") + "”"); return true;
  });
  API.backupExport = write("backupExport", (me, d) => { need(me, "backup", "export"); Core.audit(d, me.user, "BACKUP", "system", null, "Downloaded a full backup file"); return JSON.stringify(d); });
  API.backupRestore = write("backupRestore", (me, d, json) => {
    need(me, "backup", "settings"); let o; try { o = JSON.parse(json); } catch (e) { bad("This is not a valid backup file."); }
    const tables = ["settings", "zones", "hubs", "positions", "roles", "staff", "staff_roles", "users", "staff_ids", "id_sequences", "assignments", "transfers", "audit_logs", "sections", "fields", "layouts", "nav", "pages", "widgets", "actions", "export_templates"];
    if (!o || !o.meta || tables.some((t) => o[t] === undefined)) bad("This file is not a backup made by this system.");
    if (!o.users.some((u) => u.status === "active" && u.portals.includes("super") && u.hash)) bad("The backup has no active Super Admin account, so it was not restored.");
    ["documents", "import_jobs", "zonal_activities", "login_history"].forEach((t) => { if (!Array.isArray(o[t])) o[t] = []; });
    o.sessions = []; Object.keys(d).forEach((k) => delete d[k]); Object.assign(d, o);
    Core.audit(d, me.user, "RESTORE", "system", null, "Database restored from a backup file (" + o.staff.length + " staff). All sessions were ended."); return true;
  });
  API.resetDemo = function () { const me = ctx(); need(me, "backup", "settings"); sessionStorage.removeItem(SKEY); DB.wipe(); return true; };

  API.can = (page, action) => { try { return can(ctx(), page, action); } catch (e) { return false; } };
  API.FIELD_TYPES = FIELD_TYPES;
  SF.API = API;
})();
