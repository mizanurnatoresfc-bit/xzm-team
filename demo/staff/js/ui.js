/* UI helpers: icons, escaping, modal / drawer / menu / toast / confirm, form builder. No business rules here. */
(function () {
  "use strict";
  const SF = (window.SF = window.SF || {});

  const P = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17.5 14.5c2.1.3 3.6 1.9 4.2 4.5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.2 4.2-6.5 8-6.5s7 2.3 8 6.5"/>',
    userplus: '<circle cx="10" cy="8" r="4"/><path d="M2.5 21c.9-4.2 3.9-6.5 7.5-6.5 1.6 0 3 .4 4.200 1.200"/><path d="M19 14v6M16 17h6"/>',
    usercheck: '<circle cx="10" cy="8" r="4"/><path d="M2.5 21c.9-4.2 3.9-6.5 7.5-6.5 1.600 0 3 .4 4.200 1.200"/><path d="m15.500 17.500 2.200 2.200 4-4.200"/>',
    userx: '<circle cx="10" cy="8" r="4"/><path d="M2.5 21c.9-4.2 3.9-6.5 7.5-6.5 1.600 0 3 .4 4.200 1.200"/><path d="m16.500 15.500 5 5M21.500 15.500l-5 5"/>',
    transfer: '<path d="M4 8h14l-3.500-3.500M20 16H6l3.500 3.500"/>',
    upload: '<path d="M12 16V4M7.500 8.500 12 4l4.500 4.500"/><path d="M4 16v3a1.500 1.500 0 0 0 1.500 1.500h13A1.500 1.500 0 0 0 20 19v-3"/>',
    download: '<path d="M12 4v12M7.500 11.500 12 16l4.500-4.500"/><path d="M4 16v3a1.500 1.500 0 0 0 1.500 1.500h13A1.500 1.500 0 0 0 20 19v-3"/>',
    printer: '<path d="M7 8V3.500h10V8"/><rect x="3" y="8" width="18" height="9" rx="2"/><rect x="7" y="14" width="10" height="6.500" rx="1"/>',
    sheet: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 9v12"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    activity: '<path d="M3 12h4l2.500-7 5 14 2.500-7h4"/>',
    shield: '<path d="M12 2.500 4.500 5.500v6c0 4.700 3.200 8.300 7.500 10 4.300-1.700 7.500-5.300 7.500-10v-6z"/><path d="m9 12 2.200 2.200 4-4.200"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3M14 9l2 2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.500v3M12 18.500v3M2.500 12h3M18.500 12h3M5.300 5.300l2.100 2.100M16.600 16.600l2.100 2.100M5.300 18.700l2.100-2.100M16.600 7.400l2.100-2.100"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
    layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4.500 6h.010M4.500 12h.010M4.500 18h.010"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.800 3 2.800 15 0 18M12 3c-2.800 3-2.800 15 0 18"/>',
    hash: '<path d="M5 9h15M4 15h15M10 4 8 20M16 4l-2 16"/>',
    building: '<rect x="4" y="3" width="11" height="18" rx="1.500"/><path d="M15 9h5v12h-5M8 7.500h3M8 11.500h3M8 15.500h3"/>',
    map: '<path d="M12 21s7-6.200 7-11.500a7 7 0 0 0-14 0C5 14.800 12 21 12 21z"/><circle cx="12" cy="9.500" r="2.500"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V4.500h6V7M3 13h18"/>',
    eye: '<path d="M2 12s3.600-7 10-7 10 7 10 7-3.600 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    edit: '<path d="M4 20h4L19.500 8.500l-4-4L4 16z"/><path d="m13.500 6.500 4 4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6.500 7l1 13.500h9l1-13.500M10 11v6M14 11v6"/>',
    check: '<path d="m5 12.500 4.500 4.500L19 7.500"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.800-3.800"/>',
    filter: '<path d="M3 5h18l-7 8.500V20l-4-2v-4.500z"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    left: '<path d="m15 6-6 6 6 6"/>',
    right: '<path d="m9 6 6 6-6 6"/>',
    more: '<circle cx="12" cy="5" r="1.300"/><circle cx="12" cy="12" r="1.300"/><circle cx="12" cy="19" r="1.300"/>',
    logout: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
    calendar: '<rect x="3.500" y="5" width="17" height="15.500" rx="2"/><path d="M3.500 10h17M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.500 2"/>',
    alert: '<path d="M12 3.500 2.500 20h19z"/><path d="M12 10v4.500M12 17.300v.010"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.500v.010"/>',
    undo: '<path d="M8 5 4 9l4 4"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    power: '<path d="M12 3v9"/><path d="M6.500 6.500a8 8 0 1 0 11 0"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="m5.700 5.700 12.600 12.600"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.500A1.500 1.500 0 0 0 14.500 4h-9A1.500 1.500 0 0 0 4 5.500v9A1.500 1.500 0 0 0 5.500 16H8"/>',
    save: '<path d="M5 3h11l4 4v14H5z"/><path d="M8 3v6h7V3M8 21v-7h8v7"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m4 18 5.500-5 4 3.500 3-2.500 4 4"/>',
    phone: '<path d="M5 3.500h4l1.500 5-2.500 1.500a12 12 0 0 0 6 6l1.500-2.500 5 1.500v4a1.500 1.500 0 0 1-1.500 1.500C10.500 20.500 3.500 13.500 3.500 5A1.500 1.500 0 0 1 5 3.500z"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5M3 17.500l9 5 9-5"/>',
    star: '<path d="m12 3 2.700 5.600 6.100.800-4.500 4.300 1.100 6.100L12 16.900 6.600 19.800l1.100-6.100L3.200 9.400l6.100-.800z"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.500-4M4 4v4h4M4 13a8 8 0 0 0 14.500 4M20 20v-4h-4"/>',
    database: '<ellipse cx="12" cy="5.500" rx="8" ry="3"/><path d="M4 5.500v13c0 1.700 3.600 3 8 3s8-1.300 8-3v-13M4 12c0 1.700 3.600 3 8 3s8-1.300 8-3"/>',
    history: '<path d="M4 12a8 8 0 1 0 2.500-5.800M4 4v4.500h4.500"/><path d="M12 8v4.500l3 1.800"/>',
    tasks: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="m3.500 6 1.500 1.500L7.500 5M3.500 12 5 13.500 7.500 11M3.500 18 5 19.500 7.500 17"/>',
    report: '<path d="M4 20V4M4 20h16"/><rect x="7" y="11" width="3" height="6"/><rect x="12" y="7" width="3" height="10"/><rect x="17" y="13" width="3" height="4"/>',
    idcard: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.500" cy="11" r="2"/><path d="M5.500 16c.5-1.500 1.600-2.200 3-2.200s2.500.700 3 2.200M14 10h4.500M14 13.500h4.500"/>',
    language: '<path d="M4 6h9M8.500 4v2M6 6c.5 3 2.500 5.500 5.500 7M11.500 6c-.5 3-2.500 5.500-6.500 7.500"/><path d="m12.500 20 3.700-9 3.800 9M13.800 17h4.900"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M5.500 8h1M5.500 11.500h1"/>',
    widget: '<rect x="3" y="3" width="8" height="8" rx="1.500"/><rect x="13" y="3" width="8" height="5" rx="1.500"/><rect x="13" y="10" width="8" height="11" rx="1.500"/><rect x="3" y="13" width="8" height="8" rx="1.500"/>',
    click: '<path d="m9 9 5 12 1.800-5.200L21 14z"/><path d="M7.200 2.200 8 5M5 8 2.200 7.200M14 4l-2 2.200M4 14l2.200-2"/>',
    home: '<path d="m3 11 9-7.500 9 7.500"/><path d="M5.500 9.500V20h13V9.500"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1"/><path d="M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1"/>',
    send: '<path d="m3 11.500 18-8-7 18-2.500-7.500z"/>',
    box: '<path d="m12 3 8.500 4.500v9L12 21l-8.500-4.500v-9z"/><path d="M3.500 7.500 12 12l8.500-4.500M12 12v9"/>'
  };
  const icon = (n, cls) => `<svg class="ic${cls ? " " + cls : ""}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || P.file}</svg>`;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const initials = (name) => String(name || "?").replace(/\(.*?\)/g, "").trim().split(/\s+/).filter((w) => /[A-Za-zঀ-৿]/.test(w[0] || "")).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
  const avatar = (name, photo, cls) => photo ? `<img class="avatar ${cls || ""}" src="${esc(photo)}" alt="">` : `<span class="avatar ${cls || ""}">${esc(initials(name))}</span>`;

  /* ---- event delegation: data-act (click), data-on (input/change) ---- */
  function delegate(root, map) {
    root.addEventListener("click", (e) => {
      const t = e.target.closest("[data-act]");
      if (!t || !root.contains(t)) return;
      const fn = map[t.dataset.act];
      if (fn) { if (t.tagName === "A" || t.tagName === "BUTTON") e.preventDefault(); fn(t, e); }
    });
    const h = (e) => { const t = e.target.closest("[data-on]"); if (t && root.contains(t) && map[t.dataset.on]) map[t.dataset.on](t, e); };
    root.addEventListener("input", (e) => { if (e.target.matches("input[type=text],input[type=search],input:not([type]),textarea")) h(e); });
    root.addEventListener("change", (e) => { if (!e.target.matches("input[type=text],input[type=search],input:not([type]),textarea")) h(e); });
  }

  /* ---- toast ---- */
  function toast(msg, kind) {
    let box = document.querySelector(".toasts");
    if (!box) { box = el('<div class="toasts" role="status" aria-live="polite"></div>'); document.body.appendChild(box); }
    const t = el(`<div class="toast ${kind || ""}">${icon(kind === "err" ? "alert" : kind === "warn" ? "info" : "check")}<span>${esc(msg)}</span></div>`);
    box.appendChild(t);
    setTimeout(() => t.remove(), kind === "err" ? 6500 : 3800);
  }

  /* ---- modal / drawer ---- */
  const stack = [];
  function modal(o) {
    const ov = el(`<div class="overlay ${o.drawer ? "drawer" : ""}"><div class="modal ${o.size || ""}" role="dialog" aria-modal="true" aria-label="${esc(o.title)}">
      <div class="modal-h"><h2>${o.icon ? icon(o.icon) + " " : ""}${esc(o.title)}</h2><button class="iconbtn plain" data-close aria-label="Close">${icon("x")}</button></div>
      <div class="modal-b"></div>${o.footer === false ? "" : '<div class="modal-f"></div>'}</div></div>`);
    const body = ov.querySelector(".modal-b"), foot = ov.querySelector(".modal-f");
    if (typeof o.body === "string") body.innerHTML = o.body; else if (o.body) body.appendChild(o.body);
    const api = { el: ov, body, foot, close(v) { ov.remove(); const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1); if (o.onClose) o.onClose(v); }, busy(b) { foot && foot.querySelectorAll("button").forEach((x) => (x.disabled = !!b)); } };
    (o.actions || []).forEach((a) => {
      const b = el(`<button class="btn ${a.cls || ""}">${a.icon ? icon(a.icon) : ""}${esc(a.label)}</button>`);
      b.addEventListener("click", async () => {
        if (!a.run) return api.close();
        try { api.busy(true); const r = await a.run(api); if (r !== false) api.close(r); } catch (e) { toast(e.message || String(e), "err"); } finally { api.busy(false); }
      });
      foot.appendChild(b);
    });
    ov.addEventListener("mousedown", (e) => { if (e.target === ov && !o.sticky) api.close(); });
    ov.querySelector("[data-close]").addEventListener("click", () => api.close());
    document.body.appendChild(ov); stack.push(api);
    if (o.mount) o.mount(api);
    const f = body.querySelector("input:not([type=hidden]),select,textarea"); if (f && !o.noFocus) setTimeout(() => f.focus(), 30);
    return api;
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeMenu(); if (stack.length) stack[stack.length - 1].close(); } });

  /** confirm dialog; with {reason:true} asks for a mandatory reason. Resolves to false or {reason}. */
  function confirm(o) {
    return new Promise((res) => {
      let done = false;
      modal({
        title: o.title, icon: o.danger ? "alert" : "info", size: "narrow", sticky: true,
        body: `<p>${esc(o.text || "")}</p>${o.detail ? `<div class="note ${o.danger ? "warn" : ""}">${icon("info")}<span>${esc(o.detail)}</span></div>` : ""}
          ${o.reason ? `<div class="field"><label>${esc(o.reasonLabel || "Reason")} <span class="req">*</span></label><textarea id="cfReason" placeholder="Required — recorded in the audit log"></textarea><span class="err hidden" id="cfErr">A reason is required.</span></div>` : ""}`,
        actions: [{ label: "Cancel" }, {
          label: o.ok || "Confirm", cls: o.danger ? "danger solid" : "primary", run(m) {
            let reason = "";
            if (o.reason) { reason = m.body.querySelector("#cfReason").value.trim(); if (!reason) { m.body.querySelector("#cfErr").classList.remove("hidden"); return false; } }
            done = true; res({ reason }); return true;
          }
        }],
        onClose() { if (!done) res(false); }
      });
    });
  }

  /* ---- popup menu ---- */
  let openMenu = null;
  function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }
  function menu(anchor, items) {
    closeMenu();
    const m = el('<div class="menu" role="menu"></div>');
    items.filter(Boolean).forEach((it) => {
      if (it === "-") return m.appendChild(el("<hr>"));
      if (it.head) return m.appendChild(el(`<div class="mh">${esc(it.head)}</div>`));
      const b = el(`<button role="menuitem" class="${it.danger ? "danger" : ""}">${it.icon ? icon(it.icon) : ""}<span>${esc(it.label)}</span></button>`);
      b.addEventListener("click", () => { closeMenu(); it.run(); });
      m.appendChild(b);
    });
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
    let x = Math.min(r.right - w, window.innerWidth - w - 8); if (x < 8) x = 8;
    let y = r.bottom + 4; if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 4);
    m.style.left = x + "px"; m.style.top = y + "px";
    openMenu = m;
  }
  document.addEventListener("mousedown", (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); });
  window.addEventListener("scroll", closeMenu, true);

  /* ---- form builder ----
     def: {key,label,type,options:[{v,l}],required,hint,span,disabled,placeholder}
     types: text tel email number date month select multi textarea checkbox photo */
  function control(d, val) {
    const a = `name="${esc(d.key)}" ${d.required ? "required" : ""} ${d.disabled ? "disabled" : ""}`;
    const v = val == null ? "" : val;
    switch (d.type) {
      case "select": return `<select ${a}><option value="">${esc(d.placeholder || "— Select —")}</option>${(d.options || []).map((o) => `<option value="${esc(o.v)}" ${String(o.v) === String(v) ? "selected" : ""}>${esc(o.l)}</option>`).join("")}</select>`;
      case "multi": { const set = new Set((Array.isArray(v) ? v : []).map(String)); return `<select multiple ${a}>${(d.options || []).map((o) => `<option value="${esc(o.v)}" ${set.has(String(o.v)) ? "selected" : ""}>${esc(o.l)}</option>`).join("")}</select>`; }
      case "textarea": return `<textarea ${a} placeholder="${esc(d.placeholder || "")}">${esc(v)}</textarea>`;
      case "checkbox": return `<label class="check"><input type="checkbox" ${a} ${v ? "checked" : ""}> <span>${esc(d.checkLabel || "Yes")}</span></label>`;
      case "photo": return `<div class="row"><span data-photo-prev>${avatar("", v || "", "")}</span><input type="file" accept="image/png,image/jpeg" data-photo="${esc(d.key)}" ${d.disabled ? "disabled" : ""}><input type="hidden" name="${esc(d.key)}" value="${esc(v)}">${v ? '<button type="button" class="btn sm" data-photo-clear>Remove</button>' : ""}</div>`;
      default: return `<input type="${d.type === "number" ? "number" : d.type === "date" ? "date" : d.type === "month" ? "month" : d.type === "email" ? "email" : d.type === "tel" ? "tel" : d.type === "password" ? "password" : "text"}" ${a} value="${esc(v)}" placeholder="${esc(d.placeholder || "")}" ${d.type === "password" ? 'autocomplete="new-password"' : ""}>`;
    }
  }
  const field = (d, val) => `<div class="field ${d.span ? "span2" : ""}" data-f="${esc(d.key)}"><label>${esc(d.label)}${d.required ? ' <span class="req">*</span>' : ""}</label>${control(d, val)}${d.hint ? `<span class="hint">${esc(d.hint)}</span>` : ""}<span class="err hidden"></span></div>`;
  const form = (defs, vals, cols) => `<form class="grid ${cols || "g2"}" novalidate>${defs.map((d) => field(d, (vals || {})[d.key])).join("")}</form>`;

  function readForm(root, defs) {
    const out = {};
    defs.forEach((d) => {
      const n = root.querySelector(`[name="${CSS.escape(d.key)}"]`); if (!n) return;
      if (d.type === "checkbox") out[d.key] = n.checked;
      else if (d.type === "multi") out[d.key] = Array.from(n.selectedOptions).map((o) => o.value);
      else if (d.type === "number") out[d.key] = n.value === "" ? null : Number(n.value);
      else out[d.key] = n.value.trim();
    });
    return out;
  }
  /** show server/field validation errors; returns true when there are none */
  function showErrors(root, errors) {
    root.querySelectorAll(".field").forEach((f) => { f.classList.remove("invalid"); const e = f.querySelector(".err"); if (e) e.classList.add("hidden"); });
    let first = null;
    Object.keys(errors || {}).forEach((k) => {
      const f = root.querySelector(`.field[data-f="${CSS.escape(k)}"]`); if (!f) return;
      f.classList.add("invalid"); const e = f.querySelector(".err"); e.textContent = errors[k]; e.classList.remove("hidden"); first = first || f;
    });
    if (first) first.scrollIntoView({ block: "center", behavior: "smooth" });
    return !first;
  }
  /** photo inputs: resize to 160px JPEG so the demo database stays small */
  function wirePhotos(root) {
    root.querySelectorAll("[data-photo]").forEach((inp) => {
      inp.addEventListener("change", () => {
        const f = inp.files[0]; if (!f) return;
        if (!/^image\/(png|jpeg)$/.test(f.type)) return toast("Only PNG or JPG pictures are accepted.", "err");
        const rd = new FileReader();
        rd.onload = () => { const img = new Image(); img.onload = () => {
          const s = 160 / Math.max(img.width, img.height), c = document.createElement("canvas");
          c.width = Math.round(img.width * Math.min(1, s)); c.height = Math.round(img.height * Math.min(1, s));
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          const url = c.toDataURL("image/jpeg", 0.82);
          inp.parentElement.querySelector(`input[type=hidden]`).value = url;
          inp.parentElement.querySelector("[data-photo-prev]").innerHTML = avatar("", url);
        }; img.src = rd.result; };
        rd.readAsDataURL(f);
      });
    });
    root.querySelectorAll("[data-photo-clear]").forEach((b) => b.addEventListener("click", () => { b.parentElement.querySelector("input[type=hidden]").value = ""; b.parentElement.querySelector("[data-photo-prev]").innerHTML = avatar("", ""); b.remove(); }));
  }

  const state = (kind, title, text) => `<div class="state ${kind === "error" ? "err" : ""}">${kind === "loading" ? '<div class="spinner"></div>' : icon(kind === "error" ? "alert" : "box")}<b>${esc(title)}</b>${text ? `<span class="small">${esc(text)}</span>` : ""}</div>`;
  const sw = (attrs, on, dis) => `<label class="switch"><input type="checkbox" ${attrs} ${on ? "checked" : ""} ${dis ? "disabled" : ""}><i></i></label>`;
  const opt = (list, v, l) => list.map((x) => ({ v: x[v || "id"], l: x[l || "name"] }));

  function download(name, blob) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  SF.UI = { icon, esc, el, initials, avatar, delegate, toast, modal, confirm, menu, closeMenu, control, field, form, readForm, showErrors, wirePhotos, state, sw, opt, download, ICONS: Object.keys(P) };
})();
