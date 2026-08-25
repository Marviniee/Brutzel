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
const APP_SEMVER = "0.4.0";
const APP_BUILD = 5;

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

// ---------- Daten-Hilfsfunktionen (von Home + Kalender genutzt) ----------

const SLOT_LABELS = { fruehstueck: "Frühstück", mittag: "Mittag", abend: "Abend" };

async function ladeJSON(pfad) {
  const antwort = await fetch(pfad);
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

document.getElementById("rezept-detail-kalender-btn")?.addEventListener("click", () => {
  const hinweis = document.getElementById("rezept-detail-kalender-hinweis");
  if (!hinweis) return;
  hinweis.hidden = false;
  clearTimeout(kalenderHinweisTimeout);
  kalenderHinweisTimeout = setTimeout(() => {
    hinweis.hidden = true;
  }, 2500);
});

renderRezeptDetail();

// ---------- Einstellungen ----------

function renderVersion() {
  const semverEl = document.getElementById("settings-app-semver");
  const buildEl = document.getElementById("settings-build");
  if (semverEl) semverEl.textContent = APP_SEMVER;
  if (buildEl) buildEl.textContent = APP_BUILD;
}

renderVersion();
