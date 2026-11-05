# Kasa – dizajni i plotë

Hap **`index.html`** në shfletues (Chrome ose Edge). Aty i sheh të gjitha ekranet sipas pjesëve. Kliko një ekran dhe hapet versioni që funksionon: butonat, tab-et, dritaret dhe lidhjet mes ekraneve punojnë si në Play te canvas-i.

## Dosjet

- `html/`: një faqe për çdo ekran (70). Punojnë pa internet, përveç shkronjës Inter, që ngarkohet nga Google Fonts. `kasa-runtime.js` është vetëm për parapamje, jo pjesë e aplikacionit.
- `screenshots/`: pamja PNG e çdo ekrani. Kjo dosje i duhet Claude Code-it për të parë si duhet të duket secili ekran.
- `burimi/`: skedarët origjinalë të canvas-it (`*.dc.html`) dhe `canvas.json` me renditjen dhe madhësitë. Ndryshimet bëji te canvas-i, jo këtu.
- Ekranet e vjetra (Main, Arka, Produktet, Stoku, Login, Cilësimet, Fatura dhe M-*) janë versioni i parë statik.

## Pjesët

- **A · Faqja publike & Platforma:** Ballina, Shkarko, Platforma, Biznes i ri, Të dhënat për hyrje.
- **B · Raportet, fiskalizimi & veprimet:** Raportet, Detajet e faturës, Kthim malli, Fatura fiskale (4 variante), Regjistrimi në ATK, Arka pa internet, Regjistri i veprimeve.
- **C · Sipas llojit të biznesit:**
  - Sallon (Terminet, Arka, Punëtorët)
  - Restorant (Tavolinat, Porosia, Kuzhina)
  - Butik (Variantet, Arka)
  - Barnatore (Hyrja, Skadimet)
  - Market (Arka, Produktet, Stoku)
  - Paneli sipas llojit (5 variante)
  - Paneli i punëtorit (3 variante)
  - Puna e punëtorëve
  - Miratimi me PIN

## Për Claude Code

Thuaji: "Dizajni i plotë është te `design/index.html` dhe `design/screenshots/`. Ndërto ekranet sipas këtyre pamjeve, me komponentë React + Tailwind."
