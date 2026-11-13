/* Fictional demo data. Every person, phone number and ID below is invented.
   Demo sign-in details are listed in demo/staff/DEMO_ACCOUNTS.md (local demo only). */
(function () {
  "use strict";
  const SF = window.SF, { uid, dstr, nowIso } = SF.DB, Core = SF.Core, CAT = SF.CATALOG;

  SF.DEMO_PASSWORD = "Hub#Demo2026"; // demo accounts only — never reuse for anything real
  SF.DEMO_USERS = [
    ["superadmin", "Super Admin", ["super", "admin"]], ["admin", "Admin", ["admin"]], ["hr.nusrat", "HR Manager", ["admin"]],
    ["auditor", "Auditor (read only)", ["admin"]], ["zm.rajshahi", "Zonal Manager — Rajshahi", ["staff"]],
    ["hm.natore", "Hub Manager — Natore", ["staff"]], ["rider.natore", "Rider (own profile, Bangla)", ["staff"]]
  ];

  function perms(spec) {
    const o = {};
    Object.keys(spec).forEach((page) => {
      const pg = CAT.pages[page]; o["mod:" + pg.module] = 1;
      (spec[page] === "*" ? pg.acts : ["access"].concat(spec[page])).forEach((a) => { if (pg.acts.includes(a)) o[page + ":" + a] = 1; });
    });
    return o;
  }

  SF.seed = function () {
    let seedN = 20261112;
    const rnd = () => { seedN |= 0; seedN = (seedN + 0x6d2b79f5) | 0; let t = Math.imul(seedN ^ (seedN >>> 15), 1 | seedN); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const now = new Date();
    const ago = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return dstr(d); };
    const agoIso = (n, h) => { const d = new Date(now); d.setDate(d.getDate() - n); d.setHours(h || 10, Math.floor(rnd() * 59), 0, 0); return d.toISOString(); };

    const d = {
      meta: { version: 1, seeded_at: nowIso() },
      settings: {
        company: { name: "Steadfast Hubwise Management", short: "SF", product: "Hubwise ERP", address: "Head Office, Dhaka (demo address)" },
        idpolicy: { start: 1, min_digits: 1, reuse_released: false, restore_on_return: true },
        security: { max_failed: 5, lock_minutes: 15, idle_minutes: 30, session_hours: 8, show_login_hints: true },
        language: { default: "en", portal: {}, role: { r_rider: "bn" }, position: {} },
        importer: { duplicate_keys: ["phone", "nid"], max_rows: 1000, default_status: "pending", skip_blank_rows: true },
        exporter: { default_template: "tpl_std", file_prefix: "staff" },
        staff: { new_requires_approval: true, allow_permanent_delete: false, page_size: 25 }
      },
      zones: [
        { id: "z_ho", code: "HO", name: "Head Office", status: "active" },
        { id: "z_raj", code: "RAJ", name: "Rajshahi Zone", status: "active" },
        { id: "z_dhn", code: "DHN", name: "Dhaka North Zone", status: "active" },
        { id: "z_ctg", code: "CTG", name: "Chattogram Zone", status: "active" }
      ],
      hubs: [
        { id: "h_ho", code: "HO", name: "Head Office", zone_id: "z_ho", status: "active" },
        { id: "h_nat", code: "NAT", name: "Natore Sorting Center", zone_id: "z_raj", status: "active" },
        { id: "h_rjs", code: "RJS", name: "Rajshahi Sadar Hub", zone_id: "z_raj", status: "active" },
        { id: "h_bog", code: "BOG", name: "Bogura Hub", zone_id: "z_raj", status: "active" },
        { id: "h_mir", code: "MIR", name: "Mirpur Hub", zone_id: "z_dhn", status: "active" },
        { id: "h_utt", code: "UTT", name: "Uttara Hub", zone_id: "z_dhn", status: "active" },
        { id: "h_agr", code: "AGR", name: "Agrabad Hub", zone_id: "z_ctg", status: "active" },
        { id: "h_hal", code: "HAL", name: "Halishahar Hub", zone_id: "z_ctg", status: "active" }
      ],
      positions: [
        ["p_sys", "System Administrator"], ["p_ops", "Operations Manager"], ["p_hr", "HR Officer"], ["p_acc", "Accounts Officer"], ["p_zm", "Zonal Manager"],
        ["p_hic", "Hub In-charge"], ["p_ahic", "Assistant Hub In-charge"], ["p_srider", "Senior Rider"], ["p_rider", "Delivery Rider"],
        ["p_auto", "Auto Driver"], ["p_van", "Van Driver"], ["p_sort", "Sorting Man"], ["p_load", "Loader"], ["p_help", "Helper"], ["p_guard", "Security Guard"]
      ].map((p) => ({ id: p[0], name: p[1], status: "active" })),
      roles: [], staff: [], staff_roles: [], users: [], staff_ids: [], id_sequences: [], assignments: [], transfers: [],
      documents: [], import_jobs: [], zonal_activities: [], audit_logs: [], login_history: [], sessions: [],
      sections: [], fields: [], layouts: [], nav: [], pages: {}, widgets: [], actions: [], export_templates: []
    };

    /* ---- roles: rank 1 is the highest authority ---- */
    const allPerms = {}; CAT.allKeys().forEach((k) => (allPerms[k] = 1));
    const selfOnly = perms({ staff: ["view"] });
    d.roles = [
      { id: "r_super", name: "Super Admin", rank: 1, color: "bad", scope: "all", is_super: true, system: true, perms: allPerms },
      { id: "r_admin", name: "Admin", rank: 2, color: "violet", scope: "all", system: true, perms: perms({ dashboard: "*", staff: ["view", "create", "edit", "remove", "export", "print", "approve", "transfer", "settings"], staff_activity: "*", transfers: "*", import: "*", export: "*", zonal: "*", org: ["view", "create", "edit"], fields: ["view", "create", "edit"], table: "*", widgets: "*", impexp: "*", users: ["view"], roles: ["view"], idpolicy: ["view"], language: ["view"], audit: ["view", "export"], logins: ["view"] }) },
      { id: "r_hr", name: "HR Manager", rank: 3, color: "info", scope: "all", perms: perms({ dashboard: "*", staff: ["view", "create", "edit", "remove", "export", "print", "approve", "transfer"], staff_activity: "*", transfers: ["view", "create", "export", "print"], import: "*", export: ["view", "export", "print"], zonal: ["view"] }) },
      { id: "r_zm", name: "Zonal Manager", rank: 4, color: "info", scope: "zone", perms: perms({ dashboard: "*", staff: ["view", "export", "print", "transfer"], staff_activity: "*", transfers: ["view", "create", "approve", "export", "print"], zonal: ["view", "create", "edit", "export", "print"], export: ["view", "export", "print"] }) },
      { id: "r_hm", name: "Hub Manager", rank: 5, color: "ok", scope: "hub", perms: perms({ dashboard: "*", staff: ["view", "create", "edit", "print", "transfer"], staff_activity: "*", transfers: ["view", "create"] }) },
      { id: "r_aud", name: "Auditor", rank: 6, color: "grey", scope: "all", perms: perms({ dashboard: "*", staff: ["view"], staff_activity: "*", transfers: ["view"], import: ["view"], export: ["view"], zonal: ["view"], roles: ["view"], users: ["view"], org: ["view"], audit: ["view", "export"], logins: ["view"] }) },
      { id: "r_rider", name: "Rider", rank: 8, color: "ok", scope: "self", perms: selfOnly },
      { id: "r_driver", name: "Driver", rank: 8, color: "info", scope: "self", perms: selfOnly },
      { id: "r_sorter", name: "Sorter", rank: 9, color: "info", scope: "self", perms: selfOnly },
      { id: "r_loader", name: "Loader", rank: 9, color: "warn", scope: "self", perms: selfOnly },
      { id: "r_helper", name: "Helper", rank: 9, color: "violet", scope: "self", perms: selfOnly },
      { id: "r_guard", name: "Security Guard", rank: 9, color: "grey", scope: "self", perms: selfOnly }
    ].map((r) => Object.assign({ status: "active", system: false, is_super: false }, r));

    /* ---- profile sections and fields (built-in fields can be renamed / hidden, not deleted) ---- */
    d.sections = [
      ["personal", "Personal Information", "ব্যক্তিগত তথ্য", "fields", "user"], ["contact", "Contact Information", "যোগাযোগের তথ্য", "fields", "phone"],
      ["employment", "Employment Information", "চাকরির তথ্য", "fields", "briefcase"], ["hub", "Hub Information", "হাবের তথ্য", "fields", "building"],
      ["position", "Position and Rank", "পদ ও র‍্যাঙ্ক", "fields", "star"], ["roles", "Role Assignments", "রোল", "roles", "shield"],
      ["portal", "Login Portal Access", "লগইন পোর্টাল", "portal", "key"], ["joining", "Joining Information", "যোগদানের তথ্য", "fields", "calendar"],
      ["documents", "Documents", "ডকুমেন্ট", "documents", "file"], ["emergency", "Emergency Contact", "জরুরি যোগাযোগ", "fields", "alert"],
      ["activity", "Activity History", "কার্যক্রমের ইতিহাস", "activity", "history"]
    ].map((s, i) => ({ id: "sec_" + s[0], key: s[0], label: s[1], label_bn: s[2], kind: s[3], icon: s[4], order: i + 1, visible: true, builtin: true }));
    const F = (key, label, bn, type, section, x) => Object.assign({ id: "f_" + key, key, label, label_bn: bn, type, section, builtin: true, required: false, visible: true, options: [], view_roles: [], edit_roles: [], archived: false, locked: false }, x || {});
    const sens = ["r_super", "r_admin", "r_hr"];
    d.fields = [
      F("name", "Employee Name", "কর্মীর নাম", "text", "personal", { required: true }),
      F("photo", "Photo", "ছবি", "photo", "personal"),
      F("gender", "Gender", "লিঙ্গ", "select", "personal", { options: ["Male", "Female", "Other"] }),
      F("dob", "Date of Birth", "জন্ম তারিখ", "date", "personal", { view_roles: sens }),
      F("blood_group", "Blood Group", "রক্তের গ্রুপ", "select", "personal", { options: ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"] }),
      F("nid", "National ID No.", "জাতীয় পরিচয়পত্র নম্বর", "text", "personal", { view_roles: sens, edit_roles: sens }),
      F("phone", "Phone", "মোবাইল", "tel", "contact", { required: true }),
      F("email", "Email", "ইমেইল", "email", "contact"),
      F("address", "Present Address", "বর্তমান ঠিকানা", "textarea", "contact"),
      F("status", "Status", "অবস্থা", "status", "employment", { locked: true }),
      F("employment_type", "Employment Type", "চাকরির ধরন", "select", "employment", { options: ["Permanent", "Contract", "Daily basis"] }),
      F("manager_id", "Reporting Manager", "রিপোর্টিং ম্যানেজার", "staff", "employment"),
      F("staff_no", "Staff ID", "স্টাফ আইডি", "staffno", "hub", { locked: true }),
      F("hub_id", "Hub", "হাব", "hub", "hub", { required: true, locked: true }),
      F("zone_id", "Zone", "জোন", "zone", "hub", { locked: true }),
      F("position_id", "Position", "পদ", "position", "position", { required: true, locked: true }),
      F("roles", "Role", "রোল", "roles", "position", { locked: true }),
      F("rank", "Rank", "র‍্যাঙ্ক", "rank", "position", { locked: true }),
      F("joining_date", "Joining Date", "যোগদানের তারিখ", "date", "joining", { required: true }),
      F("emergency_name", "Emergency Contact Name", "জরুরি যোগাযোগের নাম", "text", "emergency"),
      F("emergency_phone", "Emergency Contact Phone", "জরুরি যোগাযোগের মোবাইল", "tel", "emergency"),
      F("emergency_relation", "Relationship", "সম্পর্ক", "text", "emergency"),
      F("c_dl_no", "Driving Licence No.", "ড্রাইভিং লাইসেন্স নম্বর", "text", "employment", { builtin: false }),
      F("c_dl_expiry", "Licence Expiry Date", "লাইসেন্সের মেয়াদ", "date", "employment", { builtin: false })
    ].map((f, i) => Object.assign(f, { order: i + 1 }));

    /* ---- saved table layouts ---- */
    const col = (key, visible) => ({ key, label: "", visible: visible !== false });
    d.layouts = [
      { id: "lay_default", name: "Standard", shared: true, owner: null, columns: ["select", "staff_no", "name", "photo", "phone", "hub_id", "zone_id", "position_id", "roles", "rank", "joining_date", "status", "actions"].map((k) => col(k)) },
      { id: "lay_contact", name: "Contact list", shared: true, owner: null, columns: ["select", "staff_no", "name", "phone", "email", "hub_id", "emergency_phone", "status", "actions"].map((k) => col(k)) }
    ];
    d.settings.staff.default_layout = "lay_default";

    /* ---- sidebar ---- */
    let ord = 0;
    const G = (id, label, bn) => ({ id, type: "group", label, label_bn: bn, icon: "", page: "", url: "", parent: null, order: ++ord, visible: true, roles: [], builtin: true });
    const N = (page, parent, bn, x) => Object.assign({ id: "nav_" + page, type: "page", label: CAT.pages[page].label, label_bn: bn, icon: CAT.pages[page].icon, page, url: "", parent, order: ++ord, visible: true, roles: [], builtin: true }, x || {});
    d.nav = [
      G("g_staff", "Staff Management", "স্টাফ ম্যানেজমেন্ট"),
      N("dashboard", "g_staff", "ড্যাশবোর্ড"), N("staff", "g_staff", "স্টাফ তালিকা"), N("transfers", "g_staff", "বদলি"),
      N("import", "g_staff", "ইমপোর্ট"), N("export", "g_staff", "এক্সপোর্ট ও প্রিন্ট"),
      G("g_zonal", "Zonal Management", "জোনাল ম্যানেজমেন্ট"), N("zonal", "g_zonal", "জোনাল ম্যানেজারের কার্যক্রম"),
      G("g_control", "Super Admin Control Center", "কন্ট্রোল সেন্টার"),
      N("roles", "g_control", "রোল ও পারমিশন"), N("users", "g_control", "ইউজার ও পোর্টাল"), N("org", "g_control", "হাব, জোন ও পদ"),
      N("fields", "g_control", "প্রোফাইল বিল্ডার"), N("table", "g_control", "টেবিল কলাম"), N("nav", "g_control", "সাইডবার ও পেজ"),
      N("widgets", "g_control", "উইজেট ও বাটন"), N("language", "g_control", "ভাষা নীতি"), N("idpolicy", "g_control", "স্টাফ আইডি নীতি"),
      N("impexp", "g_control", "ইমপোর্ট / এক্সপোর্ট সেটিংস"), N("system", "g_control", "সিস্টেম কনফিগারেশন"),
      G("g_sec", "Security & Audit", "নিরাপত্তা ও অডিট"), N("audit", "g_sec", "অডিট লগ"), N("logins", "g_sec", "লগইন ও সেশন"), N("backup", "g_sec", "ব্যাকআপ")
    ];
    /* page configuration: which portals may open a page (checked by the API as well) */
    Object.keys(CAT.pages).forEach((k) => { const m = CAT.pages[k].module; d.pages[k] = { enabled: true, portals: m === "control" || k === "backup" ? ["super", "admin"] : m === "security" || m === "importer" ? ["super", "admin"] : ["super", "admin", "staff"] }; });
    ["roles", "nav", "language", "idpolicy", "system", "backup"].forEach((k) => (d.pages[k].portals = ["super"]));

    d.widgets = [
      ["total", "Total Staff", "মোট স্টাফ", "stat", "users", ""], ["active", "Active Staff", "সক্রিয় স্টাফ", "stat", "usercheck", ""],
      ["inactive", "Inactive Staff", "নিষ্ক্রিয় স্টাফ", "stat", "userx", "bad"], ["transferred", "Transferred Staff", "বদলি হওয়া স্টাফ", "stat", "transfer", "info"],
      ["pending", "Pending Approval", "অনুমোদনের অপেক্ষায়", "stat", "clock", "warn"], ["new_month", "New Staff This Month", "এই মাসে নতুন", "stat", "userplus", "violet"],
      ["by_hub", "Staff by Hub", "হাব অনুযায়ী স্টাফ", "panel", "building", ""], ["by_position", "Staff by Position", "পদ অনুযায়ী স্টাফ", "panel", "briefcase", ""],
      ["pending_list", "Waiting for Approval", "অনুমোদনের অপেক্ষায়", "panel", "clock", ""], ["recent", "Recent Activity", "সাম্প্রতিক কার্যক্রম", "panel", "history", ""]
    ].map((w, i) => ({ id: "w_" + w[0], key: w[0], label: w[1], label_bn: w[2], type: w[3], icon: w[4], tone: w[5], visible: true, order: i + 1, roles: [] }));

    d.actions = [
      ["view", "View Profile", "eye", true], ["edit", "Edit", "edit", true], ["transfer", "Transfer", "transfer", true],
      ["approve", "Approve", "check", false], ["activate", "Activate", "power", false], ["deactivate", "Deactivate", "ban", false],
      ["print", "Print", "printer", false], ["export", "Export Staff Sheet", "sheet", false], ["activity", "View Activity", "activity", false],
      ["remove", "Remove", "trash", false]
    ].map((a, i) => ({ id: "act_" + a[0], key: a[0], label: a[1], icon: a[2], inline: a[3], visible: true, order: i + 1 }));

    d.export_templates = [
      { id: "tpl_std", name: "Standard staff list", company: "Steadfast Hubwise Management", title: "Staff List", logo: "", sheet_name: "Staff", date_format: "DD/MM/YYYY", font: "Calibri", font_size: 11, align: "left", header_align: "center", orientation: "landscape", page_size: "A4", header_text: "", footer_text: "Confidential — internal use only", page_numbers: true, show_generated: true,
        columns: [["sl", "S/L"], ["staff_no", "Staff ID"], ["name", "Employee Name"], ["phone", "Phone"], ["hub_id", "Hub"], ["zone_id", "Zone"], ["position_id", "Position"], ["roles", "Role"], ["rank", "Rank"], ["joining_date", "Joining Date"], ["status", "Status"]].map((c) => ({ key: c[0], header: c[1] })) },
      { id: "tpl_hub", name: "Hub contact sheet (portrait)", company: "Steadfast Hubwise Management", title: "Hub Contact Sheet", logo: "", sheet_name: "Contacts", date_format: "DD-MMM-YYYY", font: "Arial", font_size: 10, align: "left", header_align: "left", orientation: "portrait", page_size: "A4", header_text: "", footer_text: "", page_numbers: true, show_generated: false,
        columns: [["sl", "No."], ["staff_no", "ID"], ["name", "Name"], ["position_id", "Designation"], ["phone", "Mobile"], ["emergency_phone", "Emergency No."]].map((c) => ({ key: c[0], header: c[1] })) }
    ];

    /* ---- people ---- */
    const FN = ["Arif", "Babul", "Dulal", "Faruk", "Habib", "Imran", "Jahid", "Kabir", "Liton", "Milon", "Nayeem", "Omar", "Parvez", "Rakib", "Sohel", "Tareq", "Ujjal", "Wasim", "Yasin", "Zakir", "Bipul", "Chandan", "Emon", "Golam", "Hasib", "Jewel", "Kamal", "Lokman", "Monir", "Noman", "Polash", "Ratan", "Sagor", "Titu", "Shanto", "Mamun", "Anik", "Biplob", "Ripon", "Sumon"];
    const LN = ["Hossain", "Ali", "Sheikh", "Mia", "Sarker", "Mondol", "Pramanik", "Biswas", "Khan", "Uddin", "Islam", "Rahman", "Akand", "Talukder", "Molla", "Sardar", "Das", "Roy"];
    const used = new Set(); let phoneN = 1001;
    const person = () => { let n; do { n = pick(FN) + " " + pick(LN); } while (used.has(n)); used.add(n); return n; };
    const mk = (name, hub, pos, roleIds, joinAgo, x) => {
      const s = Object.assign({ id: uid("st"), name, phone: "0170055" + String(phoneN++), email: "", photo: "", gender: "Male", dob: (1975 + Math.floor(rnd() * 28)) + "-" + String(1 + Math.floor(rnd() * 12)).padStart(2, "0") + "-" + String(1 + Math.floor(rnd() * 27)).padStart(2, "0"),
        blood_group: pick(["A+", "B+", "O+", "AB+", "O-", "B-"]), nid: String(1990000000 + Math.floor(rnd() * 9999999)), address: pick(["Station Road", "College Para", "Bazar Road", "Housing Estate", "Notun Para"]) + ", " + SF_hubName(d, hub),
        status: "active", employment_type: pick(["Permanent", "Permanent", "Contract"]), manager_id: null, staff_no: null, hub_id: hub, zone_id: Core.hubZone(d, hub), position_id: pos,
        joining_date: ago(joinAgo), emergency_name: pick(FN) + " " + pick(LN), emergency_phone: "0180055" + String(phoneN + 4000), emergency_relation: pick(["Brother", "Father", "Wife", "Uncle"]),
        custom: {}, transferred_at: null, created_at: agoIso(joinAgo), created_by: null, deleted_at: null, deleted_reason: "" }, x || {});
      d.staff.push(s);
      roleIds.forEach((r) => d.staff_roles.push({ id: uid("sr"), staff_id: s.id, role_id: r, assigned_at: agoIso(joinAgo), assigned_by: null }));
      return s;
    };
    function SF_hubName(dd, id) { return dd.hubs.find((h) => h.id === id).name; }

    const ho = {
      sa: mk("Ayesha Rahman", "h_ho", "p_sys", ["r_super"], 980, { gender: "Female", email: "ayesha.rahman@hubwise.example" }),
      ad: mk("Kamrul Hasan", "h_ho", "p_ops", ["r_admin"], 900, { email: "kamrul.hasan@hubwise.example" }),
      hr: mk("Nusrat Jahan", "h_ho", "p_hr", ["r_hr"], 760, { gender: "Female", email: "nusrat.jahan@hubwise.example" }),
      au: mk("Shirin Sultana", "h_ho", "p_acc", ["r_aud"], 640, { gender: "Female", email: "shirin.sultana@hubwise.example" })
    };
    const zm = {
      z_raj: mk("Mahmudul Hoque", "h_nat", "p_zm", ["r_zm"], 820, { email: "mahmudul.hoque@hubwise.example" }),
      z_dhn: mk("Tanvir Ahmed", "h_mir", "p_zm", ["r_zm"], 700),
      z_ctg: mk("Rashed Chowdhury", "h_agr", "p_zm", ["r_zm"], 610)
    };
    const hm = {}; let riderNatore = null;
    const plan = [["p_ahic", ["r_hm"], 1], ["p_srider", ["r_rider"], 1], ["p_rider", ["r_rider"], 2], ["p_auto", ["r_driver"], 1], ["p_sort", ["r_sorter"], 1], ["p_load", ["r_loader", "r_sorter"], 1], ["p_help", ["r_helper"], 1], ["p_guard", ["r_guard"], 1]];
    d.hubs.filter((h) => h.id !== "h_ho").forEach((h, hi) => {
      const m = mk(person(), h.id, "p_hic", ["r_hm"], 560 - hi * 30, { manager_id: zm[h.zone_id].id }); hm[h.id] = m;
      plan.forEach((p, pi) => { for (let i = 0; i < p[2]; i++) {
        if (p[0] === "p_guard" && hi % 2) continue;
        if (p[0] === "p_ahic" && hi % 3) continue;
        const s = mk(person(), h.id, p[0], p[1], 20 + Math.floor(rnd() * 700), { manager_id: m.id });
        if (p[0] === "p_auto") { s.custom.c_dl_no = "DL" + (100000 + Math.floor(rnd() * 899999)); s.custom.c_dl_expiry = ago(-60 - Math.floor(rnd() * 500) + (pi + hi === 4 ? 400 : 0)); }
        if (h.id === "h_nat" && p[0] === "p_rider" && !riderNatore) riderNatore = s;
      } });
    });
    zm.z_raj.manager_id = ho.ad.id; zm.z_dhn.manager_id = ho.ad.id; zm.z_ctg.manager_id = ho.ad.id;

    /* new joiners this month, pending approvals, inactive and removed examples */
    const dom = now.getDate();
    [["h_nat", "p_rider", ["r_rider"], 1], ["h_mir", "p_help", ["r_helper"], 2], ["h_agr", "p_load", ["r_loader"], 0]].forEach((x) => mk(person(), x[0], x[1], x[2], Math.min(x[3], dom - 1), { manager_id: hm[x[0]].id }));
    [["h_rjs", "p_rider", ["r_rider"]], ["h_utt", "p_sort", ["r_sorter"]], ["h_hal", "p_rider", ["r_rider"]]].forEach((x) => mk(person(), x[0], x[1], x[2], 0, { status: "pending", manager_id: hm[x[0]].id }));
    const ordinary = d.staff.filter((s) => !d.staff_roles.some((r) => r.staff_id === s.id && ["r_super", "r_admin", "r_hr", "r_aud", "r_zm", "r_hm"].includes(r.role_id)) && s.status === "active" && s !== riderNatore);
    [3, 11, 19, 27, 33].forEach((i) => { if (ordinary[i]) ordinary[i].status = "inactive"; });
    if (ordinary[7]) { ordinary[7].status = "removed"; ordinary[7].deleted_at = agoIso(40); ordinary[7].deleted_reason = "Left the company (demo record)"; }

    /* hub staff IDs: numbered from 1 inside each hub, in joining order */
    d.staff.slice().sort((a, b) => (a.joining_date < b.joining_date ? -1 : a.joining_date > b.joining_date ? 1 : 0)).forEach((s) => {
      Core.assignStaffNo(d, s, s.hub_id, s.joining_date, "Joining"); Core.openAssignment(d, s, s.joining_date, "joining");
    });

    /* ---- login accounts (password is hashed on first run, see api.js) ---- */
    const U = (username, staff, portals, x) => d.users.push(Object.assign({ id: uid("u"), username, staff_id: staff.id, portals, status: "active", salt: "", hash: "", seed_pw: SF.DEMO_PASSWORD, failed: 0, locked_until: null, last_login: null, created_at: nowIso(), must_change: false }, x || {}));
    U("superadmin", ho.sa, ["super", "admin"]); U("admin", ho.ad, ["admin"]); U("hr.nusrat", ho.hr, ["admin"]); U("auditor", ho.au, ["admin"]);
    U("zm.rajshahi", zm.z_raj, ["staff"]); U("hm.natore", hm.h_nat, ["staff"]); U("rider.natore", riderNatore, ["staff"]);
    U("zm.dhaka", zm.z_dhn, ["staff"], { status: "disabled" });
    const uidOf = (name) => d.users.find((u) => u.username === name).id;

    /* ---- transfer history: two approved, one waiting ---- */
    const movable = d.staff.filter((s) => s.status === "active" && s.position_id === "p_rider" && s !== riderNatore);
    const T = (s, toHub, toPos, eff, reason, approve) => {
      const tr = { id: uid("tr"), staff_id: s.id, from_hub: s.hub_id, to_hub: toHub, from_zone: s.zone_id, to_zone: Core.hubZone(d, toHub), from_position: s.position_id, to_position: toPos || s.position_id,
        from_manager: s.manager_id, to_manager: hm[toHub] ? hm[toHub].id : s.manager_id, from_staff_no: s.staff_no, to_staff_no: null, effective_date: eff, reason, status: "pending",
        requested_by: uidOf("hr.nusrat"), approved_by: null, approved_at: null, decision_note: "", created_at: new Date(eff + "T09:00:00").toISOString() };
      d.transfers.push(tr);
      const log = (who, action, text, at) => d.audit_logs.push({ id: uid("aud"), at, user_id: uidOf(who), user_name: who, action, entity: "transfer", entity_id: tr.id, summary: text, before: null, after: null });
      log("hr.nusrat", "TRANSFER_REQUEST", "Transfer requested for " + s.name + ": " + SF_hubName(d, tr.from_hub) + " → " + SF_hubName(d, toHub), tr.created_at);
      if (approve) { Core.applyTransfer(d, tr, uidOf("admin"), new Date(eff + "T11:30:00").toISOString()); log("admin", "TRANSFER_APPROVE", "Transfer of " + s.name + " approved — new Staff ID " + tr.to_staff_no + " at " + SF_hubName(d, toHub), tr.approved_at); }
    };
    if (movable[0]) T(movable[0], movable[0].hub_id === "h_rjs" ? "h_nat" : "h_rjs", "p_srider", ago(75), "Promoted to Senior Rider; destination hub was short of riders", true);
    if (movable[2]) T(movable[2], movable[2].hub_id === "h_utt" ? "h_mir" : "h_utt", null, ago(12), "Requested transfer closer to home", true);
    if (movable[4]) T(movable[4], movable[4].hub_id === "h_bog" ? "h_nat" : "h_bog", null, ago(-3), "Cover for a rider on long leave", false);

    /* ---- zonal manager activity ---- */
    const zTypes = [["activity", "Hub visit", "Checked attendance register and parcel shelves."], ["report", "Weekly zone report", "Delivery, return and staff summary submitted to Head Office."],
      ["task", "Follow up pending staff documents", "Collect missing NID copies from the hub."], ["activity", "Staff meeting", "Monthly meeting with hub staff about delivery targets."],
      ["task", "Verify rider licence renewals", "Check expiry dates for all drivers."], ["report", "Monthly staff movement report", "Joiners, leavers and transfers for the month."]];
    Object.keys(zm).forEach((zid, zi) => {
      const zhubs = d.hubs.filter((h) => h.zone_id === zid), u = d.users.find((x) => x.staff_id === zm[zid].id);
      for (let i = 0; i < 9; i++) {
        const t = zTypes[(i + zi) % zTypes.length], dAgo = 2 + i * 5 + zi, done = i > 1 || t[0] !== "task";
        d.zonal_activities.push({ id: uid("za"), zone_id: zid, hub_id: zhubs[i % zhubs.length].id, manager_id: zm[zid].id, date: ago(dAgo), type: t[0], title: t[1], details: t[2],
          status: t[0] === "report" ? (i === 1 ? "pending" : "submitted") : done ? "completed" : "pending", created_by: u ? u.id : uidOf("admin"), created_at: agoIso(dAgo, 9), updated_by: null, updated_at: null, deleted_at: null });
      }
    });

    Core.audit(d, null, "SEED", "system", null, "Demo database created with fictional data");
    return d;
  };
})();
