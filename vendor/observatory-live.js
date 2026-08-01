"use strict";
/* ============================================================
   IDEA INTEGRATION LAYER (BR_05) — appended by app/observatory/route.ts
   after the reference implementation's own script.

   This is the spec's §16 registry handshake, adapted: instead of a raw
   EventSource of individual records, IDEA maps whole projects server-side
   (lib/weave.ts) and this layer merges them into the dashboard beside its
   scripted demo. Deviations from the spec are recorded in
   docs/requirements/BR_05-weave-observatory.md — not silent.

   Rules honored here:
   - Only real repos appear: the scripted demo projects are removed outright
     (BR_05 deviation I5). Spec §1.5 (captions never lie about scripted vs
     live) is satisfied vacuously — nothing scripted is shown.
   - Real rules seen in logs (LR-*, ADR-*) get glossary entries so the
     teaching posture extends to live data (BR_05_BE-03).
   - Causal connectors default to "all" so the causality arrows accumulate
     during playback and persist after it ends, instead of showing only the
     selected event's arcs.
   - No emoji. No network beyond IDEA's own origin. Storage stays l9:.
   ============================================================ */

(function ideaIntegration() {
  /* The core script's top-level bindings (PROJECTS, GLOSS, GL_ALIASES,
     renderHome, showHome, store, PROJECT, openProject) are in the global
     lexical scope of the page, reachable from this later script. If the
     vendored file ever renames one, fail visibly — not silently. */
  var required = ["PROJECTS", "GLOSS", "GL_ALIASES", "renderHome", "showHome", "store", "causeMode"];
  for (var i = 0; i < required.length; i++) {
    try {
      if (typeof eval(required[i]) === "undefined") throw new Error(required[i]);
    } catch {
      console.error("[idea] weave integration disabled — missing global: " + required[i]);
      return;
    }
  }

  /* 1 — Only real repos: drop the scripted demo projects before first paint.
     Live projects are id-prefixed "live-" by lib/weave.ts. If the handshake
     below fails, the portfolio is empty and the status line says why —
     honest absence beats teaching fiction. */
  for (var d = PROJECTS.length - 1; d >= 0; d--) {
    if (PROJECTS[d].id.indexOf("live-") !== 0) PROJECTS.splice(d, 1);
  }
  refreshProjectSelect();
  if (typeof PROJECT === "undefined" || PROJECT === null) renderHome();

  /* 1b — Causal connectors default to "all": the arrows showing what caused
     what accumulate as the run plays and stay on screen after the animation
     ends. The chip was built before this script ran, so restate its label;
     its own click handler keeps it correct from here on. */
  causeMode = "all";
  var cchip = document.getElementById("cchip");
  if (cchip) {
    cchip.textContent = "causality: all";
    cchip.classList.add("all");
  }

  /* Rebuild the project select in place — initProjectUI cannot be re-run
     (it would duplicate the causality chip), so only the options refresh. */
  function refreshProjectSelect() {
    var sel = document.getElementById("projsel");
    if (!sel) return;
    var current = sel.value;
    sel.innerHTML =
      '<option value="">— portfolio —</option>' +
      PROJECTS.map(function (p) {
        return '<option value="' + p.id + '">' + p.name + "</option>";
      }).join("");
    sel.value = current;
  }

  /* 2 — Registry handshake: fetch IDEA's real projects and merge. */
  function mergeLive(payload) {
    if (!payload || !Array.isArray(payload.projects)) return;

    payload.projects.forEach(function (np) {
      np.cfg = store.get("proj:" + np.id, {}) || {};
      np.lastRun = null;
      var at = PROJECTS.findIndex(function (p) { return p.id === np.id; });
      if (at >= 0) PROJECTS[at] = np; else PROJECTS.push(np);
    });

    /* Glossary entries for rules the live logs actually cite. */
    if (payload.glossary) {
      (payload.glossary.entries || []).forEach(function (g) {
        if (!GLOSS[g.id]) GLOSS[g.id] = g;
      });
      var al = payload.glossary.aliases || {};
      Object.keys(al).forEach(function (k) {
        if (!GL_ALIASES[k]) GL_ALIASES[k] = al[k];
      });
    }

    refreshProjectSelect();

    /* Re-render whatever is on screen. Never yank the user out of an open
       project — the portfolio refresh waits until they return Home. */
    if (typeof PROJECT === "undefined" || PROJECT === null) renderHome();
  }

  fetch("/api/observatory/weave", { credentials: "same-origin" })
    .then(function (r) {
      if (!r.ok) throw new Error("handshake " + r.status);
      return r.json();
    })
    .then(mergeLive)
    .catch(function (e) {
      /* The dashboard still works as the scripted demo; say why the live half
         is absent instead of pretending there is nothing to show. */
      console.error("[idea] live project handshake failed:", e);
      var st = document.getElementById("statustxt");
      if (st && st.textContent === "portfolio") st.textContent = "portfolio · live data unavailable";
    });

  /* 3 — Periodic refresh, Home only. A full per-event SSE ingest is the
     spec's backlog #1; until then the honest cheap version is a re-fetch
     that never disturbs an open project view. */
  setInterval(function () {
    if (typeof PROJECT !== "undefined" && PROJECT !== null) return;
    fetch("/api/observatory/weave", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (p) { if (p) mergeLive(p); })
      .catch(function () { /* transient; the next tick retries */ });
  }, 60000);
})();
