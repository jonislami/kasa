# Fiskalizimi në ATK – përmbledhje

Burimet: Udhëzimi Administrativ (MF) 01/2026, Kërkesat specifike teknike dhe funksionale për PEF/SF/SEF
(Kapitulli IV) me ndryshim-plotësimin, Kushtet dhe procedurat për certifikim të SEF, github.com/fiskalizimi.

## 1. Kush e ka detyrim
Bizneset që shesin me pakicë ose ofrojnë shërbime për publikun (edhe ndërmarrjet publike dhe institucionet që
marrin kesh). Përjashtohet kush shet vetëm biznes-me-biznes (ai lëshon faturë tatimore). Bizneset pa arkë fiskale
kanë 60 ditë nga hyrja në fuqi e udhëzimit për të instaluar SEF.

## 2. Si funksionon (rrjedha)
1. **Regjistrimi i arkës (një herë):** arka krijon një çelës privat ECDSA P-256 që nuk largohet kurrë nga pajisja.
   Me NUI-n, Numrin e fiskalizimit (nga EDI), Branch ID, POS ID dhe Application ID (kodi i SEF-it nga ATK)
   kërkohet `verification_code` (`/ca/verify/{nui}`), krijohet CSR (C=RKS, O=NUI, OU=PosId, L=BranchId,
   CN=emri i biznesit) dhe dërgohet në `/ca/signcsr` → certifikata e arkës.
2. **Çdo shitje:** krijohen dy kuponë:
   - **PosCoupon** – i plotë (artikujt, pagesat, TVSH, operatori, zbritja…);
   - **CitizenCoupon** – i shkurtër (biznesi, arka, numri, koha, totali, TVSH sipas normës).
   Secili: protobuf → base64 → SHA-256 → nënshkrim ECDSA → base64.
3. **Dërgimi para printimit:** PosCoupon i nënshkruar → `POST /pos/coupon`; ATK kthen `transaction_id`.
4. **Fatura:** kodi QR = `base64(CitizenCoupon) | nënshkrimi`. Qytetari e skanon me aplikacionin e ATK-së dhe
   sheh nëse kuponi është regjistruar.
5. **Verifikimi:** nëse të dhënat e PosCoupon dhe CitizenCoupon nuk përputhen → "FAILED VERIFICATION".

Serverët: test `https://fiskalizimi-test.atk-ks.org`, prod `https://fiskalizimi.atk-ks.org`.

## 3. Formatet
- Çmimet e artikujve në €0.0001 (1.00 € = 10000); totalet në cent (1.00 € = 100).
- Normat e TVSH-së: **A** e liruar, **C** 0%, **D** 8%, **E** 18%. Asnjë vlerë negative TVSH-je.
- Tipi i kuponit: Shitje = 1, Anulim = 2, Kthim = 3 (anulimi/kthimi kërkon `ReferenceNo` = kuponi origjinal).
- Pagesat: Kesh 1, Kartelë 2, Vauçer 3, Çek 4, Kripto 5, Tjetër 6 – një kupon mund të ketë disa.
- **NUIKF** (numri unik i kuponit / VerificationNo): alfanumerik, pa hapësira, maksimum 16 karaktere.
- `CouponId` unik për gjithë biznesin (të gjitha njësitë); `PosId` unik brenda njësisë.

## 4. Çfarë duhet të ketë fatura
NUI · nr. i TVSH-së · emri dhe adresa e njësisë · nr. i njësisë · operatori me ID · për çdo artikull: sasia,
çmimi për njësi, emri (i njëjti artikull në një rresht), vlera, shkronja e TVSH-së · zbritjet (me minus) ·
nëntotali · totali · pagesat sipas llojit · TVSH sipas normës · totali pa TVSH · data, ora, minuta ·
**numri i SEF-it** `[Njësia]-[NUI]-[PosId]` · numri rendor dhe numri ditor · **kodi QR** · **NUIKF** ·
**logoja RKS** · tipi i kuponit · "e-kupon" kur dërgohet elektronikisht · tekst i lirë.
Ri-printimi shënohet **"KOPJE E KUPONIT"**. Duhet edhe "Print Preview" (QR në ekran pa printim).

## 5. Kërkesat për softuerin (SEF)
- Nënshkrim digjital i çdo kuponi; identifikim me certifikatë; komunikim vetëm HTTPS.
- Dërgim në kohë reale **para printimit**; gabim i qartë + ri-provim automatik kur ATK refuzon.
- **Offline:** kuponi lëshohet dhe ruhet i sigurt, shënohet **"OFFLINE"**, ruhet kronologjia, njoftim vizual që
  punon offline; dërgim automatik kur kthehet lidhja – **brenda 48 orëve**. Nëse s'mundet (forcë madhore), njoftohet
  ATK; kuponët e pafiskalizuar dorëzohen deri më 10 të muajit pasues.
- **Pajisja prishet plotësisht:** kuponë nga blloku i veçantë me numër serik (2 kopje); brenda 48 orëve pajisje e
  re; brenda 5 ditëve kuponët e bllokut regjistrohen në SEF.
- **Të dhënat e pandryshueshme:** çdo shitje me ID, datë/orë, operator, artikull, sasi, çmim, zbritje;
  write-once/read-many; nuk fshihet asgjë – vetëm anulim/korrigjim i ri i lidhur me origjinalin.
- **Anulimi, kthimi, ndërrimi** i artikullit (kthim + shitje e re), me referencë.
- **Audit log:** hyrje, shitje, anulim, ndryshim konfigurimi; i mbrojtur me kriptim; eksport CSV/PDF;
  gjurmët e dërgimit (data, ora, sekonda, nr. kuponi, totali, gabimet, ndërhyrjet).
- Të dhënat lokale **të enkriptuara**; qasje në të dhënat e padërguara vetëm me kërkesë të ATK-së.
- **Ora** e sinkronizuar me serverin e ATK-së (data, ora, minuta, sekonda).
- Funksionim 24/7; së paku 4 norma tatimore; konfigurim i njësive matëse dhe kategorive sipas listës së ATK-së.
- **Shumëgjuhësia** sipas gjuhëve zyrtare (shqip dhe serbisht), shkronja latine.
- Printim në letër termike 58–100 mm, i lexueshëm dhe i qëndrueshëm; ose dërgim elektronik (me pëlqimin e blerësit).
- Mund të punojë në PC, laptop, tablet ose telefon (së paku në njërën).
- Mbrojtje e kodit dhe kundër ndryshimeve të paautorizuara; përditësim sipas ndryshimeve ligjore.
- Ndërlidhje me sisteme të tjera (kontabilitet, furnitorë).

## 6. Certifikimi i SEF-it (për zhvilluesin)
1. Testimi në ambientin test të ATK-së ("Testo para Aplikimit", pastaj "Verifiko testimet").
2. Aplikimi te Komisioni me: formularin e kërkesës, certifikatën e biznesit (ARBK) ose dokumentin personal,
   përshkrimin e softuerit dhe të integrimit me ATK + teknologjitë, manualin e përdoruesit, deklaratën e
   pajtueshmërisë.
3. Komisioni teston: sigurinë dhe integritetin, saktësinë e kuponëve, raportimin në kohë reale, ruajtjen dhe
   dërgimin automatik pas ndërprerjes. Mangësitë: 7 ditë pune për korrigjim.
4. Vendimi brenda 15 ditëve pune → certifikata + **kodi unik i SEF-it** (Application ID), që integrohet në softuer
   bashkë me NUI-n e zhvilluesit dhe dërgohet me çdo kupon.
5. Refuzim → riaplikim pas 30 ditësh. Çdo ndryshim që prek krijimin/ruajtjen/dërgimin e të dhënave fiskale
   njoftohet më parë te ATK. ATK mund ta pezullojë, tërheqë ose anulojë certifikatën.

## 7. Detyrimet e biznesit që e përdor
- Çdo arkë: certifikatë digjitale dhe çelës privat i ruajtur sigurt; jep NUI, nr. njësisë, nr. POS, kodin e SEF-it
  dhe nr. e fiskalizimit.
- Njofton ATK-në për softuerin që përdor dhe për çdo ndryshim (lokacion, shitje, çregjistrim).
- Vendos njoftimin për kuponin fiskal në vend të dukshëm.
- Nuk lejohet të lëshojë kuponë me softuer të pacertifikuar. Gjobat sipas Ligjit për Administrimin e
  Procedurave Tatimore.
- Blerësi duhet ta mbajë kuponin deri 30 metra larg biznesit.
