/* Shared sign-in screen for the three portals. The portal is fixed by the page that loads this
   script (<body data-portal="super|admin|staff">); the API decides whether the account may use it. */
(function () {
  "use strict";
  const SF = window.SF, { UI, API, PORTALS } = SF, { icon, esc } = UI;
  const portal = PORTALS.find((p) => p.key === document.body.dataset.portal) || PORTALS[2];
  const COPY = {
    super: ["Super Admin Portal", "Full control of roles, portals, pages, fields and system settings.", ["Role & permission matrix", "Login portal assignment", "Sidebar, table and profile builders"]],
    admin: ["Admin Portal", "Day-to-day administration of staff, transfers, imports and reports.", ["Staff directory and approvals", "Import, export and print centre", "Audit log and login history"]],
    staff: ["Staff & Management Portal", "For zonal managers, hub managers and staff.", ["Your hub or zone only", "Transfers and zonal activity", "Your own profile"]]
  }[portal.key];

  async function start() {
    const root = document.getElementById("app");
    root.innerHTML = UI.state("loading", "Loading…");
    try { await API.init(); } catch (e) { root.innerHTML = UI.state("error", "The demo could not start", e.message); return; }
    if (API.hasSession() && API.sessionPortal() === portal.key) { location.href = "app.html"; return; }
    const info = API.publicInfo(), flash = sessionStorage.getItem("sfhub_flash") || ""; sessionStorage.removeItem("sfhub_flash");
    const demo = info.hints ? SF.DEMO_USERS.filter((u) => u[2].includes(portal.key)) : [];
    document.title = COPY[0] + " — " + (info.company.product || "Hubwise ERP");
    root.innerHTML = `<div class="login-page">
      <section class="login-art">
        <div class="row"><span class="brand" style="padding:0;border:none;height:auto"><span class="mark">${esc(info.company.short || "SF")}</span><div><b style="font-size:16px">${esc(info.company.name)}</b><span>${esc(info.company.product || "")}</span></div></span></div>
        <div><h1>${esc(COPY[0])}</h1><p>${esc(COPY[1])}</p></div>
        <ul>${COPY[2].map((x) => `<li>${icon("check")}<span>${esc(x)}</span></li>`).join("")}</ul>
      </section>
      <section class="login-side"><div class="login-box">
        <form class="login-card" id="loginForm" novalidate>
          <span class="portal-tag">${icon(portal.icon, "sm")} ${esc(portal.label)}</span>
          <div><h2>Sign in</h2><p class="muted small">Accounts are created by an administrator. There is no public registration.</p></div>
          ${flash ? `<div class="note">${icon("info")}<span>${esc(flash)}</span></div>` : ""}
          <div class="note bad hidden" id="loginErr" role="alert"></div>
          <div class="field"><label for="lu">Username</label><input id="lu" name="username" autocomplete="username" required></div>
          <div class="field"><label for="lp">Password</label><input id="lp" name="password" type="password" autocomplete="current-password" required></div>
          <button class="btn primary" id="loginBtn" type="submit">${icon("lock")}Sign in</button>
        </form>
        ${demo.length ? `<div class="hintbox"><b>Demo accounts for this portal</b><div class="muted">Fictional users. Click one to fill the form. A Super Admin can switch this box off in System Configuration.</div>${demo.map((u) => `<button type="button" data-fill="${esc(u[0])}"><span><b>${esc(u[0])}</b></span><span class="muted">${esc(u[1])}</span></button>`).join("")}</div>` : ""}
        <p class="small faint" style="text-align:center">Demo — fictional data stored only in this browser.</p>
      </div></section></div>`;
    const form = document.getElementById("loginForm"), err = document.getElementById("loginErr"), btn = document.getElementById("loginBtn");
    root.querySelectorAll("[data-fill]").forEach((b) => b.addEventListener("click", () => { form.username.value = b.dataset.fill; form.password.value = SF.DEMO_PASSWORD; form.password.focus(); }));
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); err.classList.add("hidden");
      if (!form.username.value.trim() || !form.password.value) { err.textContent = "Enter your username and password."; err.classList.remove("hidden"); return; }
      btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px"></span> Signing in…';
      let r; try { r = await API.login(portal.key, form.username.value, form.password.value); } catch (x) { r = { ok: false, message: x.message }; }
      if (r.ok) { sessionStorage.setItem("sfhub_portal", portal.key); location.href = "app.html"; return; }
      btn.disabled = false; btn.innerHTML = icon("lock") + "Sign in"; err.textContent = r.message; err.classList.remove("hidden"); form.password.value = ""; form.password.focus();
    });
    form.username.focus();
  }
  start();
})();
