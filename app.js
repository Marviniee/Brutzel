// ============================================================================
// app.js — Brutzel
// ============================================================================

// Zwei getrennte Versionsangaben, beide sichtbar im Einstellungen-Screen.
//
// APP_SEMVER: die "echte" Versionsnummer, von Hand gepflegt. Nur bei
// spürbaren, sichtbaren Funktions-Updates hochzählen (z.B. "0.1.0" -> "0.2.0").
//
// APP_BUILD: reiner Zähler, bei JEDER Codeänderung an index.html, style.css,
// app.js oder manifest.json hochzählen — siehe Pflicht-Regel oben in
// service-worker.js (CACHE_NAME muss im selben Zug mitgezogen werden).
const APP_SEMVER = "0.8.0";
const APP_BUILD = 10;

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

document.querySelectorAll("[data-back-to]").forEach((btn) => {
  btn.addEventListener("click", () => zeigeScreen(btn.dataset.backTo));
});

// ---------- Kochmodus (Vollbild-Overlay) ----------

let wakeLock = null;

async function oeffneKochmodus() {
  document.getElementById("screen-kochmodus").hidden = false;
  kochmodusSchrittIndex = 0;
  renderKochmodus();

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
  document.getElementById("technik-overlay").hidden = true;
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

// ---------- Daten-Hilfsfunktionen (von Home + Kalender genutzt) ----------

const SLOT_LABELS = { fruehstueck: "Frühstück", mittag: "Mittag", abend: "Abend" };

async function ladeJSON(pfad) {
  // no-store: GitHub Pages cached data/*.json bis zu 10 Minuten - ohne das
  // würden frisch geschriebene Änderungen verzögert sichtbar.
  const antwort = await fetch(pfad, { cache: "no-store" });
  if (!antwort.ok) throw new Error(`${pfad}: HTTP ${antwort.status}`);
  return antwort.json();
}

function ladeRezept(id) {
  return ladeJSON(`./data/rezepte/${id}.json`);
}

function datumZuISO(datum) {
  const monat = String(datum.getMonth() + 1).padStart(2, "0");
  const tag = String(datum.getDate()).padStart(2, "0");
  return `${datum.getFullYear()}-${monat}-${tag}`;
}

function heuteISO() {
  return datumZuISO(new Date());
}

const rezeptCache = new Map();

function ladeRezeptGecacht(id) {
  if (!rezeptCache.has(id)) {
    rezeptCache.set(id, ladeRezept(id));
  }
  return rezeptCache.get(id);
}

// ---------- GitHub-Sync (Schreibzugriff über die Contents API) ----------

const GITHUB_REPO = "Marviniee/Brutzel";
const GITHUB_TOKEN_STORAGE_KEY = "brutzel-github-token";

function ladeGitHubToken() {
  try {
    return localStorage.getItem(GITHUB_TOKEN_STORAGE_KEY) || "";
  } catch (fehler) {
    console.warn("GitHub-Token konnte nicht gelesen werden:", fehler);
    return "";
  }
}

function speichereGitHubToken(token) {
  try {
    localStorage.setItem(GITHUB_TOKEN_STORAGE_KEY, token);
  } catch (fehler) {
    console.warn("GitHub-Token konnte nicht gespeichert werden:", fehler);
  }
}

function entferneGitHubToken() {
  try {
    localStorage.removeItem(GITHUB_TOKEN_STORAGE_KEY);
  } catch (fehler) {
    console.warn("GitHub-Token konnte nicht entfernt werden:", fehler);
  }
}

// btoa() kann nur Latin1 - bei Umlauten (ä/ö/ü/ß in Rezeptnamen) bricht ein
// simples btoa(jsonString). Erst UTF-8-Bytes erzeugen, dann als Latin1-String
// interpretieren, das darf btoa dann kodieren.
function utf8ZuBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binaer = "";
  bytes.forEach((byte) => {
    binaer += String.fromCharCode(byte);
  });
  return btoa(binaer);
}

function base64ZuUtf8(base64) {
  const binaer = atob(base64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binaer, (zeichen) => zeichen.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// Liest eine Datei aus dem Repo über die Contents API. Gibt { sha: null,
// inhalt: null } zurück, wenn die Datei noch nicht existiert (kein Fehler -
// das ist der normale Fall beim allerersten Schreiben einer neuen Datei).
async function ladeGitHubDatei(pfad) {
  const token = ladeGitHubToken();
  if (!token) throw new Error("Kein GitHub-Token hinterlegt. Bitte in den Einstellungen speichern.");

  let antwort;
  try {
    antwort = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${pfad}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
  } catch (fehler) {
    throw new Error("Netzwerkfehler beim Lesen von GitHub. Internetverbindung prüfen.");
  }

  if (antwort.status === 404) return { sha: null, inhalt: null };
  if (antwort.status === 401) throw new Error("GitHub-Token ist ungültig oder abgelaufen.");
  if (!antwort.ok) throw new Error(`GitHub-Anfrage fehlgeschlagen (${antwort.status}).`);

  const daten = await antwort.json();
  const inhalt = JSON.parse(base64ZuUtf8(daten.content));
  return { sha: daten.sha, inhalt };
}

// Schreibt eine Datei im Repo (legt sie an, falls sha null ist).
async function schreibeGitHubDatei(pfad, inhaltObjekt, commitMessage, sha) {
  const token = ladeGitHubToken();
  if (!token) throw new Error("Kein GitHub-Token hinterlegt. Bitte in den Einstellungen speichern.");

  const body = {
    message: commitMessage,
    content: utf8ZuBase64(JSON.stringify(inhaltObjekt, null, 2)),
  };
  if (sha) body.sha = sha;

  let antwort;
  try {
    antwort = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${pfad}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (fehler) {
    throw new Error("Netzwerkfehler beim Schreiben nach GitHub. Internetverbindung prüfen.");
  }

  if (antwort.ok) return antwort.json();

  if (antwort.status === 401) throw new Error("GitHub-Token ist ungültig oder abgelaufen.");
  if (antwort.status === 403) throw new Error("Kein Schreibzugriff mit diesem Token (Berechtigung prüfen).");
  if (antwort.status === 409) throw new Error("Datei wurde zwischenzeitlich geändert. Bitte erneut versuchen.");

  let detail = "";
  try {
    detail = (await antwort.json()).message || "";
  } catch (fehler) {
    // kein JSON-Body, egal
  }
  throw new Error(`GitHub-Schreibvorgang fehlgeschlagen (${antwort.status})${detail ? `: ${detail}` : ""}.`);
}

// Liest eine JSON-Datei, wendet transformFn auf den aktuellen Inhalt an
// (Fallback: leeres Array, falls die Datei noch nicht existiert) und
// schreibt das Ergebnis zurück.
async function aktualisiereGitHubJSON(pfad, transformFn, commitMessage) {
  const { sha, inhalt } = await ladeGitHubDatei(pfad);
  const neueDaten = transformFn(inhalt !== null ? inhalt : []);
  await schreibeGitHubDatei(pfad, neueDaten, commitMessage, sha);
  return neueDaten;
}

// ---------- Kalender ----------

// Reihenfolge + Konfiguration der Kalender-Zeilen. Später um weitere Slots
// (z.B. "snack") aus den Einstellungen erweiterbar, ohne die Rendering-
// Logik unten anzufassen.
const KALENDER_SLOTS = ["fruehstueck", "mittag", "abend"];
const KALENDER_TAG_KUERZEL = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function montagDerWoche(datum) {
  const d = new Date(datum);
  const versatz = (d.getDay() + 6) % 7; // Montag = 0, ... Sonntag = 6
  d.setDate(d.getDate() - versatz);
  d.setHours(0, 0, 0, 0);
  return d;
}

function wochentageAb(montag) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(montag);
    d.setDate(d.getDate() + i);
    return d;
  });
}

let kalenderWochenStart = montagDerWoche(new Date());
let aktuellerKalenderEintrag = null;

function erstelleKalenderChip(eintrag, rezept) {
  const farbe = eintrag.typ === "mealprep" ? "orange" : "blue";
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = `chip chip--${farbe}`;

  if (rezept.icon) {
    const img = document.createElement("img");
    img.className = "chip__icon";
    img.src = rezept.icon;
    img.alt = "";
    img.addEventListener("error", () => img.remove());
    chip.appendChild(img);
  }

  const name = document.createElement("span");
  name.className = "chip__name";
  name.textContent = rezept.name;
  chip.appendChild(name);

  chip.addEventListener("click", () => oeffneKalenderOverlay(eintrag, rezept));
  return chip;
}

async function renderKalenderWoche() {
  const grid = document.getElementById("kalender-woche-grid");
  const titelEl = document.getElementById("kalender-monat-jahr");
  if (!grid || !titelEl) return;
  grid.innerHTML = "";

  const wochentage = wochentageAb(kalenderWochenStart);

  // Für den Monat/Jahr-Titel den Donnerstag der Woche heranziehen (ISO-
  // Konvention), damit eine Woche, die über einen Monatswechsel läuft,
  // dem Monat zugeordnet wird, der den Großteil der Woche trägt.
  const titelText = wochentage[3].toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  titelEl.textContent = titelText.charAt(0).toUpperCase() + titelText.slice(1);

  const heuteIso = heuteISO();

  const kopfzeile = document.createElement("div");
  kopfzeile.className = "week-grid__row week-grid__row--head";
  kopfzeile.appendChild(document.createElement("div")).className = "week-grid__slot-label";

  wochentage.forEach((datum, i) => {
    const tagZelle = document.createElement("div");
    tagZelle.className = "week-grid__day";
    if (datumZuISO(datum) === heuteIso) tagZelle.classList.add("is-today");

    const kuerzel = document.createTextNode(`${KALENDER_TAG_KUERZEL[i]} `);
    const nummer = document.createElement("span");
    nummer.textContent = String(datum.getDate());

    tagZelle.append(kuerzel, nummer);
    kopfzeile.appendChild(tagZelle);
  });
  grid.appendChild(kopfzeile);

  let kalender = [];
  try {
    kalender = await ladeJSON("./data/kalender.json");
  } catch (fehler) {
    console.warn("Kalender konnte nicht geladen werden:", fehler);
  }

  const wochenIsoSet = new Set(wochentage.map(datumZuISO));
  const eintraegeWoche = kalender.filter((eintrag) => wochenIsoSet.has(eintrag.datum));

  const rezeptIds = [...new Set(eintraegeWoche.map((eintrag) => eintrag.rezept_id))];
  const rezepteMap = new Map();
  await Promise.all(
    rezeptIds.map(async (id) => {
      try {
        rezepteMap.set(id, await ladeRezeptGecacht(id));
      } catch (fehler) {
        console.warn(`Rezept ${id} konnte nicht geladen werden:`, fehler);
      }
    })
  );

  KALENDER_SLOTS.forEach((slot) => {
    const zeile = document.createElement("div");
    zeile.className = "week-grid__row";

    const label = document.createElement("div");
    label.className = "week-grid__slot-label";
    label.textContent = SLOT_LABELS[slot] || slot;
    zeile.appendChild(label);

    wochentage.forEach((datum) => {
      const iso = datumZuISO(datum);
      const zelle = document.createElement("div");
      zelle.className = "week-grid__cell";

      const eintrag = eintraegeWoche.find((e) => e.datum === iso && e.slot === slot);
      const rezept = eintrag && rezepteMap.get(eintrag.rezept_id);

      if (eintrag && rezept) {
        zelle.appendChild(erstelleKalenderChip(eintrag, rezept));
      } else {
        const leer = document.createElement("div");
        leer.className = "week-grid__cell--empty";
        zelle.appendChild(leer);
      }
      zeile.appendChild(zelle);
    });

    grid.appendChild(zeile);
  });
}

function oeffneKalenderOverlay(eintrag, rezept) {
  aktuellerKalenderEintrag = eintrag;

  const iconEl = document.getElementById("kalender-overlay-icon");
  iconEl.innerHTML = "";
  if (rezept.icon) {
    const img = document.createElement("img");
    img.src = rezept.icon;
    img.alt = "";
    img.addEventListener("error", () => img.remove());
    iconEl.appendChild(img);
  }

  document.getElementById("kalender-overlay-name").textContent = rezept.name;
  document.getElementById("kalender-overlay-portionen").textContent = eintrag.portionen
    ? `${eintrag.portionen} Portionen`
    : "";
  document.getElementById("kalender-eintrag-overlay").hidden = false;
}

function schliesseKalenderOverlay() {
  document.getElementById("kalender-eintrag-overlay").hidden = true;
  aktuellerKalenderEintrag = null;
}

document.querySelectorAll("[data-close-kalender-overlay]").forEach((el) => {
  el.addEventListener("click", schliesseKalenderOverlay);
});

document.getElementById("kalender-overlay-kochmodus").addEventListener("click", () => {
  if (aktuellerKalenderEintrag) {
    ausgewaehlteRezeptId = aktuellerKalenderEintrag.rezept_id;
  }
  schliesseKalenderOverlay();
  oeffneKochmodus();
});

document.getElementById("kalender-woche-zurueck").addEventListener("click", () => {
  kalenderWochenStart.setDate(kalenderWochenStart.getDate() - 7);
  renderKalenderWoche();
});

document.getElementById("kalender-woche-vor").addEventListener("click", () => {
  kalenderWochenStart.setDate(kalenderWochenStart.getDate() + 7);
  renderKalenderWoche();
});

renderKalenderWoche();

// ---------- Home ----------

function erstelleIconElement(pfad, fallbackKlasse) {
  const wrap = document.createElement("div");
  wrap.className = fallbackKlasse;

  function zeigeFallback() {
    wrap.innerHTML = "";
    const fallback = document.createElement("span");
    fallback.className = "meal-card__icon-fallback";
    fallback.textContent = "🍽️";
    wrap.appendChild(fallback);
  }

  if (pfad) {
    const img = document.createElement("img");
    img.src = pfad;
    img.alt = "";
    img.addEventListener("error", zeigeFallback);
    wrap.appendChild(img);
  } else {
    zeigeFallback();
  }
  return wrap;
}

function erstelleMealCard(eintrag, rezept) {
  const farbe = eintrag.typ === "mealprep" ? "orange" : "blue";
  const card = document.createElement("article");
  card.className = `meal-card meal-card--${farbe}`;

  const slot = document.createElement("span");
  slot.className = "meal-card__slot";
  slot.textContent = SLOT_LABELS[eintrag.slot] || eintrag.slot;

  const titel = document.createElement("span");
  titel.className = "meal-card__title";
  titel.textContent = rezept.name;

  card.appendChild(erstelleIconElement(rezept.icon, "meal-card__icon"));
  card.append(slot, titel);
  return card;
}

async function renderHeuteGeplant() {
  const container = document.getElementById("home-today-cards");
  if (!container) return;
  container.innerHTML = "";

  let kalender = [];
  try {
    kalender = await ladeJSON("./data/kalender.json");
  } catch (fehler) {
    console.warn("Kalender konnte nicht geladen werden:", fehler);
  }

  const eintraegeHeute = kalender.filter((eintrag) => eintrag.datum === heuteISO());

  if (eintraegeHeute.length === 0) {
    const leer = document.createElement("div");
    leer.className = "today-empty";
    leer.textContent = "Heute nichts geplant";
    container.appendChild(leer);
    return;
  }

  const geladen = await Promise.all(
    eintraegeHeute.map(async (eintrag) => {
      try {
        return { eintrag, rezept: await ladeRezept(eintrag.rezept_id) };
      } catch (fehler) {
        console.warn(`Rezept ${eintrag.rezept_id} konnte nicht geladen werden:`, fehler);
        return null;
      }
    })
  );

  geladen.filter(Boolean).forEach(({ eintrag, rezept }) => {
    container.appendChild(erstelleMealCard(eintrag, rezept));
  });
}

function formatiereSeitGekocht(tage) {
  if (tage === Infinity) return "Noch nie gekocht";
  if (tage < 1) return "Heute gekocht";
  if (tage < 7) return `Seit ${tage} ${tage === 1 ? "Tag" : "Tagen"} nicht gekocht`;
  const wochen = Math.floor(tage / 7);
  return `Seit ${wochen} ${wochen === 1 ? "Woche" : "Wochen"} nicht gekocht`;
}

function erstelleTippBox(rezept, tageSeit) {
  const box = document.createElement("div");
  box.className = "tip-box";

  const kreis = document.createElement("div");
  kreis.className = "tip-box__icon-circle";
  kreis.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.5.4.8 1 .8 1.6v.5h5.4v-.5c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3Z"/></svg>';

  const trenner = document.createElement("div");
  trenner.className = "tip-box__divider";

  const thumb = erstelleIconElement(rezept.icon, "tip-box__thumb");

  const body = document.createElement("div");
  body.className = "tip-box__body";

  const label = document.createElement("span");
  label.className = "tip-box__label";
  label.textContent = "Tipp";

  const name = document.createElement("span");
  name.className = "tip-box__name";
  name.textContent = rezept.name;

  const sub = document.createElement("span");
  sub.className = "tip-box__sub";
  sub.textContent = formatiereSeitGekocht(tageSeit);

  body.append(label, name, sub);
  box.append(kreis, trenner, thumb, body);
  return box;
}

async function renderTipp() {
  const container = document.getElementById("home-tip-box");
  if (!container) return;
  container.innerHTML = "";

  let ids = [];
  try {
    ids = await ladeJSON("./data/rezepte/index.json");
  } catch (fehler) {
    console.warn("Rezept-Index konnte nicht geladen werden:", fehler);
  }

  const rezepte = ids.length
    ? (
        await Promise.all(
          ids.map(async (id) => {
            try {
              return await ladeRezept(id);
            } catch (fehler) {
              console.warn(`Rezept ${id} konnte nicht geladen werden:`, fehler);
              return null;
            }
          })
        )
      ).filter(Boolean)
    : [];

  if (rezepte.length === 0) {
    const hinweis = document.createElement("p");
    hinweis.className = "empty-hint";
    hinweis.textContent = "Noch keine Rezepte vorhanden.";
    container.appendChild(hinweis);
    return;
  }

  let protokoll = [];
  try {
    protokoll = await ladeJSON("./data/kochprotokoll.json");
  } catch (fehler) {
    console.warn("Kochprotokoll konnte nicht geladen werden:", fehler);
  }

  const heute = new Date();

  const bewertet = rezepte.map((rezept) => {
    const eintraege = protokoll.filter((p) => p.rezept_id === rezept.id);
    let letztesDatum = null;
    eintraege.forEach((eintrag) => {
      const datum = new Date(eintrag.datum);
      if (!letztesDatum || datum > letztesDatum) letztesDatum = datum;
    });
    const tageSeit = letztesDatum ? Math.round((heute - letztesDatum) / 86400000) : Infinity;
    const positiv = eintraege.filter((e) => e.bewertung === "positiv").length;
    const negativ = eintraege.filter((e) => e.bewertung === "negativ").length;
    const positivQuote = positiv + negativ > 0 ? positiv / (positiv + negativ) : 0.5;
    return { rezept, tageSeit, positivQuote };
  });

  bewertet.sort((a, b) => b.tageSeit - a.tageSeit || b.positivQuote - a.positivQuote);

  const top = bewertet[0];
  container.appendChild(erstelleTippBox(top.rezept, top.tageSeit));
}

function renderBegruessungsdatum() {
  const el = document.getElementById("home-date");
  if (!el) return;
  const text = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  el.textContent = text.charAt(0).toUpperCase() + text.slice(1);
}

renderBegruessungsdatum();
renderHeuteGeplant();
renderTipp();

// ---------- Rezepte ----------

// Freundliche Labels für Filter-Chip-Werte. Werte ohne Eintrag hier werden
// mit großem Anfangsbuchstaben angezeigt (siehe labelFuerFilterwert).
const REZEPTE_FILTER_LABELS = {
  typ: { mealprep: "Mealprep", normal: "Normal" },
  mahlzeit: SLOT_LABELS,
  schwierigkeit: { leicht: "Leicht", mittel: "Mittel", schwer: "Schwer" },
};

// Kategorien für die Filter-Chip-Zeile: key = Zustandsfeld in
// rezepteFilterState, feld = Rezept-Eigenschaft, mehrfach = ob die
// Eigenschaft ein Array ist (mehrere Werte pro Rezept) oder ein einzelner
// String.
const REZEPTE_FILTER_KATEGORIEN = [
  { key: "typ", feld: "typ", mehrfach: false },
  { key: "mahlzeit", feld: "mahlzeiten", mehrfach: true },
  { key: "schwierigkeit", feld: "schwierigkeit", mehrfach: false },
  { key: "geschmack", feld: "geschmack_tags", mehrfach: true },
  { key: "ernaehrungsform", feld: "ernaehrungsform", mehrfach: true },
];

let alleRezepte = [];
let rezepteProtokoll = [];
let ausgewaehlteRezeptId = null;

const rezepteFilterState = {
  typ: new Set(),
  mahlzeit: new Set(),
  schwierigkeit: new Set(),
  geschmack: new Set(),
  ernaehrungsform: new Set(),
};

function labelFuerFilterwert(kategorie, wert) {
  const karte = REZEPTE_FILTER_LABELS[kategorie];
  if (karte && karte[wert]) return karte[wert];
  return wert.charAt(0).toUpperCase() + wert.slice(1);
}

function erstelleMetaZeile(rezept) {
  const meta = document.createElement("div");
  meta.className = "recipe-card__meta";

  const teile = [];
  if (rezept.kochzeit_minuten != null) {
    teile.push({
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
      text: `${rezept.kochzeit_minuten} Min`,
    });
  }
  if (rezept.basisportionen != null) {
    teile.push({
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c1-3 3-4.5 5.5-4.5s4.5 1.5 5.5 4.5"/><circle cx="17" cy="9" r="2.3"/><path d="M15.5 14.2c1.8.4 3 1.7 3.7 3.8"/></svg>',
      text: `${rezept.basisportionen} Portionen`,
    });
  }

  teile.forEach((teil, i) => {
    if (i > 0) meta.appendChild(document.createTextNode(" · "));
    const span = document.createElement("span");
    span.className = "recipe-card__meta-item";
    span.innerHTML = `${teil.icon}${teil.text}`;
    meta.appendChild(span);
  });

  return meta;
}

function erstelleRezeptCard(rezept, { suggestion = false } = {}) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = suggestion ? "recipe-card recipe-card--suggestion" : "recipe-card";

  const photo = document.createElement("div");
  photo.className = "recipe-card__photo";
  if (rezept.foto) {
    const img = document.createElement("img");
    img.src = rezept.foto;
    img.alt = "";
    img.addEventListener("error", () => img.remove());
    photo.appendChild(img);
  }

  const badge = document.createElement("span");
  badge.className = "recipe-card__badge";
  if (rezept.icon) {
    const img = document.createElement("img");
    img.src = rezept.icon;
    img.alt = "";
    img.addEventListener("error", () => img.remove());
    badge.appendChild(img);
  }
  photo.appendChild(badge);

  const body = document.createElement("div");
  body.className = "recipe-card__body";

  const name = document.createElement("span");
  name.className = "recipe-card__name";
  name.textContent = rezept.name;

  body.append(name, erstelleMetaZeile(rezept));
  card.append(photo, body);

  card.addEventListener("click", () => {
    ausgewaehlteRezeptId = rezept.id;
    zeigeScreen("rezept-detail");
    renderRezeptDetail();
  });

  return card;
}

function rezeptPasstZuSuche(rezept, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  if (rezept.name && rezept.name.toLowerCase().includes(q)) return true;
  return (rezept.zutaten || []).some((zutat) => (zutat.anzeige_text || "").toLowerCase().includes(q));
}

function rezeptPasstZuFiltern(rezept) {
  return REZEPTE_FILTER_KATEGORIEN.every(({ key, feld, mehrfach }) => {
    const ausgewaehlt = rezepteFilterState[key];
    if (ausgewaehlt.size === 0) return true;
    if (mehrfach) {
      return (rezept[feld] || []).some((wert) => ausgewaehlt.has(wert));
    }
    return ausgewaehlt.has(rezept[feld]);
  });
}

function renderRezeptGrid(rezepte) {
  const grid = document.getElementById("rezepte-alle-grid");
  const keineTreffer = document.getElementById("rezepte-keine-treffer");
  if (!grid || !keineTreffer) return;
  grid.innerHTML = "";

  if (rezepte.length === 0) {
    keineTreffer.hidden = false;
    return;
  }
  keineTreffer.hidden = true;
  rezepte.forEach((rezept) => grid.appendChild(erstelleRezeptCard(rezept)));
}

function wendeRezepteFilterAn() {
  const sucheEl = document.getElementById("rezepte-suche");
  const query = sucheEl ? sucheEl.value.trim() : "";
  const gefiltert = alleRezepte.filter(
    (rezept) => rezeptPasstZuSuche(rezept, query) && rezeptPasstZuFiltern(rezept)
  );
  renderRezeptGrid(gefiltert);
}

function renderRezepteFilterChips() {
  const container = document.getElementById("rezepte-filter-chips");
  if (!container) return;
  container.innerHTML = "";

  REZEPTE_FILTER_KATEGORIEN.forEach(({ key, feld, mehrfach }) => {
    const werte = mehrfach
      ? [...new Set(alleRezepte.flatMap((rezept) => rezept[feld] || []))]
      : [...new Set(alleRezepte.map((rezept) => rezept[feld]).filter(Boolean))];

    werte.forEach((wert) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "filter-chip";
      chip.textContent = labelFuerFilterwert(key, wert);
      chip.addEventListener("click", () => {
        const ausgewaehlt = rezepteFilterState[key];
        if (ausgewaehlt.has(wert)) {
          ausgewaehlt.delete(wert);
        } else {
          ausgewaehlt.add(wert);
        }
        chip.classList.toggle("is-active");
        wendeRezepteFilterAn();
      });
      container.appendChild(chip);
    });
  });
}

// Gleiche Logik wie die Tipp-Box auf Home (längste Zeit nicht gekocht,
// positive Bewertung als Tiebreaker), hier aber als Liste statt Einzeltreffer.
function berechneKochVorschlaege(rezepte, protokoll, anzahl) {
  const heute = new Date();

  const bewertet = rezepte.map((rezept) => {
    const eintraege = protokoll.filter((p) => p.rezept_id === rezept.id);
    let letztesDatum = null;
    eintraege.forEach((eintrag) => {
      const datum = new Date(eintrag.datum);
      if (!letztesDatum || datum > letztesDatum) letztesDatum = datum;
    });
    const tageSeit = letztesDatum ? Math.round((heute - letztesDatum) / 86400000) : Infinity;
    const positiv = eintraege.filter((e) => e.bewertung === "positiv").length;
    const negativ = eintraege.filter((e) => e.bewertung === "negativ").length;
    const positivQuote = positiv + negativ > 0 ? positiv / (positiv + negativ) : 0.5;
    return { rezept, tageSeit, positivQuote };
  });

  bewertet.sort((a, b) => b.tageSeit - a.tageSeit || b.positivQuote - a.positivQuote);
  return bewertet.slice(0, anzahl).map((b) => b.rezept);
}

function renderRezepteVorschlaege() {
  const section = document.getElementById("rezepte-vorschlaege-section");
  const grid = document.getElementById("rezepte-vorschlaege-grid");
  if (!section || !grid) return;
  grid.innerHTML = "";

  const vorschlaege = berechneKochVorschlaege(alleRezepte, rezepteProtokoll, Math.min(4, alleRezepte.length));
  if (vorschlaege.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  vorschlaege.forEach((rezept) => grid.appendChild(erstelleRezeptCard(rezept, { suggestion: true })));
}

async function renderRezepteScreen() {
  const leerHinweis = document.getElementById("rezepte-leer-hinweis");
  const inhalt = document.getElementById("rezepte-inhalt");
  if (!leerHinweis || !inhalt) return;

  let ids = [];
  try {
    ids = await ladeJSON("./data/rezepte/index.json");
  } catch (fehler) {
    console.warn("Rezept-Index konnte nicht geladen werden:", fehler);
  }

  alleRezepte = ids.length
    ? (
        await Promise.all(
          ids.map(async (id) => {
            try {
              return await ladeRezeptGecacht(id);
            } catch (fehler) {
              console.warn(`Rezept ${id} konnte nicht geladen werden:`, fehler);
              return null;
            }
          })
        )
      ).filter(Boolean)
    : [];

  if (alleRezepte.length === 0) {
    leerHinweis.hidden = false;
    inhalt.hidden = true;
    return;
  }

  leerHinweis.hidden = true;
  inhalt.hidden = false;

  try {
    rezepteProtokoll = await ladeJSON("./data/kochprotokoll.json");
  } catch (fehler) {
    console.warn("Kochprotokoll konnte nicht geladen werden:", fehler);
    rezepteProtokoll = [];
  }

  renderRezepteFilterChips();
  renderRezepteVorschlaege();
  wendeRezepteFilterAn();
}

document.getElementById("rezepte-suche")?.addEventListener("input", wendeRezepteFilterAn);

renderRezepteScreen();

// ---------- Rezept-Detail ----------

let rezeptDetailAktuellesRezept = null;
let rezeptDetailAktuellePortionen = 1;
let zutatenKarte = null;
let kalenderHinweisTimeout = null;

async function ladeZutatenKarte() {
  if (zutatenKarte) return zutatenKarte;
  let liste = [];
  try {
    liste = await ladeJSON("./data/zutaten.json");
  } catch (fehler) {
    console.warn("Zutaten-Bibliothek konnte nicht geladen werden:", fehler);
  }
  zutatenKarte = new Map(liste.map((zutat) => [zutat.id, zutat]));
  return zutatenKarte;
}

function formatiereMenge(betrag, einheit) {
  let anzeigeBetrag;
  if (einheit === "Stück") {
    anzeigeBetrag = Math.round(betrag);
  } else if (betrag < 10) {
    anzeigeBetrag = Math.round(betrag * 10) / 10;
  } else {
    anzeigeBetrag = Math.round(betrag);
  }
  return `${anzeigeBetrag} ${einheit}`;
}

function skaliertesMengeText(zutat, faktor) {
  if (!zutat.menge || typeof zutat.menge.betrag !== "number") {
    return zutat.anzeige_text || "";
  }
  return formatiereMenge(zutat.menge.betrag * faktor, zutat.menge.einheit);
}

function extrahiereZutatName(zutat) {
  if (zutat.zutat_id) {
    return zutat.zutat_id
      .split("-")
      .map((wort) => wort.charAt(0).toUpperCase() + wort.slice(1))
      .join(" ");
  }
  return zutat.anzeige_text || "Zutat";
}

function erstelleZutatZeile(zutat, faktor, karte) {
  const li = document.createElement("li");
  li.className = "ingredient-list__item";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  li.appendChild(checkbox);

  const thumb = document.createElement("div");
  thumb.className = "ingredient-list__thumb";
  const zutatInfo = zutat.zutat_id ? karte.get(zutat.zutat_id) : null;

  function zeigeThumbFallback() {
    thumb.innerHTML = "";
    const fallback = document.createElement("span");
    fallback.className = "ingredient-list__thumb-fallback";
    fallback.textContent = "🥕";
    thumb.appendChild(fallback);
  }

  if (zutatInfo && zutatInfo.bild) {
    const img = document.createElement("img");
    img.src = zutatInfo.bild;
    img.alt = "";
    img.addEventListener("error", zeigeThumbFallback);
    thumb.appendChild(img);
  } else {
    zeigeThumbFallback();
  }
  li.appendChild(thumb);

  const name = document.createElement("span");
  name.className = "ingredient-list__name";
  name.textContent = (zutatInfo && zutatInfo.name) || extrahiereZutatName(zutat);
  li.appendChild(name);

  const menge = document.createElement("span");
  menge.className = "ingredient-list__amount";
  menge.textContent = skaliertesMengeText(zutat, faktor);
  li.appendChild(menge);

  return li;
}

async function renderRezeptDetailZutaten() {
  const liste = document.getElementById("rezept-detail-zutaten");
  const portionenWertEl = document.getElementById("rezept-detail-portionen-wert");
  if (!liste || !portionenWertEl || !rezeptDetailAktuellesRezept) return;

  portionenWertEl.textContent = rezeptDetailAktuellePortionen;

  const karte = await ladeZutatenKarte();
  const basis = rezeptDetailAktuellesRezept.basisportionen || 1;
  const faktor = rezeptDetailAktuellePortionen / basis;

  liste.innerHTML = "";
  (rezeptDetailAktuellesRezept.zutaten || []).forEach((zutat) => {
    liste.appendChild(erstelleZutatZeile(zutat, faktor, karte));
  });
}

async function renderRezeptDetail() {
  const leerHinweis = document.getElementById("rezept-detail-leer-hinweis");
  const inhalt = document.getElementById("rezept-detail-inhalt");
  if (!leerHinweis || !inhalt) return;

  if (!ausgewaehlteRezeptId) {
    leerHinweis.hidden = false;
    inhalt.hidden = true;
    return;
  }

  let rezept;
  try {
    rezept = await ladeRezeptGecacht(ausgewaehlteRezeptId);
  } catch (fehler) {
    console.warn(`Rezept ${ausgewaehlteRezeptId} konnte nicht geladen werden:`, fehler);
    leerHinweis.textContent = "Rezept konnte nicht geladen werden.";
    leerHinweis.hidden = false;
    inhalt.hidden = true;
    return;
  }

  leerHinweis.hidden = true;
  inhalt.hidden = false;

  rezeptDetailAktuellesRezept = rezept;
  rezeptDetailAktuellePortionen = rezept.basisportionen || 1;

  const fotoEl = document.getElementById("rezept-detail-foto");
  fotoEl.innerHTML = "";
  if (rezept.foto) {
    const img = document.createElement("img");
    img.src = rezept.foto;
    img.alt = "";
    img.addEventListener("error", () => img.remove());
    fotoEl.appendChild(img);
  }

  document.getElementById("rezept-detail-titel").textContent = rezept.name;
  document.getElementById("rezept-detail-beschreibung").textContent = rezept.kurzbeschreibung || "";
  document.getElementById("rezept-detail-kalender-hinweis").hidden = true;

  await renderRezeptDetailZutaten();
}

document.getElementById("rezept-detail-portionen-minus")?.addEventListener("click", () => {
  if (rezeptDetailAktuellePortionen > 1) {
    rezeptDetailAktuellePortionen -= 1;
    renderRezeptDetailZutaten();
  }
});

document.getElementById("rezept-detail-portionen-plus")?.addEventListener("click", () => {
  rezeptDetailAktuellePortionen += 1;
  renderRezeptDetailZutaten();
});

function formatiereDatumLesbar(iso) {
  const datum = new Date(`${iso}T00:00:00`);
  const text = datum.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function oeffneKalenderHinzufuegenOverlay() {
  if (!rezeptDetailAktuellesRezept) return;

  const datumInput = document.getElementById("kalender-hinzufuegen-datum");
  const slotSelect = document.getElementById("kalender-hinzufuegen-slot");
  const portionenInput = document.getElementById("kalender-hinzufuegen-portionen");
  const hinweis = document.getElementById("kalender-hinzufuegen-hinweis");

  datumInput.value = heuteISO();

  slotSelect.innerHTML = "";
  KALENDER_SLOTS.forEach((slot) => {
    const option = document.createElement("option");
    option.value = slot;
    option.textContent = SLOT_LABELS[slot] || slot;
    slotSelect.appendChild(option);
  });
  slotSelect.value = "mittag";

  portionenInput.value = rezeptDetailAktuellePortionen;

  hinweis.hidden = true;
  hinweis.classList.remove("recipe-detail__kalender-hinweis--fehler");

  document.getElementById("kalender-hinzufuegen-overlay").hidden = false;
}

function schliesseKalenderHinzufuegenOverlay() {
  document.getElementById("kalender-hinzufuegen-overlay").hidden = true;
}

document.getElementById("rezept-detail-kalender-btn")?.addEventListener("click", oeffneKalenderHinzufuegenOverlay);

document.querySelectorAll("[data-close-kalender-hinzufuegen]").forEach((el) => {
  el.addEventListener("click", schliesseKalenderHinzufuegenOverlay);
});

document.getElementById("kalender-hinzufuegen-abbrechen")?.addEventListener("click", schliesseKalenderHinzufuegenOverlay);

document.getElementById("kalender-hinzufuegen-bestaetigen")?.addEventListener("click", async () => {
  const rezept = rezeptDetailAktuellesRezept;
  const btn = document.getElementById("kalender-hinzufuegen-bestaetigen");
  const hinweis = document.getElementById("kalender-hinzufuegen-hinweis");
  if (!rezept || !btn || !hinweis) return;

  const datum = document.getElementById("kalender-hinzufuegen-datum").value;
  const slot = document.getElementById("kalender-hinzufuegen-slot").value;
  const portionenRoh = parseInt(document.getElementById("kalender-hinzufuegen-portionen").value, 10);
  const portionen = Number.isFinite(portionenRoh) && portionenRoh > 0 ? portionenRoh : rezept.basisportionen || 1;

  if (!datum || !slot) {
    hinweis.textContent = "Bitte Datum und Slot wählen.";
    hinweis.classList.add("recipe-detail__kalender-hinweis--fehler");
    hinweis.hidden = false;
    return;
  }

  btn.disabled = true;
  hinweis.classList.remove("recipe-detail__kalender-hinweis--fehler");
  hinweis.textContent = "Wird gespeichert …";
  hinweis.hidden = false;

  const neuerEintrag = {
    id: `k-${Date.now().toString(36)}`,
    rezept_id: rezept.id,
    datum,
    slot,
    typ: rezept.typ || "normal",
    portionen,
    ist_kochtag: true,
    kochtag_id: null,
    gesamtportionen: portionen,
    uebersprungen: false,
  };

  try {
    await aktualisiereGitHubJSON(
      "data/kalender.json",
      (aktuelleListe) => {
        const belegt = aktuelleListe.some((eintrag) => eintrag.datum === datum && eintrag.slot === slot);
        if (belegt) {
          throw new Error(
            `Für ${formatiereDatumLesbar(datum)} ${SLOT_LABELS[slot] || slot} ist schon etwas geplant.`
          );
        }
        return [...aktuelleListe, neuerEintrag];
      },
      `Kalender: ${rezept.name} hinzufügen (${datum}, ${SLOT_LABELS[slot] || slot})`
    );

    schliesseKalenderHinzufuegenOverlay();

    const detailHinweis = document.getElementById("rezept-detail-kalender-hinweis");
    detailHinweis.classList.remove("recipe-detail__kalender-hinweis--fehler");
    detailHinweis.textContent = `Zum Kalender hinzugefügt (${formatiereDatumLesbar(datum)}, ${SLOT_LABELS[slot] || slot}).`;
    detailHinweis.hidden = false;
    clearTimeout(kalenderHinweisTimeout);
    kalenderHinweisTimeout = setTimeout(() => {
      detailHinweis.hidden = true;
    }, 4000);
  } catch (fehler) {
    console.warn("Kalender-Eintrag konnte nicht gespeichert werden:", fehler);
    hinweis.textContent = fehler.message || "Fehler beim Speichern.";
    hinweis.classList.add("recipe-detail__kalender-hinweis--fehler");
  } finally {
    btn.disabled = false;
  }
});

renderRezeptDetail();

// ---------- Kochmodus ----------

let kochmodusRezept = null;
let kochmodusSchrittIndex = 0;
let technikenKarte = null;

async function ladeTechnikenKarte() {
  if (technikenKarte) return technikenKarte;
  let liste = [];
  try {
    liste = await ladeJSON("./data/techniken.json");
  } catch (fehler) {
    console.warn("Techniken-Bibliothek konnte nicht geladen werden:", fehler);
  }
  technikenKarte = new Map(liste.map((technik) => [technik.id, technik]));
  return technikenKarte;
}

function humanisiereId(id) {
  return id
    .split("-")
    .map((wort) => wort.charAt(0).toUpperCase() + wort.slice(1))
    .join(" ");
}

function erstelleKochmodusZutatZeile(zutatId, zutatInfo) {
  const li = document.createElement("li");
  li.className = "ingredient-list__item";

  const thumb = document.createElement("div");
  thumb.className = "ingredient-list__thumb";

  function zeigeFallback() {
    thumb.innerHTML = "";
    const fallback = document.createElement("span");
    fallback.className = "ingredient-list__thumb-fallback";
    fallback.textContent = "🥕";
    thumb.appendChild(fallback);
  }

  if (zutatInfo && zutatInfo.bild) {
    const img = document.createElement("img");
    img.src = zutatInfo.bild;
    img.alt = "";
    img.addEventListener("error", zeigeFallback);
    thumb.appendChild(img);
  } else {
    zeigeFallback();
  }
  li.appendChild(thumb);

  const name = document.createElement("span");
  name.className = "ingredient-list__name";
  name.textContent = (zutatInfo && zutatInfo.name) || humanisiereId(zutatId);
  li.appendChild(name);

  return li;
}

function renderKochmodusOverview() {
  const container = document.getElementById("kochmodus-overview-list");
  if (!container || !kochmodusRezept) return;
  container.innerHTML = "";

  (kochmodusRezept.schritte || []).forEach((schritt, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "kochmodus__overview-item";
    if (index === kochmodusSchrittIndex) {
      btn.classList.add("is-current");
    } else if (index < kochmodusSchrittIndex) {
      btn.classList.add("is-done");
    }

    const marker = document.createElement("span");
    marker.className = "kochmodus__overview-item__marker";
    marker.textContent = index < kochmodusSchrittIndex ? "✓" : String(index + 1);

    const text = document.createElement("span");
    text.className = "kochmodus__overview-item__text";
    text.textContent = schritt.text;

    btn.append(marker, text);
    btn.addEventListener("click", () => {
      kochmodusSchrittIndex = index;
      renderKochmodusSchritt();
    });
    container.appendChild(btn);
  });
}

async function renderKochmodusSchritt() {
  const navEl = document.getElementById("kochmodus-nav");
  const labelEl = document.getElementById("kochmodus-step-label");
  const textEl = document.getElementById("kochmodus-step-text");
  const fotoEl = document.getElementById("kochmodus-step-photo");
  const technikBtn = document.getElementById("kochmodus-technik-btn");
  const ingredientsSection = document.getElementById("kochmodus-ingredients-section");
  const ingredientsList = document.getElementById("kochmodus-ingredients-list");
  const balken = document.getElementById("kochmodus-progress-bar");
  if (!kochmodusRezept) return;

  const schritte = kochmodusRezept.schritte || [];

  if (schritte.length === 0) {
    labelEl.textContent = "";
    textEl.textContent = "Für dieses Rezept sind noch keine Zubereitungsschritte hinterlegt.";
    fotoEl.innerHTML = "";
    technikBtn.hidden = true;
    ingredientsSection.hidden = true;
    document.getElementById("kochmodus-overview-list").innerHTML = "";
    balken.style.width = "0%";
    navEl.hidden = true;
    return;
  }

  navEl.hidden = false;
  const anzahl = schritte.length;
  const schritt = schritte[kochmodusSchrittIndex];

  labelEl.textContent = `Schritt ${kochmodusSchrittIndex + 1}/${anzahl}`;
  textEl.textContent = schritt.text;

  fotoEl.innerHTML = "";
  if (schritt.foto) {
    const img = document.createElement("img");
    img.src = schritt.foto;
    img.alt = "";
    img.addEventListener("error", () => img.remove());
    fotoEl.appendChild(img);
  }

  if (schritt.technik_id) {
    technikBtn.hidden = false;
    technikBtn.dataset.technikId = schritt.technik_id;
    const karte = await ladeTechnikenKarte();
    const technik = karte.get(schritt.technik_id);
    technikBtn.textContent = `ℹ️ Technik: ${technik ? technik.name : humanisiereId(schritt.technik_id)}`;
  } else {
    technikBtn.hidden = true;
    delete technikBtn.dataset.technikId;
  }

  const zutatenIds = schritt.zutaten_ids || [];
  ingredientsList.innerHTML = "";
  if (zutatenIds.length > 0) {
    ingredientsSection.hidden = false;
    const zKarte = await ladeZutatenKarte();
    zutatenIds.forEach((zid) => {
      ingredientsList.appendChild(erstelleKochmodusZutatZeile(zid, zKarte.get(zid)));
    });
  } else {
    ingredientsSection.hidden = true;
  }

  renderKochmodusOverview();
  balken.style.width = `${((kochmodusSchrittIndex + 1) / anzahl) * 100}%`;

  document.getElementById("kochmodus-zurueck-btn").disabled = kochmodusSchrittIndex === 0;
  document.getElementById("kochmodus-weiter-btn").textContent =
    kochmodusSchrittIndex === anzahl - 1 ? "Fertig" : "Weiter";
}

async function renderKochmodus() {
  const leerHinweis = document.getElementById("kochmodus-leer-hinweis");
  const inhalt = document.getElementById("kochmodus-inhalt");
  const navEl = document.getElementById("kochmodus-nav");
  if (!leerHinweis || !inhalt || !navEl) return;

  if (!ausgewaehlteRezeptId) {
    leerHinweis.hidden = false;
    inhalt.hidden = true;
    navEl.hidden = true;
    document.getElementById("kochmodus-progress-bar").style.width = "0";
    return;
  }

  let rezept;
  try {
    rezept = await ladeRezeptGecacht(ausgewaehlteRezeptId);
  } catch (fehler) {
    console.warn(`Rezept ${ausgewaehlteRezeptId} konnte nicht geladen werden:`, fehler);
    leerHinweis.textContent = "Rezept konnte nicht geladen werden.";
    leerHinweis.hidden = false;
    inhalt.hidden = true;
    document.getElementById("kochmodus-progress-bar").style.width = "0";
    navEl.hidden = true;
    return;
  }

  leerHinweis.hidden = true;
  inhalt.hidden = false;

  kochmodusRezept = rezept;
  if (kochmodusSchrittIndex >= (rezept.schritte || []).length) kochmodusSchrittIndex = 0;

  await renderKochmodusSchritt();
}

document.getElementById("kochmodus-zurueck-btn")?.addEventListener("click", () => {
  if (kochmodusSchrittIndex > 0) {
    kochmodusSchrittIndex -= 1;
    renderKochmodusSchritt();
  }
});

document.getElementById("kochmodus-weiter-btn")?.addEventListener("click", () => {
  const anzahl = ((kochmodusRezept && kochmodusRezept.schritte) || []).length;
  if (anzahl > 0 && kochmodusSchrittIndex === anzahl - 1) {
    // Kein "erledigt"-Status am Kalender-Eintrag im Datenmodell (ergibt sich
    // aus dem Datum) - "Fertig" schließt den Kochmodus also einfach, ohne
    // etwas zu schreiben.
    schliesseKochmodus();
    return;
  }
  kochmodusSchrittIndex += 1;
  renderKochmodusSchritt();
});

document.getElementById("kochmodus-technik-btn")?.addEventListener("click", (event) => {
  const technikId = event.currentTarget.dataset.technikId;
  if (technikId) oeffneTechnikOverlay(technikId);
});

async function oeffneTechnikOverlay(technikId) {
  const karte = await ladeTechnikenKarte();
  const technik = karte.get(technikId);

  document.getElementById("technik-overlay-titel").textContent = technik ? technik.name : humanisiereId(technikId);

  const bildEl = document.getElementById("technik-overlay-bild");
  bildEl.innerHTML = "";
  if (technik && technik.bild) {
    const img = document.createElement("img");
    img.src = technik.bild;
    img.alt = "";
    img.addEventListener("error", () => img.remove());
    bildEl.appendChild(img);
  }

  const schritteListe = document.getElementById("technik-overlay-schritte");
  const leerEl = document.getElementById("technik-overlay-leer");
  schritteListe.innerHTML = "";

  if (technik && Array.isArray(technik.schritte) && technik.schritte.length > 0) {
    schritteListe.hidden = false;
    leerEl.hidden = true;
    technik.schritte.forEach((schrittText) => {
      const li = document.createElement("li");
      li.textContent = schrittText;
      schritteListe.appendChild(li);
    });
  } else {
    schritteListe.hidden = true;
    leerEl.hidden = false;
  }

  document.getElementById("technik-overlay").hidden = false;
}

document.querySelectorAll("[data-close-technik-overlay]").forEach((el) => {
  el.addEventListener("click", () => {
    document.getElementById("technik-overlay").hidden = true;
  });
});

// ---------- Einkaufsliste ----------

// Feste Kategorien-Reihenfolge + Anzeigenamen, passend zu den Kategorie-Werten
// in data/zutaten.json (siehe README/Technische Referenz).
const EINKAUFSLISTE_KATEGORIEN = [
  { key: "obst_gemuese", label: "Obst & Gemüse" },
  { key: "milchprodukte", label: "Milchprodukte" },
  { key: "fleisch_fisch", label: "Fleisch & Fisch" },
  { key: "backwaren", label: "Backwaren" },
  { key: "getraenke", label: "Getränke" },
  { key: "gewuerze_oele", label: "Gewürze & Öle" },
  { key: "tiefkuehl", label: "Tiefkühl" },
  { key: "vorraete", label: "Vorräte" },
  { key: "sonstiges", label: "Sonstiges" },
];

const EINKAUFSLISTE_ICONS = {
  obst_gemuese: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 12c0-4 3-7 7-7 1 3-1 5-3 6 3 0 5 2 5 5 0 3-3 5-6 5-4 0-7-3-7-7 0-1 .3-1.8 .8-2.6"/><path d="M13 5c1-1 2-1.5 3-1.5"/></svg>',
  milchprodukte: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6v3.5l2 3V20a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9.5l2-3V3Z"/><path d="M7.5 13h9"/></svg>',
  fleisch_fisch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4c3 0 6 3 6 6.5S17 19 13 19c-2 0-3-1-3-1s-4 2-5.5.5S6 14 6 14s-1-1-1-3c0-4 3.5-7 9-7Z"/><circle cx="15" cy="9" r="1" fill="currentColor" stroke="none"/></svg>',
  backwaren: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13c0-5 3.5-8 8-8s8 3 8 8-3 6-8 6-8-1-8-6Z"/><path d="M9 10v6M12 9v7M15 10v6"/></svg>',
  getraenke: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2h4l.5 4-1 1v13a1.5 1.5 0 0 1-1.5 1.5h0A1.5 1.5 0 0 1 10.5 20V7l-1-1L10 2Z"/><path d="M9.7 11h4.6"/></svg>',
  gewuerze_oele: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c2 3 5 6.5 5 10a5 5 0 0 1-10 0c0-3.5 3-7 5-10Z"/></svg>',
  tiefkuehl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M5 6.5l14 11M19 6.5 5 17.5"/><path d="M12 3l-2 2M12 3l2 2M12 21l-2-2M12 21l2-2M5 6.5l2.7.7M5 6.5l.7-2.7M19 6.5l-2.7.7M19 6.5l-.7-2.7M5 17.5l2.7-.7M5 17.5l.7 2.7M19 17.5l-2.7-.7M19 17.5l-.7 2.7"/></svg>',
  vorraete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="8" width="12" height="12" rx="2"/><path d="M9 8V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg>',
  sonstiges: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>',
};

// Umrechnung in eine gemeinsame Basiseinheit pro Dimension, damit z.B. g+kg
// oder ml+l addiert werden können. Einheiten außerhalb dieser Tabelle (sollte
// laut Datenmodell nicht vorkommen, da intern immer g/kg/ml/l/Stück
// gespeichert wird) bilden konservativ ihre eigene Dimension und werden nie
// mit etwas anderem zusammengerechnet.
const EINKAUFSLISTE_EINHEITEN = {
  g: { dimension: "gewicht", proBasis: 1 },
  kg: { dimension: "gewicht", proBasis: 1000 },
  ml: { dimension: "volumen", proBasis: 1 },
  l: { dimension: "volumen", proBasis: 1000 },
  Stück: { dimension: "stueck", proBasis: 1 },
};

function ermittleDimension(einheit) {
  return EINKAUFSLISTE_EINHEITEN[einheit] || { dimension: `einheit:${einheit}`, proBasis: 1 };
}

function formatiereAggregierteMenge(dimension, summeBasis, ursprungsEinheit) {
  if (dimension === "gewicht") {
    return summeBasis >= 1000 ? formatiereMenge(summeBasis / 1000, "kg") : formatiereMenge(summeBasis, "g");
  }
  if (dimension === "volumen") {
    return summeBasis >= 1000 ? formatiereMenge(summeBasis / 1000, "l") : formatiereMenge(summeBasis, "ml");
  }
  if (dimension === "stueck") {
    return formatiereMenge(summeBasis, "Stück");
  }
  return formatiereMenge(summeBasis, ursprungsEinheit);
}

const EINKAUFSLISTE_STORAGE_KEY = "brutzel-einkaufsliste-abgehakt";

function ladeAbgehakteZutaten() {
  try {
    const roh = localStorage.getItem(EINKAUFSLISTE_STORAGE_KEY);
    return roh ? new Set(JSON.parse(roh)) : new Set();
  } catch (fehler) {
    console.warn("Abhak-Status konnte nicht geladen werden:", fehler);
    return new Set();
  }
}

function speichereAbgehakteZutaten(set) {
  try {
    localStorage.setItem(EINKAUFSLISTE_STORAGE_KEY, JSON.stringify([...set]));
  } catch (fehler) {
    console.warn("Abhak-Status konnte nicht gespeichert werden:", fehler);
  }
}

let einkaufslisteAbgehakt = ladeAbgehakteZutaten();
let einkaufslisteModus = "woche";

function eintraegeImZeitraum(kalender, modus) {
  if (modus === "woche") {
    const tageIso = new Set(wochentageAb(montagDerWoche(new Date())).map(datumZuISO));
    return kalender.filter((eintrag) => tageIso.has(eintrag.datum));
  }
  if (modus === "frei") {
    const von = document.getElementById("einkaufsliste-von").value;
    const bis = document.getElementById("einkaufsliste-bis").value;
    if (!von || !bis) return [];
    return kalender.filter((eintrag) => eintrag.datum >= von && eintrag.datum <= bis);
  }
  if (modus === "alle") {
    const heute = heuteISO();
    return kalender.filter((eintrag) => eintrag.datum >= heute);
  }
  return [];
}

async function aggregiereEinkaufsliste(eintraege) {
  const rezeptIds = [...new Set(eintraege.map((eintrag) => eintrag.rezept_id))];
  const rezepteMap = new Map();
  await Promise.all(
    rezeptIds.map(async (id) => {
      try {
        rezepteMap.set(id, await ladeRezeptGecacht(id));
      } catch (fehler) {
        console.warn(`Rezept ${id} konnte nicht geladen werden:`, fehler);
      }
    })
  );

  const zutatenKarteGeladen = await ladeZutatenKarte();

  // Schlüssel = zutat_id (oder Name als Fallback) + Dimension, damit z.B.
  // "Zwiebel in Stück" und "Zwiebel in g" (unterschiedliche Dimension)
  // bewusst getrennte Zeilen bleiben statt falsch zusammengerechnet zu werden.
  const gruppen = new Map();

  eintraege.forEach((eintrag) => {
    const rezept = rezepteMap.get(eintrag.rezept_id);
    if (!rezept) return;
    const basis = rezept.basisportionen || 1;
    const faktor = (eintrag.portionen || basis) / basis;

    (rezept.zutaten || []).forEach((zutat) => {
      if (!zutat.menge || typeof zutat.menge.betrag !== "number") return;

      const dim = ermittleDimension(zutat.menge.einheit);
      const zutatSchluessel = zutat.zutat_id || `name:${(zutat.anzeige_text || "").toLowerCase()}`;
      const schluessel = `${zutatSchluessel}|${dim.dimension}`;

      const skalierterBetrag = zutat.menge.betrag * faktor;
      const betragInBasis = skalierterBetrag * dim.proBasis;

      if (!gruppen.has(schluessel)) {
        gruppen.set(schluessel, {
          schluessel,
          zutatId: zutat.zutat_id || null,
          fallbackName: extrahiereZutatName(zutat),
          dimension: dim.dimension,
          ursprungsEinheit: zutat.menge.einheit,
          summeBasis: 0,
        });
      }
      gruppen.get(schluessel).summeBasis += betragInBasis;
    });
  });

  return [...gruppen.values()].map((gruppe) => {
    const zutatInfo = gruppe.zutatId ? zutatenKarteGeladen.get(gruppe.zutatId) : null;
    return {
      schluessel: gruppe.schluessel,
      name: (zutatInfo && zutatInfo.name) || gruppe.fallbackName,
      kategorie: (zutatInfo && zutatInfo.kategorie) || "sonstiges",
      mengeText: formatiereAggregierteMenge(gruppe.dimension, gruppe.summeBasis, gruppe.ursprungsEinheit),
    };
  });
}

function erstelleEinkaufslisteZeile(artikel) {
  const li = document.createElement("li");
  li.className = "shopping-list__item";
  if (einkaufslisteAbgehakt.has(artikel.schluessel)) li.classList.add("is-checked");

  const checkbox = document.createElement("span");
  checkbox.className = "shopping-list__checkbox";
  checkbox.textContent = "✓";

  const name = document.createElement("span");
  name.className = "shopping-list__name";
  name.textContent = artikel.name;

  const menge = document.createElement("span");
  menge.className = "shopping-list__amount";
  menge.textContent = artikel.mengeText;

  li.append(checkbox, name, menge);

  li.addEventListener("click", () => {
    if (einkaufslisteAbgehakt.has(artikel.schluessel)) {
      einkaufslisteAbgehakt.delete(artikel.schluessel);
    } else {
      einkaufslisteAbgehakt.add(artikel.schluessel);
    }
    li.classList.toggle("is-checked");
    speichereAbgehakteZutaten(einkaufslisteAbgehakt);
  });

  return li;
}

function erstelleEinkaufslisteKategorieCard(kategorie, artikel) {
  const card = document.createElement("div");
  card.className = "shopping-list__category";

  const header = document.createElement("div");
  header.className = "shopping-list__header";

  const iconWrap = document.createElement("div");
  iconWrap.className = "shopping-list__icon";
  iconWrap.innerHTML = EINKAUFSLISTE_ICONS[kategorie.key] || EINKAUFSLISTE_ICONS.sonstiges;

  const titel = document.createElement("span");
  titel.className = "shopping-list__title";
  titel.textContent = kategorie.label;

  header.append(iconWrap, titel);

  const liste = document.createElement("ul");
  liste.className = "shopping-list__items";
  artikel
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "de"))
    .forEach((eintrag) => liste.appendChild(erstelleEinkaufslisteZeile(eintrag)));

  card.append(header, liste);
  return card;
}

async function renderEinkaufsliste() {
  const leerHinweis = document.getElementById("einkaufsliste-leer-hinweis");
  const inhalt = document.getElementById("einkaufsliste-inhalt");
  if (!leerHinweis || !inhalt) return;

  let kalender = [];
  try {
    kalender = await ladeJSON("./data/kalender.json");
  } catch (fehler) {
    console.warn("Kalender konnte nicht geladen werden:", fehler);
  }

  const eintraege = eintraegeImZeitraum(kalender, einkaufslisteModus);

  if (eintraege.length === 0) {
    leerHinweis.hidden = false;
    inhalt.hidden = true;
    inhalt.innerHTML = "";
    return;
  }

  const artikelListe = await aggregiereEinkaufsliste(eintraege);

  if (artikelListe.length === 0) {
    leerHinweis.hidden = false;
    inhalt.hidden = true;
    inhalt.innerHTML = "";
    return;
  }

  leerHinweis.hidden = true;
  inhalt.hidden = false;
  inhalt.innerHTML = "";

  EINKAUFSLISTE_KATEGORIEN.forEach((kategorie) => {
    const artikelInKategorie = artikelListe.filter((a) => a.kategorie === kategorie.key);
    if (artikelInKategorie.length === 0) return;
    inhalt.appendChild(erstelleEinkaufslisteKategorieCard(kategorie, artikelInKategorie));
  });
}

document.querySelectorAll("#einkaufsliste-range-picker .range-picker__option").forEach((btn) => {
  btn.addEventListener("click", () => {
    einkaufslisteModus = btn.dataset.range;
    document.querySelectorAll("#einkaufsliste-range-picker .range-picker__option").forEach((b) => {
      b.classList.toggle("is-active", b === btn);
    });
    document.getElementById("einkaufsliste-frei-felder").hidden = einkaufslisteModus !== "frei";
    renderEinkaufsliste();
  });
});

document.getElementById("einkaufsliste-von")?.addEventListener("change", renderEinkaufsliste);
document.getElementById("einkaufsliste-bis")?.addEventListener("change", renderEinkaufsliste);

renderEinkaufsliste();

// ---------- Einstellungen ----------

function renderVersion() {
  const semverEl = document.getElementById("settings-app-semver");
  const buildEl = document.getElementById("settings-build");
  if (semverEl) semverEl.textContent = APP_SEMVER;
  if (buildEl) buildEl.textContent = APP_BUILD;
}

renderVersion();

function renderGitHubTokenStatus() {
  const statusEl = document.getElementById("settings-token-status");
  if (!statusEl) return;
  const hatToken = Boolean(ladeGitHubToken());
  statusEl.textContent = hatToken ? "Token hinterlegt." : "Kein Token hinterlegt.";
  statusEl.classList.toggle("settings-token-status--ok", hatToken);
}

document.getElementById("settings-token-speichern")?.addEventListener("click", () => {
  const input = document.getElementById("settings-token-input");
  const wert = input.value.trim();
  if (!wert) return;
  speichereGitHubToken(wert);
  input.value = "";
  renderGitHubTokenStatus();
});

document.getElementById("settings-token-loeschen")?.addEventListener("click", () => {
  entferneGitHubToken();
  renderGitHubTokenStatus();
});

renderGitHubTokenStatus();
