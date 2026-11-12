# Kasa – udhëzime për Claude Code

**Kasa** është një platformë për biznese në Kosovë: arka/shitja (POS), produktet dhe shërbimet, stoku,
raportet, printeri termik me Bluetooth dhe fiskalizimi në ATK (SEF). Një kod i vetëm që punon si:
- **faqe web / PWA** (shfletuesi),
- **program për Windows** (.exe, Electron),
- **aplikacion Android** (APK + Play Store) dhe **iPhone/iPad** (App Store), me Capacitor.

Një aplikacion dhe një databazë për shumë biznese (multi-tenant). Çdo biznes ka një **lloj** që zgjidhet kur
krijohet dhe **nuk ndryshohet më**:

| Lloji | Kodi | Çka e dallon |
|---|---|---|
| Market | `market` | barkod, peshë (kg), stok |
| Kafiterie / Restorant | `restaurant` | tavolina, porosi, kuzhinë/bar, receta |
| Barnatore | `pharmacy` | seri (lot) + afat skadimi, FEFO |
| Butik / Veshje & Këpucë | `boutique` | variante (madhësi × ngjyrë), etiketa |
| Sallon / Shërbime | `salon` | shërbime pa stok, punëtorë me komision, termine |

Dizajni, përdoruesit/PIN-et, arka, printeri, raportet dhe fiskalizimi janë të përbashkëta; modulet dhe termat
ndryshojnë sipas llojit (regjistri te `src/lib/business.ts`).

## Stack-u
- Vite + React 18 + TypeScript (strict), Tailwind CSS, React Router
- Supabase: Auth, Postgres, RLS, RPC (funksione SQL), Edge Functions – klienti `@supabase/supabase-js`
- TanStack Query për leximin/ruajtjen; kopje lokale (offline) për arkën
- PWA (vite-plugin-pwa)
- Printimi: Web Bluetooth + ESC/POS; rezervë `window.print()` 80mm
- Deploy: Vercel (nga GitHub) për web-in
- **Windows:** Electron + electron-builder (instalues NSIS `.exe`), përditësim automatik me electron-updater nga
  GitHub Releases. Chromium-i i Electron-it lejon Web Bluetooth (me `select-bluetooth-device`) dhe Web Serial/USB.
- **Android / iOS:** Capacitor (`android/`, `ios/`), Bluetooth me `@capacitor-community/bluetooth-le`. iOS ndërtohet
  në Mac me llogari Apple Developer.

## Aplikacionet që shkarkohen (SEF)
ATK kërkon që SEF të instalohet në pajisje, ta mbajë çelësin privat të sigurt dhe të përditësohet. Prandaj:
- Pjesa që varet nga pajisja kalon përmes një shtrese të vetme `src/lib/device/` me tri zbatime
  (`web`, `electron`, `capacitor`) dhe zgjedhje automatike:
  - **çelësi i ATK-së:** web → WebCrypto jo i eksportueshëm + IndexedDB; Windows → DPAPI/safeStorage i Electron-it;
    Android → Keystore; iOS → Keychain/Secure Enclave. Çelësi nuk del kurrë nga pajisja.
  - **printeri:** Web Bluetooth (web/Windows), BLE plugin (Android/iOS), USB/Serial (Windows).
  - **ruajtja offline e enkriptuar** e kuponëve.
  - **ID e pajisjes** (lidhja me arkën dhe POS ID-në e ATK-së).
- Kodi i ndërfaqes është i njëjti; asnjë `if (electron)` jashtë `src/lib/device/`.
- Faqja e internetit ka `/shkarko`: Windows (.exe nga GitHub Releases), Android (Play Store + APK), iPhone (App
  Store) dhe "Përdore në shfletues".
- **Programi SEF (i instaluar) vetëm shet dhe printon** (`isSefApp` te `src/lib/device/`): aktivizohet njëherë me
  çelës `KASA-XXXX-XXXX-XXXX` që e gjeneron admini i platformës (`activation_keys`, 0030, një pajisje për çelës),
  pastaj vetëm hyrje me PIN; çdo rol merr panelin e punëtorit. Përjashtim: pronari/menaxheri me PIN sheh edhe
  Produktet në arkë (`RequireCatalogEditor`, `profile.actual_role`). Stoku, PIN-et, raportet → aplikacioni web.
- **Aplikacioni web nuk shet** (`SefOnly` te `src/app/routes.tsx`): arka, kthimet, porositë e tavolinave dhe kuzhina
  janë vetëm në programin SEF. Web-i: menaxhim (produktet, stoku, punëtorët/PIN-et, raportet, puna, cilësimet), hyrje
  vetëm me email; llogaritë `worker` nuk hyjnë në web.
- Versioni i aplikacionit (`package.json`) shfaqet te Cilësimet dhe dërgohet me çdo kupon fiskal; çdo version i ri
  që prek fiskalizimin njoftohet te ATK para publikimit.

## Rolet dhe qasja
- **Admini i platformës** (tabela `platform_admins`): sheh të gjitha bizneset te `/platforma`, krijon biznes të ri
  bashkë me llogarinë e pronarit (email + fjalëkalim) përmes Edge Function `platform-admin`, çaktivizon biznese,
  vendos fjalëkalim të ri për pronarin. Nuk sheh të dhënat e brendshme të bizneseve të tjera.
- Brenda biznesit: `admin` (pronari), `manager`, `worker` (punëtori: arkëtar, kamarier, berber, farmacist…).
- **Çdo biznes ka dy panele të ndara:**
  - **Paneli i adminit** (admin/manager): sheh gjithçka të biznesit – shtimin dhe ndryshimin e produkteve/shërbimeve
    dhe çmimeve, stokun, raportet, fitimin, përdoruesit, cilësimet – dhe **punën e çdo punëtori**: shitjet dhe
    shërbimet që ka kryer, faturat, anulimet/kthimet, terminet, komisionin, orët e hyrjes/daljes, sipas ditës ose
    periudhës (faqja `/puna`).
  - **Paneli i punëtorit**: vetëm sa i duhet për të kryer punën – arka/shitja (ose porositë te restoranti, terminet e
    veta te salloni), lista e punës së vet të sotme (shitjet/shërbimet, totali, komisioni i vet), printeri.
    **Nuk shton e nuk ndryshon produkte, çmime apo stok**, nuk sheh çmimet e blerjes, fitimin, raportet e biznesit
    as punën e punëtorëve të tjerë. Anulimi/kthimi kërkon miratimin e adminit (PIN i menaxherit).
  - Kufizimet zbatohen në databazë (RLS + RPC), jo vetëm duke fshehur butonat.
- **Kontabilisti** (`accountant`, Faza 6b): llogarinë e krijon admini i platformës; punon me programin e veçantë
  **Kasa Kontabilist** (`kontabilist.html`, `src/kontabilist/`) me shumë klientë, edhe jashtë Kasës (`acc_clients`,
  `acc_documents`). Lidhja me një biznes në Kasa: pronari e shton me email (`add_accountant_by_email`) ose
  kontabilisti kërkon me NUI dhe pronari e miraton (`business_members` + biznesi aktiv). Vetëm lexim: shitjet, anulimet,
  kthimet, stoku, raportet, TVSH-ja, eksporti. Nuk sheh punëtorët/PIN-et, arkat, pajisjet, çelësat e ATK-së,
  përdoruesit, cilësimet; nuk shet. Pronari ia heq qasjen kur të dojë.
- Çdo shitje, rresht fature, termin dhe veprim ruan `worker_id`, që admini ta shohë punën për punëtor.
- Punëtorët hyjnë me **PIN 4-shifror** (Edge Function `pin-login`, bcrypt, bllokim pas 5 gabimeve). Pajisja lidhet
  me biznesin kur menaxheri hyn njëherë me email.

## Siguria e të dhënave (e detyrueshme)
- Çdo tabelë e biznesit ka `business_id uuid not null default current_business_id()` dhe RLS
  `business_id = current_business_id()`. Asnjë tabelë pa RLS.
- `current_business_id()` kthen biznesin e përdoruesit vetëm nëse biznesi është aktiv.
- Stoku, shitjet, anulimet dhe kthimet ndryshojnë **vetëm përmes RPC** (`security definer`) që kontrollojnë
  biznesin dhe shkruajnë `stock_movements`.
- Shitjet janë **të pandryshueshme**: pa UPDATE/DELETE nga klienti; korrigjimi bëhet me kupon anulimi/kthimi që
  i referohet origjinalit.
- `service_role` përdoret vetëm brenda Edge Functions, asnjëherë në klient.
- Regjistri i veprimeve (`audit_log`, vetëm-shtim): hyrje, shitje, anulim, kthim, ndryshim çmimi/cilësimesh.

## Dizajni (burimi i së vërtetës)
- `design/screenshots/*.png` dhe `design/html/*.html` – pamjet e marketit (arka, produktet, stoku, cilësimet,
  login, fatura). I njëjti stil vlen për të gjitha llojet; ekranet e reja ndërtohen me të njëjtët komponentë.
  Ktheji në React + Tailwind, mos e kopjo HTML-në.
- Ekranet `M-*` janë për telefon (390px). Një aplikacion responsive: nën `md` (768px) menuja poshtë (tab bar),
  mbi `md` sidebar i errët.
- Të dhënat në dizajn janë shembuj.

### Tokenat (`tailwind.config.ts`)
| Emri | Vlera | Përdorimi |
|---|---|---|
| brand-900 | #10241B | sidebar, header i errët |
| brand-800 | #1B3A2C | hover në sidebar |
| brand-600 | #0E6B4E | butoni kryesor, linqe, aktive |
| brand-400 | #3FBF86 | logo |
| brand-100 | #E3F1EA | sfond aktiv |
| ink | #14201A | teksti kryesor |
| muted | #56645C | teksti dytësor |
| line | #E2E7E3 | kufijtë e kartave |
| field | #CBD5CE | kufijtë e input-eve |
| bg | #F4F6F3 | sfondi i faqes |
| warn-700 / warn-100 | #9A3412 / #FFEDE0 | stok kritik, gabime |
| amber-700 / amber-100 | #854D0E / #FEF3C7 | stok i ulët, paralajmërime |
| bt-600 | #1D4ED8 | butonat e Bluetooth |

- Shkronja: Inter (400/500/600/700); fatura: IBM Plex Mono. Shifrat: `tabular-nums`.
- Radius: kartat 14px, butonat/input 10–12px. Lartësia minimale e butonave 44px. Ikonat: lucide-react (stroke 2).

### Telefoni (mësime nga versioni i parë)
- Viewport pa zmadhim (`maximum-scale=1`), input-et 16px nën `md`, `touch-action: manipulation`,
  `overscroll-behavior: none`, `overflow-x: clip` (jo `hidden`, që `sticky` të punojë).
- Shirit i errët fiks pas orës/baterisë (`env(safe-area-inset-top)`), përmbajtja fillon poshtë tij.
- iPhone/Safari nuk ka Web Bluetooth: mesazh i qartë + printim nga shfletuesi.

## Rrugët
| Rruga | Ekrani |
|---|---|
| `/` | pa hyrje: faqja e internetit (prezantimi + "Hyr"); me hyrje: Paneli |
| `/login` | email+fjalëkalim (pronar/menaxher) ose PIN (arkëtar) |
| `/arka` | Arka / Shitja |
| `/produktet` | Produktet / Menuja / Barnat / Artikujt / Shërbimet (sipas llojit) |
| `/stoku` | Hyrjet, historiku, lëvizjet, inventarizimi, furnitorët |
| `/raportet` | Raportet (admin) |
| `/puna` | admin: puna e çdo punëtori; punëtori: puna e vet e sotme |
| `/regjistri` | Regjistri i veprimeve (admin/menaxher), CSV + PDF |
| `/terminet` | vetëm Sallon |
| `/tavolinat` | vetëm Restorant |
| `/cilesimet` | Cilësimet |
| `/platforma` | vetëm admini i platformës |
| `/fiskalizimi` | admin: hapat e ATK-së, arkat (POS ID, versioni, parë së fundi), kodet e regjistrimit |
| `/shkarko` | publike: shkarkimi për Windows, Android, iPhone |
| fatura e printuar | Fatura.png (80mm / 58mm) |

## Rregullat e biznesit
- Valuta EUR, 2 decimale. Çmimet e shitjes **me TVSH të përfshirë**. Baza = bruto / (1 + norma).
- Normat dhe shkronjat sipas ATK-së: **E = 18%, D = 8%, C = 0%, A = e liruar**. TVSH llogaritet një herë për
  normë mbi shumën bruto të asaj norme (si në faturë). Fatura shfaq ndarjen sipas normës.
- Marzha = (çmimi i shitjes − çmimi i blerjes) / çmimi i shitjes.
- Stok i ulët: `stock <= min_stock` (vetëm kur `min_stock > 0`); kritik: `stock <= min_stock / 2`.
  Shërbimet nuk kanë stok dhe nuk dalin në paralajmërime.
- Njësitë: copë, kg, pako, litër (kg lejon 3 decimale); lidhen me kodet e ATK-së.
- Numri i faturës: për biznes, rritet automatikisht (rresht i kyçur në `businesses`), shfaqet si `#00487`;
  plus numri ditor. Shitjet offline marrin numër të përkohshëm `OFF-…` dhe çelës idempotence (`client_id`).
- Pagesat: kesh, kartelë, të kombinuara; kusuri. Zbritje për artikull dhe për nëntotal.
- Kuponi fiskal: deri në Fazën e fiskalizimit fatura shënohet "Kupon jo-fiskal"; struktura e të dhënave
  ndërtohet që në fillim sipas ATK-së (shih `docs/atk/`).

## Fiskalizimi (ATK – SEF)
- Referencat: `docs/atk/` (Udhëzimi Administrativ 01/2026, specifikat nga github.com/fiskalizimi,
  `models.proto`, faqet e kërkesave teknike, shënimet).
- Çdo arkë: çelës ECDSA P-256 **jo i eksportueshëm** në pajisje (WebCrypto + IndexedDB), certifikatë nga ATK.
- PosCoupon + CitizenCoupon → protobuf → base64 → SHA-256 → ECDSA → dërgim **para printimit**; QR =
  `base64(CitizenCoupon)|nënshkrimi`. Çmimet ×10000, totalet ×100.
- Offline: kuponi nënshkruhet në pajisje, shënohet "OFFLINE", radha e enkriptuar, dërgim brenda 48 orëve.
- Kodi i fiskalizimit vetëm te `src/lib/fiscal/`.

## Printeri Bluetooth
- `src/lib/printer/`: `navigator.bluetooth.requestDevice` me shërbimet e zakonshme
  (p.sh. `000018f0-0000-1000-8000-00805f9b34fb`) dhe `optionalServices`; karakteristika me write; copa
  20–512 bytes (opsion në cilësime).
- ESC/POS: init, align, bold, total me madhësi të dyfishtë, vija, QR (`GS ( k`), prerja, sirtari.
  58mm = 32 karaktere/rresht, 80mm = 48. Shkronjat ë/ç: CP1250/CP852 ose zëvendësim – opsion.
- Mbaj mend pajisjen e fundit; rilidhje me `navigator.bluetooth.getDevices()`.

## Struktura
```
src/
  app/ (router, layout: Sidebar, TabBar, AuthGuard, nav)
  features/{landing,auth,platform,dashboard,pos,products,stock,reports,settings,salon,boutique,pharmacy,restaurant}/
  components/ui/ (Button, Input, Select, Card, Badge, Table, Tabs, Toggle, Dialog)
  lib/{supabase.ts, money.ts, vat.ts, business.ts, offlineCache.ts, printer/, fiscal/, device/}
electron/           – procesi kryesor i Windows (main.cts, preload.cts → dist-electron/*.cjs), pa logjikë biznesi
electron-builder.yml, capacitor.config.ts, .github/workflows/release.yml – ndërtimi dhe publikimi (docs/publikimi.md)
android/ ios/       – projektet e Capacitor (gjenerohen me `npx cap add`)
  types/database.ts
supabase/
  schema.sql        – skema e plotë për një projekt të ri (ekzekutohet një herë)
  migrations/       – ndryshimet pas fillimit, një skedar për çdo ndryshim
  functions/        – Edge Functions (platform-admin, business-users, pin-login, më vonë fiscal-relay)
```

## Mënyra e punës
- Puno në faza (shih `PROMPT.md`). Pas çdo faze: `npm run build` pa gabime, pastaj trego çfarë u bë.
- **Git:** `main` = versioni live në Vercel. Puna e papërfunduar shkon në degë të veçantë; në `main` vetëm kur
  përdoruesi e miraton.
- **Supabase:** SQL-në dhe Edge Functions i vendos vetë përdoruesi. Sa herë duhet shtuar diçka në Supabase,
  shkruaje qartë nën titullin **"Duhet ta bësh ti në Supabase"**, me skedarin dhe hapat. Para se t'i japësh,
  provoje migrimin në databazë brenda një transaksioni që anulohet.
- Ndryshimet e skemës duhet të mos e prishin versionin live: klienti punon edhe para, edhe pas migrimit
  (rezervë kur mungon kolona/funksioni: kodet 42703, PGRST202, 42P01/PGRST205).
- Çelësat në `.env.local` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`), asnjëherë në kod.
- Teksti i ndërfaqes në shqip (më vonë edhe serbisht); kodi, emrat e variablave dhe komentet në anglisht.
