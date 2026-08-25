# Brutzel 🍳

Rezept-, Kochplanungs- und Einkaufslisten-App als Progressive Web App (PWA).

## Warum

Kochen, Mealprep und Einkaufen jonglieren sich schlecht zwischen Kopf, Notizzetteln und mehreren Apps. Brutzel bringt Rezeptsammlung, Wochenplanung und Einkaufsliste an einem Ort zusammen, inklusive geführtem Kochmodus für den eigentlichen Kochvorgang.

## Funktionen (geplant, v1 im Aufbau)

- **Rezeptsammlung** mit Suche, Filtern (Mealprep/Mahlzeit, Kochzeit, Geschmack-Tags, Ernährungsform) und Vorschlägen basierend auf dem Kochprotokoll
- **Kalender** (Wochenansicht) für Mealprep und normale Mahlzeiten gemeinsam geplant, farblich unterschieden
- **Automatische Einkaufsliste** über einen wählbaren Zeitraum, Zutatenmengen automatisch addiert
- **Kochmodus im Vollbild**, Schritt für Schritt, Bildschirm bleibt an (Wake Lock), mit aufklappbaren Technik-Erklärungen (z.B. "Zwiebel würfeln")
- **Bewertung nach dem Kochen** (👍/👎), fließt in künftige Vorschläge ein

## Technik

- Reines **HTML / CSS / JavaScript**, kein Framework, kein Build-Tool — analog zu [Veeno](https://github.com/Marviniee/Veeno)
- **Kein separates Backend:** Daten liegen als JSON direkt in diesem Repo (`data/`), Bilder in `bilder/`
- **Lesen:** die App lädt die JSON-Dateien direkt statisch von GitHub Pages, keine Authentifizierung nötig
- **Schreiben:** über die GitHub-Contents-API mit einem persönlichen Access Token (lokal im Browser hinterlegt, nie im Repo committet)
- Als **PWA** auf Mac, iPhone und iPad installierbar ("Zum Home-Bildschirm/Dock hinzufügen")
- Primär für **iPad im Querformat** gestaltet (Seitenleiste statt Tab-Leiste, wie bei Apples eigenen Apps), funktioniert aber auch auf Mac und iPhone

## Datenmodell

Kurzüberblick, Details je Datei in `data/`:

| Datei | Inhalt |
|---|---|
| `data/rezepte/*.json` | ein File pro Rezept — Zutaten mit Menge, Zubereitungsschritte, Tags, Fotos |
| `data/kalender.json` | geplante/gekochte Mahlzeiten (Mealprep-Kochtag + verknüpfte Restportionen) |
| `data/kochprotokoll.json` | Bewertungsverlauf pro gekochter Mahlzeit |
| `data/zutaten.json` | wiederverwendbare Zutaten-Bibliothek (Bild + Einkaufslisten-Kategorie) |
| `data/techniken.json` | wiederverwendbare Kochtechnik-Anleitungen (Text + Bild) |

Zutatenmengen werden intern einheitlich in `g` / `kg` / `ml` / `l` / `Stück` gespeichert, in Rezepten aber als natürlicher Text angezeigt ("1 Esslöffel Olivenöl").

## Struktur

- `index.html`, `style.css`, `app.js` — App-Shell
- `manifest.json`, `service-worker.js` — PWA-Grundlagen
- `data/` — Rezepte, Zutaten, Techniken, Kalender, Kochprotokoll als JSON
- `bilder/` — Rezept-, Zutaten- und Technik-Bilder

## Status

Grundgerüst steht: Sidebar-Navigation mit 6 Screens (Home, Kalender, Rezepte, Rezept-Detail, Kochmodus, Einkaufsliste) als Platzhalter ohne Fach-Logik, im Browser getestet. Nächste Schritte: Kalender-Logik, Einkaufslisten-Aggregation, GitHub-API-Sync, echte Rezeptdaten.

## Lokal starten

```bash
python3 -m http.server 8123
```

Dann `http://localhost:8123` öffnen. Auf iPad/iPhone/Mac lässt sich die Seite über "Zum Home-Bildschirm/Dock hinzufügen" als eigenständige App installieren.
