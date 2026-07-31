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
   - The demo projects stay, labelled "scripted demo" (spec §1.5: captions
     never lie about scripted vs live).
   - Real rules seen in logs (LR-*, ADR-*) get glossary entries so the
     teaching posture extends to live data (BR_05_BE-03).
   - No emoji. No network beyond IDEA's own origin. Storage stays l9:.
   ============================================================ */

(function ideaIntegration() {
  /* The core script's top-level bindings (PROJECTS, GLOSS, GL_ALIASES,
     renderHome, showHome, store, PROJECT, openProject) are in the global
     lexical scope of the page, reachable from this later script. If the
     vendored file ever renames one, fail visibly — not silently. */
  var required = ["PROJECTS", "GLOSS", "GL_ALIASES", "renderHome", "showHome", "store"];
  for (var i = 0; i < required.length; i++) {
    try {
      if (typeof eval(required[i]) === "undefined") throw new Error(required[i]);
    } catch {
      console.error("[idea] weave integration disabled — missing global: " + required[i]);
      return;
    }
  }

  /* 1 — Label the scripted demo so it cannot be mistaken for live data. */
  PROJECTS.forEach(function (p) {
    if (p.id.indexOf("live-") !== 0 && p.desc.indexOf("scripted demo") === -1) {
      p.desc = p.desc + " (scripted demo — authored teaching data, not live)";
    }
  });

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

    /* Rebuild the project select in place — initProjectUI cannot be re-run
       (it would duplicate the causality chip), so only the options refresh. */
    var sel = document.getElementById("projsel");
    if (sel) {
      var current = sel.value;
      sel.innerHTML =
        '<option value="">— portfolio —</option>' +
        PROJECTS.map(function (p) {
          return '<option value="' + p.id + '">' + p.name + "</option>";
        }).join("");
      sel.value = current;
    }

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
