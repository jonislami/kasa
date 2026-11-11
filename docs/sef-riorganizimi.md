# Riorganizimi i SEF – analiza dhe plani

## 1. Si funksionon sot (analiza e kodit dhe databazës)

| Pjesa | Gjendja sot | Problemi |
|---|---|---|
| **Regjistrimi** | Nuk ka regjistrim nga klienti. Biznesin dhe pronarin (email + fjalëkalim) i krijon vetëm admini i platformës (`/platforma` → Edge Function `platform-admin`, `create_business`). | Klienti nuk mund të aplikojë vetë; nuk ka të dhëna të plota (NUI, nr. fiskal, telefon…) në hapin e parë. |
| **Statusi i biznesit** | Vetëm `businesses.active` (po/jo). `current_business_id()` kthen biznesin vetëm kur `active = true`, kështu bllokimi punon në databazë (RLS). | Nuk ka "në pritje", "refuzuar", "kërkohen të dhëna", pagesë, abonim, skadim. |
| **Paneli i adminit** | `/platforma`: lista e bizneseve (përdorues, arka, shitjet sot), krijo biznes, çaktivizo, fjalëkalim i ri, kontabilistët. | Nuk ka aplikime, pagesa, licenca, aplikime për arkë, pajisje për licencë. |
| **Llojet e biznesit** | 5 lloje (market, restaurant, pharmacy, boutique, salon), i pandryshueshëm pas krijimit; menyja dhe modulet ndryshojnë sipas llojit (`src/lib/business.ts`). | Kërkesa e re flet për Kafiteri dhe Market. |
| **Pajisjet** | `devices` (ID e pajisjes, arka, platforma, versioni, parë së fundi), `link_device` (menaxheri hyn një herë me email), `device_heartbeat`. `registers` = arkat. | Nuk lidhen me licencë; nuk ka limit pajisjesh. |
| **Shkarkimi** | `/shkarko` lexon GitHub Release-in e fundit: një `Kasa-Setup.exe` (Windows) dhe një APK për të gjitha llojet; përditësim automatik me electron-updater. | I njëjti program për të gjithë; kushdo e shkarkon pa aprovim. |
| **Fiskalizimi (faza-9, e pabashkuar)** | Njësia fiskale (`fiscal_branch_id`), arkat në ATK (POS ID, çelësi në pajisje, certifikata), kuponët, `fiscal-relay`. Pret Application ID-në nga ATK. | Nuk ka hapin "Apliko për arkë" nga klienti dhe miratimin nga admini. |

Çka punon dhe nuk duhet prishur: arka/shitjet offline, PIN-et e punëtorëve, RLS sipas biznesit, `link_device`, modulet sipas llojit, Kontabilisti, Vercel + GitHub Releases.

## 2. Arkitektura e propozuar (pa sisteme të dyfishta)

Gjithçka mbetet mbi tabelat ekzistuese `businesses`, `profiles`, `registers`, `devices`; shtohen vetëm pjesët që mungojnë.

### Statuset e biznesit (një rrjedhë e vetme)
`pending` (në pritje) → `needs_info` (kërkohen të dhëna) ↔ `pending` → `approved` (aprovuar, pret pagesën) → `active` (pagesa e konfirmuar, licenca aktive) · `rejected` · `suspended`.
`businesses.active` mbetet çelësi i qasjes në databazë: bëhet `true` vetëm kur aprovuar + paguar + licenca aktive. Kështu RLS-ja ekzistuese vazhdon të mbrojë gjithçka pa ndryshim.

### Tabela të reja
- `business_applications` – të dhënat e regjistrimit, historiku i vendimeve (pranuar/refuzuar/kërkesë për të dhëna + shënimi i adminit).
- `licenses` – një licencë për biznes: plani, statusi (aktiv/pezulluar/skaduar/çaktivizuar), data e fillimit dhe e skadimit, numri maksimal i pajisjeve.
- `license_payments` – pagesat (shuma, mënyra, data, referenca, kush e konfirmoi) – zgjatja e abonimit bëhet nga pagesa.
- `register_applications` – "Apliko për arkë": të dhënat e arkës (vendi, pajisja, printeri…), statusi; aprovimi krijon arkën në `registers` (dhe më vonë regjistrimin në ATK me faza-9).

### Rrjedha
1. **Regjistrimi** (`/regjistrohu`): Edge Function `register-business` krijon llogarinë e pronarit + biznesin me `active = false`, status `pending`.
2. **Paneli i klientit në pritje** (`/llogaria`): statusi, të dhënat (mund t'i plotësojë kur kërkohen), udhëzimet e pagesës.
3. **Admini** (`/platforma` → Aplikimet): pranon/refuzon/kërkon të dhëna, konfirmon pagesën → licenca aktive → `active = true`.
4. **Apliko për arkë** → admini e aprovon → klientit i del **Install SEF**.
5. **Install SEF**: shkarkimi i programit të llojit të tij (Kafe ose Market); programi lidhet me llogarinë me hyrjen e pronarit/menaxherit (si sot, `link_device`), identifikon biznesin dhe ngarkon konfigurimin.
6. **Licenca në program**: `device_heartbeat` dhe `my_context` kthejnë statusin e licencës; programi tregon paralajmërim para skadimit, pas skadimit (pas ditëve të tolerancës) ndalon shitjet e reja por lejon shikimin; licenca e pezulluar e mbyll qasjen.

## Vendimet (11.11.2026)
- Regjistrimi ofron **të 5 llojet** e biznesit.
- Pagesa: **bankë/kesh**, klientit i dalin IBAN-i dhe shuma; **admini e konfirmon** në panel.
- **Një program që përshtatet** sipas llojit (si sot); "Install SEF" tregon shkarkimin me udhëzimet e llojit të biznesit; pa aprovim dhe licencë programi nuk lejon punë.
- Skadimi: paralajmërim 7 ditë para, **7 ditë tolerancë**, pastaj **pa shitje të reja** (shikimi i të dhënave lejohet). Licenca e pezulluar/çaktivizuar mbyll qasjen.
- Bizneset ekzistuese mbeten aktive me licencë pa skadim, që të mos prishet asgjë.

## 3. Fazat e implementimit
- **S1** – databaza: statuset, aplikimet, licencat, pagesat, aplikimet për arkë; Edge Function e regjistrimit; bizneset ekzistuese kalojnë në "aktive" me licencë që të mos prishet asgjë.
- **S2** – regjistrimi publik dhe paneli i klientit (statusi, plotësimi i të dhënave, pagesa, Apliko për arkë, Install SEF).
- **S3** – paneli i adminit: aplikimet, pagesat, licencat (aktivizo, skadimi, zgjat, pezullo, çaktivizo), pajisjet e licencës, aplikimet për arkë.
- **S4** – programi: reagimi ndaj licencës, limiti i pajisjeve, dy versionet (Kafe / Market) me ndërtim të veçantë dhe kontroll të llojit, release për të dyja.
- **S5** – testimi i plotë i rrjedhës (lista në kërkesë, pika 7) – në databazë me transaksione që anulohen dhe në shfletues.
