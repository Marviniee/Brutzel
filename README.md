# Brutzel

Rezept-, Kochplanungs- und Einkaufslisten-App als Progressive Web App (PWA). Primär für iPad im Querformat gedacht, unterstützt auch Mac und iPhone.

Kein Framework, kein Build-Tool — Vanilla HTML/CSS/JS, analog zu [Veeno](https://github.com/Marviniee/Veeno).

## Lokal starten

```bash
python3 -m http.server 8123
```

Dann `http://localhost:8123` öffnen. Auf iPad/iPhone/Mac lässt sich die Seite über "Zum Home-Bildschirm/Dock hinzufügen" als eigenständige App installieren.

## Struktur

- `index.html`, `style.css`, `app.js` — App-Shell
- `manifest.json`, `service-worker.js` — PWA-Grundlagen
- `data/` — Rezepte, Zutaten, Techniken, Kalender, Kochprotokoll als JSON
- `bilder/` — Rezept-, Zutaten- und Technik-Bilder

## Status

Grundgerüst mit Sidebar-Navigation und 6 Platzhalter-Screens (Home, Kalender, Rezepte, Rezept-Detail, Kochmodus, Einkaufsliste). Fach-Logik folgt schrittweise in weiteren Sessions.
