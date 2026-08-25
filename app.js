// ============================================================================
// app.js — Brutzel
//
// Diese erste Version kümmert sich nur um die Grundnavigation zwischen den
// Platzhalter-Screens (Sidebar + Rezept-Detail + Kochmodus). Die eigentliche
// Fach-Logik (Kalender, Zutaten-Aggregation, GitHub-Sync, …) kommt in den
// nächsten Sessions dazu.
// ============================================================================

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js");
  });
}

const NAV_SCREENS = ["home", "kalender", "rezepte", "einkaufsliste", "techniken", "einstellungen"];

function zeigeScreen(name) {
  NAV_SCREENS.concat(["rezept-detail"]).forEach((screenName) => {
    const el = document.getElementById(`screen-${screenName}`);
    if (el) el.hidden = screenName !== name;
  });

  document.querySelectorAll(".sidebar__nav-item, .sidebar__icon-btn[data-screen]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.screen === name);
  });
}

document.querySelectorAll("[data-screen]").forEach((btn) => {
  btn.addEventListener("click", () => zeigeScreen(btn.dataset.screen));
});

document.querySelectorAll("[data-open-detail]").forEach((btn) => {
  btn.addEventListener("click", () => zeigeScreen("rezept-detail"));
});

document.querySelectorAll("[data-back-to]").forEach((btn) => {
  btn.addEventListener("click", () => zeigeScreen(btn.dataset.backTo));
});

// ---------- Kochmodus (Vollbild-Overlay) ----------

let wakeLock = null;

async function oeffneKochmodus() {
  document.getElementById("screen-kochmodus").hidden = false;
  if ("wakeLock" in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request("screen");
    } catch (fehler) {
      console.warn("Wake Lock nicht verfügbar:", fehler);
    }
  }
}

function schliesseKochmodus() {
  document.getElementById("screen-kochmodus").hidden = true;
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

document.querySelectorAll("[data-open-kochmodus]").forEach((btn) => {
  btn.addEventListener("click", oeffneKochmodus);
});

document.querySelectorAll("[data-close-kochmodus]").forEach((btn) => {
  btn.addEventListener("click", schliesseKochmodus);
});
