# KontoSef.app – të gjitha funksionet e programit (për ridizajnimin e UI/UX)

Ky dokument liston **çdo ekran, dritare, buton dhe gjendje** që ekziston sot në KontoSef.app, që dizajni i ri t'i
mbulojë të gjitha pa humbur asnjë funksion. Versioni: 0.3.24 (nëntor 2026).

**Rregulla që dizajni i ri duhet t'i ruajë (kërkesa ligjore / të ATK-së):**
- Kuponi fiskal: përmbajtja dhe renditja e fushave (neni 7 i UA 01/2026), QR 20 × 20 mm, logoja RKS/MF 19 × 9,5 mm,
  shkronja Lato 8 pt në 72 mm, "KOPJE E KUPONIT" te ribotimi, "OFFLINE" kur nënshkruhet pa internet.
- Shenja **ATK** në krye të arkës (në vend të orës) duhet të mbetet e dukshme gjithmonë.
- Anulimi/kthimi: arsye e shkruar + PIN i pronarit/menaxherit.
- Shqip dhe serbisht (latinisht) në programin SEF; çdo tekst i ri duhet përkthyer.
- Punëtori nuk sheh çmimet e blerjes, fitimin, raportet e biznesit dhe punën e të tjerëve.

---

## 0. Programet dhe kush i përdor

| Programi | Ku punon | Kush hyn | Qëllimi |
|---|---|---|---|
| **Faqja publike** | shfletues | çdokush | prezantimi, regjistrimi, shkarkimi |
| **Paneli i menaxhimit (web)** | shfletues | pronari, menaxheri (email + fjalëkalim) | produktet, stoku, raportet, punëtorët, cilësimet – **nuk shet** |
| **Programi SEF (arka)** | Windows (.exe), Android (APK) | çdo punëtor me **PIN** | shitja, kthimet, tavolinat, kuzhina, printimi, fiskalizimi |
| **Platforma** | shfletues | admini i KontoSef | bizneset, aplikimet, licencat, kontabilistët |
| **KontoSef Kontabilist** | shfletues / Windows | zyra e kontabilitetit | kontabiliteti i shumë klientëve |
| **Portali i klientit** | shfletues | klienti i kontabilistit | faturat, dokumentet, mesazhet |

Llojet e biznesit (ndryshojnë modulet): **Tregti me pakicë** (barkod, peshë, stok, madhësi × ngjyrë), **Gastronomi**
(tavolina, porosi, kuzhinë/bar, receta), **Barnatore** (seri + afat skadimi), **Shërbim** (shërbime pa stok,
komision), plus **Butik** për bizneset e vjetra.

Përmasat: desktop (sidebar i errët majtas), tablet, telefon 390 px (menu poshtë / shirit i errët lart).

---

## 1. Faqja publike

### 1.1 Ballina (`/`)
- Header: logo KontoSef.app, linqet "Për kë është", "Çfarë përfshihet", "Shkarko", butonat **Regjistrohu**, **Hyr**.
- Hero me titull dhe pamje të produktit (arka e marketit, paneli, tavolinat).
- "Për kë është": 4 lloje biznesi me përshkrim.
- "Çfarë përfshihet": kartat e funksioneve (barkod/peshore/stok, raporte nga kudo, tavolina/kuzhinë, kontabilitet…).
- "Si fillohet" (hapat), "Instaloje në pajisjen që përdor", footer.

### 1.2 Regjistrohu (`/regjistrohu`) – një faqe
- **Informacionet e kompanisë**: emri, NUI (9 shifra, kontrollohet a është i zënë), qendra tatimore (opsionale),
  adresa, shteti, qyteti (me sugjerime).
- **Veprimtaria e lokalit**: 4 karta (Tregti me pakicë, Gastronomi, Barnatore, Shërbim).
- **Kontakti**: emri i pronarit, telefoni, email-i (për hyrje).
- **Forma juridike**, **Kategoria tatimore** (sipas formës), **Statusi i TVSH-së** (Po / Jo; nr. TVSH + data).
- **Njësitë** (lokalet): emri, numri, adresa, qyteti, veprimtaritë (checkbox nga lista e adminit), numri i arkave;
  "Shto njësi", "Hiq njësinë".
- **Dokumentet**: certifikata e regjistrimit (e detyrueshme), dokumente shtesë (shiko / zëvendëso / fshi).
- Kodi i partnerit (opsional), fjalëkalimi ×2, pranimi i kushteve, **Dërgo aplikimin**.
- Gjendjet: fushat me gabim me të kuqe + lëvizje te gabimi i parë; "Aplikimi u dërgua" → "Shko te llogaria".

### 1.3 Hyr (`/login`)
- Email + fjalëkalim → **Hyr**. Lidhja "Fjalëkalim i ri" (`/fjalekalimi`: fjalëkalimi i ri ×2, "Linku nuk vlen më").

### 1.4 Shkarko (`/shkarko`)
- Windows (.exe), Android (APK / Google Play), iPhone (së shpejti), "Përdore në shfletues"; shkarkimi hapet pas
  aktivizimit të biznesit.

### 1.5 Llogaria dhe abonimi (`/llogaria`, pronari)
- Statusi i aplikimit (në pritje / aprovuar / refuzuar me arsye), ndryshimi i të dhënave para aprovimit.
- Të dhënat e biznesit, historiku, **Apliko për arkë** (emri, pajisja Windows/Android, printeri, letra 58/80/100 mm,
  kontakti në vend), **Arkat dhe çelësat** (çelësi KASA-XXXX-XXXX-XXXX për çdo arkë), lidhja "Shkarko KontoSef".

---

## 2. Programi SEF (arka) – Windows dhe Android

### 2.1 Aktivizimi dhe hyrja
- **Aktivizo programin**: fusha KASA-XXXX-XXXX-XXXX → **Aktivizo** (një herë për pajisje).
- **Hyrja me PIN**: zgjedhja e punëtorit (lista me emra), tastiera 4-shifrore, "Fshi", "Ndrysho punëtorin";
  bllokim pas 5 gabimeve (15 min).

### 2.2 Korniza e arkës (WorkerShell)
- **Kompjuter**: shirit i ngushtë i errët majtas – inicialet e biznesit, ekranet (Arka / Tavolinat), "Më shumë",
  "Sinkronizo", **Kuleta** (keshi që mban punëtori), roli, **Mbyll ditën**, **Dil**. Header i bardhë: "Mirë se
  erdhe, {emri}" dhe **shenja ATK**.
- **Telefon**: shirit i errët lart – inicialet, emri i biznesit dhe i punëtorit, ikonat e ekraneve, **shenja ATK**,
  "Sinkronizo", menuja ☰.
- **Menuja**: Puna ime sot, **Kuponët e lëshuar**, Ekrani i kuzhinës/barit (Gastronomi), Printeri, Mbyll ditën, Dil.
- **Shenja ATK**: ✓ e gjelbër (e regjistruar, gjithçka e dërguar), numër portokalli (kuponë në pritje), ! e kuqe
  (refuzuar), – gri (arka pa regjistruar); shtypja hap kartën e fiskalizimit.
- **Sinkronizo**: rifreskon produktet/tavolinat dhe orën; njoftim "U sinkronizua" / "Sinkronizimi dështoi".
- **Mbyll ditën** (dritare): faturat, totali, kesh, kartelë, kusuri në fillim, kuleta; "Keshi që dorëzon" →
  mungesë/tepricë; **Mbyll dhe dil**.
- Shiritat e njoftimit: pa internet (N fatura në pritje), kuponë fiskalë pa dërguar (afati 48 orë, **Dërgo tani**),
  ora e gabuar, përditësim i ri (**Instalo / Më vonë**), licenca që skadon.

### 2.3 Arka / Shitja (`/arka`)
- **Kërkimi**: "Skano barkodin ose shkruaj emrin" (F2), **Kamera** (skanim me kamerë), skaner USB.
- Butonat e veglave: **+** (Produkt i ri – pronari/menaxheri), **Blloku i veçantë i kuponëve**, **Ruaj në pritje**
  (F4), **Faturat e sotme**, zgjedhja e arkës (kur ka disa).
- **Kategoritë** (çipa: Të gjitha, …) dhe **rrjeta e produkteve** (emri, çmimi; stoku/afati sipas llojit).
- Zgjedhja e variantit (madhësi × ngjyrë) kur produkti ka variante; pesha (kg, 3 decimale).
- **Shporta / Faturë e re**: rreshtat (emri, sasia +/−, çmimi, totali), prekja e rreshtit → dritarja e rreshtit
  (sasia, zbritja, punëtori që e kreu – Shërbim), **Zbritje në faturë** (% ose €), **Pastro faturën**.
- Ndërrim artikulli (kredi nga kthimi): shiriti "Ndërrim nga fatura #… · kredi".
- **Pagesa** (desktop në panel): Kesh / Kartelë / Të kombinuara; llojet e pagesës pa kesh (kartelë, transfer, vauçer,
  çek); "Paguar" dhe "Kusuri"; **Paguaj** (F12).
- **Pagesa me kesh** (dritare pas PAGUAJ): Totali, "Marrë nga klienti", Saktë · 5 · 10 · 20 · 50 · 100 €, Kusuri /
  Mungojnë, **Anulo · KARTELË · MBYLL SHITJEN** (Enter), **BLLOKU TATIMOR**.
- **Blloku i veçantë**: numri serik i kuponit në bllok + data/ora në kupon → shënim mbi faturë.
- **Faturat në pritje**: lista, rikthimi (ndërrim me faturën aktuale).
- **Pas pagesës**: pamja e kuponit, printimi automatik, **e-kupon** (email-i i blerësit + pëlqimi), sirtari i parave.
- **Problem me printerin** (dritare): titulli i gabimit, ndihma, **Provo përsëri · Printo me dritaren · Vazhdo pa
  printuar**.
- Offline: shitja vazhdon, numër OFF-…, kuponi "OFFLINE".

### 2.4 Faturat e sotme (dritare)
- Lista (nr., ora, pagesa, totali; Anulim/Kthim), "N shitje · Gjithsej", **Të gjithë kuponët →**, faturat offline
  në pritje (Provo tani / Hiqe).
- Fatura e hapur: kuponi i plotë, **Printo kopje · e-kupon · Kthim · Anulo**.
- **Anulo**: butonat e shpejtë të arsyes, **Arsyeja e anulimit (e detyrueshme)**, **Kërko miratimin (PIN)** →
  dritarja **Kërkohet PIN-i i menaxherit** (zgjedhja e menaxherit + PIN).

### 2.5 Kuponët e lëshuar (`/kuponet`)
- Periudha: Sot · Dje · Këtë javë · Këtë muaj · Periudhë (nga–deri).
- Kartat: Shitjet · Anulime dhe kthime · **Totali i periudhës** · Kuponë shitjeje.
- Kërkimi sipas numrit, filtri sipas punëtorit (pronari/menaxheri).
- Lista (nr., data/ora, pagesa, artikujt, punëtori, totali; Anulim/Kthim/Jo-fiskal).
- Kuponi: pamja e plotë, **Printo** (kopje), **Shkarko PDF**, **e-kupon**.

### 2.6 Kthim malli (`/arka/kthim`)
- Gjej faturën me numër; zgjidh artikujt dhe sasitë; arsyeja, shënimi, mënyra e kthimit (kesh/kartelë);
  "Përmbledhje e kthimit"; PIN i menaxherit; printimi; ndërrim artikulli (kalon në arkë me kredi).

### 2.7 Gastronomi
- **Tavolinat** (`/tavolinat`): plani sipas zonave (Brenda, Terasa…), tavolinat e lira / të zëna (totali, koha,
  "Imja") / me artikuj të padërguar; "Për të marrë"; kuleta aktuale.
- **Porosia e tavolinës** (`/tavolinat/:id`): menuja sipas kategorive + kërkimi, opsionet (modifikuesit), shënim
  për kuzhinën, **Dërgo** në kuzhinë/bar, anulimi i artikullit (me arsye pasi është dërguar), **Ndërro tavolinën**,
  bashkimi i tavolinave, ndarja e llogarisë, **Paguaj** (Kesh / Kartelë / Të kombinuara), **Printo**, "Mbylle pa
  porosi".
- **Ekrani i kuzhinës/barit** (`/kuzhina`): kartat e porosive (tavolina, koha e pritjes, artikujt, shënimet),
  zgjedhja Kuzhina/Bari, **Gati**, Printo, "Printo automatikisht", "Shfaq të gatshmet".

### 2.8 Puna ime sot
- Totali i shitjeve, faturat, kthime/anulime, orët e punës, komisioni (Shërbim), lista e faturave të mia.

### 2.9 Cilësimet në arkë
- **Printeri**: Bluetooth (çifto/shkëput), USB, printer i Windows, rrjet (IP); "Letra e printerit" 58/80/100 mm;
  printo provë; printerët e kuzhinës/barit për stacion.
- **Gjuha / Jezik**: Shqip · Srpski.
- **Karta e fiskalizimit**: gjendja, **Regjistro arkën në ATK** (pronari/menaxheri), kuponët e padërguar (CSV/PDF
  me kërkesën e ATK-së).
- Versioni i programit, instalimi.

---

## 3. Paneli i menaxhimit (web) – pronari dhe menaxheri

Navigimi: **Paneli** · Plani i tavolinave (Gastronomi) · Produktet/Menuja/Barnat/Shërbimet · Stoku & Hyrjet ·
Puna e punëtorëve · Raportet · Regjistri · Fiskalizimi · Llogaria dhe abonimi (pronari) · Cilësimet · Dil.
Telefoni: tab bar poshtë + "Më shumë".

### 3.1 Paneli (`/`)
- Përmbledhja e ditës: shitjet sot, kuponë, fitimi bruto, kthime/anulime; grafiku (Javë/Muaj/Vit); më të shiturat
  sot; kuponët e fundit; stok i ulët / "Duhet porositur"; hyrjet e mallit.

### 3.2 Produktet (`/produktet`)
- Lista: kërkimi, filtrat (kategoria, TVSH, Aktive / Pa stok / Stok i ulët / Të arkivuara), kolonat (emri,
  barkodi, çmimi, TVSH, stoku), kategoritë (shto/fshi), **Importo nga Excel** (shablloni), **Shto**.
- **Forma e produktit**: Produkt/Artikull ↔ Shërbim; emri; barkodi (Skano/Gjenero); substanca aktive (Barnatore);
  kategoria; **Njësia matëse** (lista e ATK-së, edhe për shërbime); çmimi i blerjes; çmimi i shitjes; TVSH (vetëm
  biznes me TVSH); kategoria ATK; stoku fillestar/minimal; kohëzgjatja (shërbim); arkivo/rikthe.
- **Variantet** (Tregti me pakicë/Butik): madhësitë × ngjyrat (me ngjyrë), stoku/barkodi për variant, **Printo
  etiketa** (40×30, 50×30, 58×40 mm).
- **Gastronomi**: opsionet (grupe modifikuesish), **Receta** (përbërësit), ku dërgohet porosia (kuzhinë/bar).

### 3.3 Stoku & Hyrjet (`/stoku`)
- Skedat: **Hyrje e re** (furnitori, nr. i faturës, data, pagesa kesh/bankë/me afat 7–60 ditë, artikujt me sasi,
  kosto, seri/LOT + afat; ruaj si draft / konfirmo), **Historiku i hyrjeve**, **Lëvizjet e stokut** (filtri,
  shkarkim/korrigjim me arsye), **Inventarizimi** (numërim me skanim, konfirmimi, dallimet), **Seritë & afatet**
  (Barnatore: ≤30/≤90 ditë, të skaduara, shkarko serinë), **Furnitorët** (emri, NUI, TVSH, kontakti),
  **Eksporto raportin**.

### 3.4 Raportet (`/raportet`)
- Periudha (Sot, Dje, 7 ditë, Ky muaj, e zgjedhur), kartat (Shitjet me krahasim, Fatura, Fitimi bruto + marzha,
  TVSH e mbledhur), grafiku, **Më të shiturat**, **TVSH sipas normës**, **Sipas arkëtarit**, lista e faturave
  (kërkim, detajet e faturës), **Eksporto** (Excel); Shërbim: **Raporti i komisionit**.

### 3.5 Puna e punëtorëve (`/puna`)
- Periudha, kartat (fatura, totali, kthime/anulime, orët e punës, komisioni), **Krahasimi i punëtorëve**,
  veprimet e secilit me orë; ndërrimet (Fillo/Mbyll ndërrimin).

### 3.6 Regjistri i veprimeve (`/regjistri`)
- Periudha, përdoruesi, veprimi (hyrje, PIN i gabuar, shitje, anulim, kthim, ndryshim çmimi/produkti, hyrje malli,
  inventarizim, shpenzim, e-kupon, eksport për ATK, kontabilisti…), kërkim në detaje, **Kontrollo integritetin**,
  **CSV · PDF**.

### 3.7 Fiskalizimi (`/fiskalizimi`)
- Hapi 1 – Njësia fiskale (NUI, numri i fiskalizimit EDI, Branch ID, mjedisi Test/Prod); Hapi 2 dhe 3 – Arkat
  (POS ID, statusi, versioni, parë së fundi, regjistro/çregjistro); kuponët në këtë pajisje (**Dërgo tani**);
  **Kuponët e padërguar (për ATK)** (CSV/PDF me kërkesën).

### 3.8 Cilësimet (`/cilesimet`)
- **Të dhënat e biznesit** (emri, NUI, nr. fiskal, nr. TVSH, adresa, qyteti, telefoni).
- **Përdoruesit & PIN-et** (emri, roli punëtor/menaxher, email, telefoni, PIN, komisioni %, shërbimet që kryen,
  aktiv/joaktiv).
- **PIN-i im**.
- **Arkat & pajisjet** (arka të reja, pajisjet e lidhura).
- **Printeri & Fatura** (mënyra e printimit, letra, kodimi ë/ç, prerja, sirtari, kopje, teksti lart/poshtë, logoja,
  ndarja e TVSH-së, printimi automatik, radha e printimit).
- **TVSH & Taksat**, **Kontabilisti** (shto me email, mirato/refuzo kërkesën, hiq qasjen), **Kopje rezervë**
  (Excel).

---

## 4. Platforma (admini i KontoSef)

- **Bizneset** (`/platforma`): kartat (biznese aktive, në pritje, përdorues, shitjet sot), filtri sipas llojit,
  kërkimi, **Biznes i ri** (lloji, emri, pronari, email, fjalëkalimi i gjeneruar → "Të dhënat për hyrje"),
  "Fjalëkalim i ri" / link, aktivizo/çaktivizo.
- **Biznesi** (`/platforma/biznes/:id`): të dhënat e regjistrimit, **Ndrysho llojin**, aplikimi (njësi për njësi:
  Aprovo / Refuzo, dokumentet), **Licenca** (skadon më, pajisje maksimale, pezullo/riaktivizo), **Çelësat e
  aktivizimit** (gjenero për arkë), aplikimet për arkë, historiku.
- **Aplikimet** (`/platforma/aplikimet`): në shqyrtim, presin vendim, licencat që skadojnë; **veprimtaritë** e
  njësive (shto/ndrysho).
- **Kontabilistët** (`/platforma/kontabilistet`): llogaritë, klientët, **Kontabilist i ri**.

---

## 5. KontoSef Kontabilist (program më vete)

- **Hyrja** (+ verifikimi me dy hapa), **Klientët** (lista, klient i ri, lidhja me biznesin në KontoSef sipas NUI,
  statusi "KontoSef · në pritje").
- **Klienti** – menuja anësore:
  - Të përgjithshme: Paneli, Pasqyra e periudhës (muaj / tremujor / vit).
  - Subjektet: Klientët dhe furnitorët.
  - Shitjet: Faturat e shitjes (redaktori i faturës), Proformat.
  - Blerjet: Blerjet dhe shpenzimet, **Skanimi me AI** (blerje, shpenzim, investim, shitje).
  - Financat: Arka dhe banka (importi i ekstraktit), Llogaritë e arkëtueshme & pagueshme, Fitimi dhe humbja, Plani
    kontabël, Ditari, Libri kryesor, Bilanci provues, Pasqyrat financiare, Mjetet themelore, Mbyllja e muajit.
  - Burimet njerëzore: Punonjësit dhe kontratat, Orari dhe vijueshmëria, Pushimet/vendimet/raportet, Pagat.
  - Administrata tatimore: Formulari i TVSH-së dhe librat, **Libri i shitjes dhe i blerjes (ATK)** (xlsx zyrtar),
    TVSH sipas normave, Tatimet e tjera dhe afatet.
  - Inventari: artikujt, stoku, depot. Klientët e KontoSef: Arka, Stoku (vetëm lexim, kuponët automatikisht).
  - Arkiva, Zyra (dokumentet e klientit), Të dhënat.
- **Puna** (detyrat e zyrës, përsëritja çdo muaj, anëtari), **Zyra** (anëtarët, faturat e zyrës, pagesat),
  **Arkiva**.

### 5.1 Portali i klientit
- Përmbledhje, Faturat, Dokumentet (ngarkimi, statusi: Te kontabilisti / Në kontroll / U regjistrua), Mesazhet,
  Deklaratat, Zyra.

---

## 6. Komponentët e përbashkët

Button (kryesor, dytësor, rrezik; me ngarkim), Input (etiketa, ndihma, gabimi), Select, Tabs/segmentet, Toggle,
Checkbox, Card, StatCard, Badge (neutral, sukses, paralajmërim, gabim, info), Table, Dialog (desktop në qendër,
telefon nga poshtë), EmptyState, gjendjet **Duke ngarkuar… / Pa internet / Gabim / Bosh**, PageHeader, ikonat
lucide, kuponi (Receipt), QR, logoja RKS/MF.

## 7. Gjendjet që çdo ekran duhet t'i ketë

Duke ngarkuar · bosh (me tekst udhëzues) · gabim (me "Provo përsëri") · pa internet (të dhënat e fundit) ·
pa qasje (roli) · moduli i pa aktivizuar · telefon / tablet / desktop · shqip / serbisht · tastiera (F2, F4, F12,
Enter) dhe skaneri USB.
