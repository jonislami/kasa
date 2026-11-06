# Kasa – fazat e ndërtimit

Lexo `CLAUDE.md`, shiko pamjet te `design/screenshots/` dhe referencat te `docs/atk/`. Puno një fazë në një
kohë; ndalu pas çdo faze që ta kontrollojë përdoruesi.

---

## Faza 1 – Themeli dhe platforma
1. Projekti Vite + React + TypeScript në këtë dosje (mos i fshi `design/`, `docs/`, `CLAUDE.md`, `PROMPT.md`).
2. Tailwind, React Router, @supabase/supabase-js, @tanstack/react-query, lucide-react, vite-plugin-pwa.
3. Tokenat, shkronja Inter, rregullat e telefonit (pa zmadhim, safe-area, 16px input).
4. Komponentët `components/ui/`: Button, Input, Select, Card, Badge, Table, Tabs, Toggle, Dialog.
5. Layout: Sidebar (desktop) dhe TabBar (telefon), menuja sipas llojit të biznesit dhe rolit – **dy panele të
   ndara**: paneli i adminit (gjithçka) dhe paneli i punëtorit (vetëm arka/shërbimet dhe puna e vet), të kufizuara
   edhe në databazë me RLS.
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
Shitjet ditore, grafiku 7 ditë / muaj / vit, më të shiturat, fitimi, TVSH sipas normës, sipas punëtorit,
lista e faturave, regjistri i veprimeve, eksport Excel/CSV/PDF.
**Puna e punëtorëve** (`/puna`): admini zgjedh punëtorin dhe periudhën dhe sheh shitjet, shërbimet, faturat,
anulimet/kthimet, terminet, komisionin dhe orët e hyrjes/daljes; punëtori sheh vetëm punën e vet të sotme.

## Faza 6 – Cilësimet, printeri, fatura
Të dhënat e biznesit (NUI, nr. TVSH, adresa), arkat, përdoruesit dhe PIN-et (`pin-login`), printeri Bluetooth
ESC/POS, fatura 80/58mm me të gjitha fushat që kërkon ATK (vendi i QR-së gati), "KOPJE E KUPONIT", kopja
rezervë.

## Faza 6b – Kontabilisti (zyrat e kontabilitetit)
Modeli: ProBooks (llogaria e kontabilistit te "Alton Islami B.I." dhe faqja "Klientët e mi").
1. **Roli `accountant`** (vlerë e re te `user_role`). Një person i jashtëm që e fton pronari; nuk është punëtor
   i biznesit dhe nuk ka PIN.
2. **Një llogari, shumë biznese:** tabela `business_members` (`user_id`, `business_id`, `role`, `status`:
   invited/active/revoked, `invited_by`, `created_at`) dhe `user_active_business` (biznesi i zgjedhur).
   `current_business_id()` kthen biznesin nga `profiles` (si sot) ose, për kontabilistin, biznesin e zgjedhur
   vetëm nëse anëtarësia është `active` dhe biznesi aktiv. RPC `set_active_business(id)` kontrollon anëtarësinë.
   Punëtorët dhe pronarët e sotëm vazhdojnë pa ndryshim (migrim që nuk e prish versionin live).
3. **Ftesa:** pronari, te Cilësimet → "Kontabilisti", fut email-in; Edge Function `invite-accountant` krijon
   llogarinë ose e lidh atë ekzistuese dhe dërgon ftesën; pronari mund ta heqë qasjen në çdo kohë. Çdo ftesë,
   pranim dhe heqje shkruhet në `audit_log`.
4. **Çka sheh kontabilisti** (vetëm lexim, i zbatuar me RLS, jo vetëm me fshehje butonash):
   - shitjet, rreshtat e faturave, anulimet dhe kthimet (me filtra: data, arka, "të anuluarat") + eksport,
   - produktet/shërbimet me çmimet e blerjes, hyrjet e stokut, furnitorët, inventarin,
   - raportet, fitimin, TVSH sipas normës (E/D/C/A) për muajin, barazimin e arkës, njoftimet.
   **Nuk sheh / nuk prek:** punëtorët dhe PIN-et, degët/arkat dhe pajisjet, çelësat dhe të dhënat e
   regjistrimit në ATK, përdoruesit, cilësimet; **nuk shet** dhe nuk ndryshon çmime apo stok.
   (ProBooks i lejon artikujt; te ne vetëm lexim – mund të hapet më vonë me leje nga pronari.)
5. **Lista e bizneseve pas hyrjes:** kartat e bizneseve ku ka qasje, me etiketën "I ftuar · Kontabilist",
   qyteti, statusi dhe "hapur para …"; klikimi e bën biznesin aktiv.
6. **Faqja `/klientet` ("Klientët e mi")** – paneli i kontabilistit:
   - kartat: klientë gjithsej, me punë për të bërë, TVSH për t'u deklaruar (muaji), anulime/kthime për
     kontroll, shitje offline të padërguara,
   - tabela: klienti, NUI, roli im, aktiviteti i fundit, statusi i muajit për TVSH ("Për t'u bërë" /
     "E dorëzuar" / "Nuk aplikohet" kur biznesi nuk është në TVSH), eksporti i shitjeve, shënimet,
   - kërkimi me emër ose NUI, filtri "Punët e hapura"; kontabilisti shënon "TVSH e dorëzuar" për muajin
     (tabela `accounting_periods`: `business_id`, `month`, `vat_status`, `closed_by`, `closed_at`).
7. **Eksporti për kontabilitet:** libri i shitjeve për muajin (CSV/Excel) me ndarjen e TVSH-së sipas normës,
   gati për deklarimin në EDI.
8. Testet e RLS: kontabilisti nuk lexon `profiles.pin_hash`, `registers`, çelësat e pajisjeve dhe biznese
   ku nuk është anëtar aktiv.

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

Rrjedha në ndërfaqe (modeli: faqja "Fiskalizimi" dhe "Arkat MiniPOS" te ProBooks):
1. **Faqja `/fiskalizimi`** (vetëm admin) me 3 hapa dhe statusin e secilit (në pritje / i pranuar / data):
   - **Hapi 1 – aplikimi i njësisë:** NUI, numri i fiskalizimit, nr. i njësisë nga ATK;
   - **Hapi 2 – aplikimi për POS:** për çdo arkë emri, **ID POS** (numri që ATK i jep në portal – ATK e
     refuzon një ID që s'e njeh), ku punon (Windows / Android / iPhone / web) dhe email-i;
   - **POS i regjistruar:** fiskalizimi i përfunduar.
   Pas Hapit 1 hapen vetëm Produktet dhe Punëtorët; shitja fiskale hapet kur regjistrohet arka e parë.
2. **Lidhja e pajisjes me kod regjistrimi:** pas aprovimit, admini merr kodin (në ekran dhe me email); pajisja
   e re fut kodin → krijon çelësin jo të eksportueshëm → CSR → lidhet me arkën dhe POS ID-në.
3. **Lista e arkave:** emri, POS ID, platforma, **versioni i aplikacionit**, "parë së fundi", statusi
   (Aktiv / Offline / Kërkon përditësim), butoni "Rilidh"; lidhja për shkarkimin e versionit të fundit.
4. **Numri i kuponit sipas njësisë dhe arkës** (p.sh. `2026-N1-P1-0002`) krahas numrit të biznesit;
   shënimi i kuponit mban ID-në e pajisjes.
5. **Barazimi i arkës** (`/arka/barazimi`): për çdo ditë dhe arkë – kuponët, keshi i pritur vs. i numëruar,
   arkëtari; kontroll i brendshëm, nuk dërgohet në ATK.
6. **Njoftimet:** "Aplikimi u aprovua", "Arka u regjistrua", kuponë offline që afrohen 48 orëve, gabime
   dërgimi.
7. Shitjet te paneli web shënohen "nga SEF" me filtrin "Të gjitha arkat SEF".
