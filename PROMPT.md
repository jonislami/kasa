# Kasa – fazat e ndërtimit

Lexo `CLAUDE.md`, shiko pamjet te `design/screenshots/` dhe referencat te `docs/atk/`. Puno një fazë në një
kohë; ndalu pas çdo faze që ta kontrollojë përdoruesi.

---

## Faza 1 – Themeli dhe platforma
1. Projekti Vite + React + TypeScript në këtë dosje (mos i fshi `design/`, `docs/`, `CLAUDE.md`, `PROMPT.md`).
2. Tailwind, React Router, @supabase/supabase-js, @tanstack/react-query, lucide-react, vite-plugin-pwa.
3. Tokenat, shkronja Inter, rregullat e telefonit (pa zmadhim, safe-area, 16px input).
4. Komponentët `components/ui/`: Button, Input, Select, Card, Badge, Table, Tabs, Toggle, Dialog.
5. Layout: Sidebar (desktop) dhe TabBar (telefon), menuja sipas llojit të biznesit dhe rolit.
6. `supabase/schema.sql` – bazë e pastër:
   - `businesses` (emri, lloji `business_type` i pandryshueshëm, aktiv, numëratori i faturave, të dhënat fiskale),
   - `profiles` (roli, `business_id`), `platform_admins`, `current_business_id()`, `is_manager()`, `is_platform_admin()`,
   - `business_settings`, `registers`, `audit_log`, RLS për të gjitha.
7. Faqja e internetit te `/` (për vizitorët), `/login` me email+fjalëkalim, AuthGuard.
8. `/platforma` + Edge Function `platform-admin`: krijo biznes (lloji, emri, pronari, email, fjalëkalim i
   gjeneruar), dritarja "Të dhënat për hyrje" me Kopjo, fjalëkalim i ri, çaktivizo/aktivizo.
9. Shtresa `src/lib/device/` (vetëm zbatimi `web` tani, me ndërfaqen gati për Electron dhe Capacitor).
10. `.env.example`, `npm run build` pa gabime.

## Faza 2 – Katalogu
Produktet dhe shërbimet (`kind`: product/service, kohëzgjatja), kategoritë, filtrat, formulari, importi nga
Excel, njësitë dhe kategoritë e ATK-së, barkodi i brendshëm. Termat sipas llojit (Produktet / Menuja / Barnat…).

## Faza 3 – Arka
Kërkim + barkod (skaner USB dhe kamera), shporta, TVSH sipas ATK (E/D/C/A), zbritjet, pagesa kesh/kartelë/e
kombinuar, kusuri, shkurtoret F2/F12, faturat në pritje, `create_sale` (numri për biznes + numri ditor),
shitjet të pandryshueshme, **anulimi** dhe **kthimi** me referencë, radha offline me `client_id`.

## Faza 4 – Stoku
Hyrjet e mallit (draft → `confirm_stock_entry`), furnitorët, lëvizjet, inventarizimi, paralajmërimet e stokit.

## Faza 5 – Paneli dhe raportet
Shitjet ditore, grafiku 7 ditë / muaj / vit, më të shiturat, fitimi, TVSH sipas normës, sipas arkëtarit,
lista e faturave, regjistri i veprimeve, eksport Excel/CSV/PDF.

## Faza 6 – Cilësimet, printeri, fatura
Të dhënat e biznesit (NUI, nr. TVSH, adresa), arkat, përdoruesit dhe PIN-et (`pin-login`), printeri Bluetooth
ESC/POS, fatura 80/58mm me të gjitha fushat që kërkon ATK (vendi i QR-së gati), "KOPJE E KUPONIT", kopja
rezervë.

## Faza 7 – PWA dhe puna offline
Instalimi, kopja lokale e katalogut për arkën, sinkronizimi automatik, njoftimi "Duke punuar offline",
lidhja e pajisjes me biznesin.

## Faza 7b – Aplikacionet që shkarkohen
- **Windows:** Electron + electron-builder → instalues `.exe`, ikona dhe emri "Kasa", përditësim automatik
  (electron-updater, GitHub Releases), Web Bluetooth me zgjedhjen e pajisjes, printim USB/Serial, çelësi me
  `safeStorage`.
- **Android:** Capacitor → APK i nënshkruar + paketa për Play Store, Bluetooth BLE, çelësi në Keystore, ikona dhe
  splash.
- **iPhone/iPad:** Capacitor → projekt iOS (ndërtohet në Mac me Apple Developer), Bluetooth BLE, Keychain.
- Faqja `/shkarko` në faqen e internetit me butonat për secilën platformë dhe udhëzimet e instalimit.
- Udhëzues te `docs/publikimi.md`: si ndërtohet dhe publikohet çdo version (Windows, Android, iOS).

## Faza 8 – Modulet sipas llojit (secili veç e veç)
- **8a Sallon:** punëtorët me komision, punëtori për çdo rresht të faturës, terminet (kalendar për punëtor),
  "Paguaj në arkë" nga termini, raporti i komisionit.
- **8b Butik:** variantet (madhësi × ngjyrë) me barkod dhe stok, etiketat me barkod, ndërrimi i artikullit.
- **8c Barnatore:** lot-et me seri dhe afat skadimi, shitja FEFO, paralajmërimet e skadimit, kërkimi sipas
  substancës.
- **8d Restorant:** tavolinat (plani i sallës), porositë e hapura, kuzhina/bari (printer i veçantë), ndarja e
  llogarisë, ndërrimi i tavolinës, recetat (stoku i përbërësve), modifikuesit.

## Faza 9 – Fiskalizimi në ATK
Çelësi i pajisjes, regjistrimi i arkës në ATK (verify → CSR → signcsr), nënshkrimi dhe dërgimi i kuponëve,
QR në faturë, offline 48 orë me enkriptim, gjurmët e dërgimit, ora nga serveri, blloku manual, serbishtja,
testet në ambientin test të ATK-së dhe dokumentet për certifikim.
