# Plani i fiskalizimit (SEF) – Market POS

Burimet: Udhëzimi Administrativ (MF) 01/2026, Kërkesat specifike teknike dhe funksionale për PEF/SF/SEF
(Kapitulli IV, nenet 22–31) me ndryshim-plotësimin, Kushtet dhe procedurat për certifikim të SEF,
specifikat teknike në https://github.com/fiskalizimi (models.proto, nënshkrimi, onboarding).

Rregulli i punës: çdo fazë në degë të veçantë; në `main` (Vercel live) vetëm pas miratimit.

---

## Si funksionon fiskalizimi i ATK-së

| Hapi | Çfarë ndodh | Ku |
|---|---|---|
| 1. Onboarding i arkës | Arka krijon çelës privat **ECDSA P-256** që nuk del kurrë nga pajisja. Me NUI + Numrin e fiskalizimit (EDI) + Branch ID + POS ID + Application ID merr `verification_code` nga `/ca/verify/{nui}`, krijon CSR (C=RKS, O=NUI, OU=PosId, L=BranchId, CN=emri i biznesit) dhe e dërgon në `/ca/signcsr` → certifikatë. | Një herë për çdo arkë |
| 2. Shitja | Ndërtohen **PosCoupon** (i plotë) dhe **CitizenCoupon** (i shkurtër), kodohen me protobuf → base64 → SHA-256 → nënshkrim ECDSA (ASN.1) → base64. | Në pajisje |
| 3. Dërgimi | `POST /pos/coupon` me `{details, signature}` **para printimit**. Përgjigjja: `transaction_id`. | Në kohë reale |
| 4. Fatura | Kodi QR = `base64(CitizenCoupon) + "|" + nënshkrimi`. Qytetari e skanon. | Në letër / ekran |

Formati i vlerave: çmimet e artikujve në €0.0001 (1.00 € = 10000); totalet në cent (1.00 € = 100).
Normat: **A** = e liruar (0%), **C** = 0%, **D** = 8%, **E** = 18%. Tipet: Sale=1, Cancel=2, Return=3.
Pagesat: Cash=1, CreditCard=2, Voucher=3, Cheque=4, Crypto=5, Other=6.
Test: `https://fiskalizimi-test.atk-ks.org`, prod: `https://fiskalizimi.atk-ks.org`.

---

## Vendime që duhen marrë para fillimit

1. **Dyqani = biznes + njësi?** ATK kërkon `CouponId` unik për gjithë biznesin (NUI), përmes të gjitha njësive.
   Propozim: një `store` = një njësi (BranchId). Nëse një NUI ka disa njësi, numëratori i kuponëve mbahet për NUI
   (tabelë `businesses`), jo për dyqan.
2. **Kush është zhvilluesi që aplikon?** Duhet person fizik afarist ose juridik i regjistruar në ARBK.
3. **Shërbimi ndërmjetës:** nëse serveri i ATK-së nuk lejon thirrje nga shfletuesi (CORS), dërgimi kalon nga
   Supabase Edge Function `fiscal-relay`. Ajo vetëm përcjell të dhëna të nënshkruara – çelësi mbetet në pajisje.

---

## Faza F1 – Baza fiskale në databazë dhe në faturë (pa lidhje me ATK)

Qëllimi: aplikacioni ruan dhe printon gjithçka që kërkon ligji; lidhja me ATK vjen te F2.

| # | Puna | Detaje |
|---|---|---|
| 1.1 | **Shkronjat e TVSH-së** | `VAT_CODES`: 18→E, 8→D, 0→C; shtohet norma "e liruar" (A). Fatura, raportet, eksportet. |
| 1.2 | **Të dhënat fiskale të dyqanit** | `store_settings`: numri i TVSH-së, numri i fiskalizimit (EDI), Branch ID, qyteti (Location), mjedisi Test/Prod. Ekran te Cilësimet. |
| 1.3 | **Të dhënat fiskale të arkës** | `registers`: POS ID (numër unik brenda njësisë), statusi i regjistrimit në ATK, data e certifikatës. |
| 1.4 | **Operatori me numër identifikues** | `profiles.operator_code` (p.sh. 001), shfaqet në faturë. |
| 1.5 | **Fushat fiskale të shitjes** | `sales`: `coupon_type` (sale/cancel/return), `reference_sale_id`, `verification_no` (NUIKF, ≤16 alfanumerike, unik), `daily_number`, `fiscal_status` (pending/sent/failed/offline), `transaction_no`, `signed_details`, `signature`, `qr_code`, `fiscalized_at`, `discount_total`. |
| 1.6 | **Shitjet të pandryshueshme** | RLS + trigger: `sales` dhe `sale_items` nuk lejojnë UPDATE/DELETE (përveç fushave të statusit fiskal nga RPC). Korrigjimet vetëm me kupon të ri. |
| 1.7 | **Anulimi i kuponit** | RPC `cancel_sale(p_sale_id, p_reason)`: krijon kupon "Anulim" me referencë, kthen stokun, shkruan `stock_movements`. Vetëm menaxheri. |
| 1.8 | **Kthimi i mallit** | RPC `return_items(p_sale_id, p_items)`: kupon "Kthim malli" me referencë, vetëm sasi ≤ të shitura. Ekran: kërko faturën → zgjidh artikujt. |
| 1.9 | **Ndërrimi i artikullit** | Kthim + shitje e re në një hap nga arka. |
| 1.10 | **Zbritjet** | Për artikull (% ose vlerë) dhe për nëntotal; `sale_items.discount`, totali i zbritjes në faturë me shenjën minus. `create_sale` llogarit në server. |
| 1.11 | **Bashkimi i rreshtave** | I njëjti artikull nuk shfaqet në disa rreshta (kërkesë e ATK-së). |
| 1.12 | **Fatura e re** | Të gjitha fushat e nenit 7 / nenit 25: NUI, nr. TVSH, emri, adresa e njësisë, nr. i njësisë, operatori + ID, artikujt me shkronjën e TVSH-së, zbritjet, nëntotali, totali, pagesat sipas llojit, TVSH sipas normës, totali pa TVSH, data/ora/minuta, **Numri i SEF-it** `[NrNjësisë]-[NUI]-[PosId]`, numri rendor, numri ditor, **QR**, **NUIKF**, **logoja RKS**, tipi i kuponit, "e-kupon" (kur dërgohet elektronikisht), teksti i lirë. |
| 1.13 | **QR në printer** | ESC/POS `GS ( k` (QR model 2) për printerin termik; QR si imazh për printimin nga shfletuesi dhe në ekran. |
| 1.14 | **"KOPJE E KUPONIT"** | Ri-printimi i një fature e shënon qartë si kopje. |
| 1.15 | **Parapamja (Print Preview)** | Kuponi me QR në ekran, që klienti ta skanojë pa e printuar. |
| 1.16 | **Regjistri i veprimeve (audit log)** | Tabelë `audit_log` vetëm-shtim: hyrje/dalje, shitje, anulim, kthim, ndryshim çmimi/cilësimesh, regjistrim arke. Ekran te Raportet + eksport CSV dhe PDF. |
| 1.17 | **Ora nga serveri** | Data/ora e kuponit vendoset nga serveri; pajisja paralajmëron nëse ora e saj ndryshon > 1 min. |
| 1.18 | **Njësitë dhe kategoritë e ATK-së** | Lidhja e njësive (copë, kg, pako, litër) dhe e kategorive me kodet nga dokumenti "Njësitë matëse dhe kategoritë" (fusha `Type` e artikullit). |

**Duhet ta bësh ti në Supabase:** një migrim i ri (07) – do të ta jap kur të jetë gati.

---

## Faza F2 – Lidhja me ATK (nënshkrimi dhe dërgimi)

| # | Puna | Detaje |
|---|---|---|
| 2.1 | **Çelësi i pajisjes** | WebCrypto ECDSA P-256 me `extractable: false`, ruajtur në IndexedDB. Asnjëherë në server ose localStorage. |
| 2.2 | **Ekrani "Regjistro arkën në ATK"** | Menaxheri fut numrin e fiskalizimit → `/ca/verify` → CSR (PKCS#10, nënshkruar në pajisje) → `/ca/signcsr` → certifikata ruhet te arka. Gjendja shfaqet te Cilësimet → Arkat. |
| 2.3 | **Kodimi protobuf** | `models.proto` e ATK-së + `protobufjs` (pa kod të gjeneruar në runtime). Teste që krahasojnë bajtat me shembujt e ATK-së. |
| 2.4 | **Llogaritja në njësitë e ATK-së** | Çmimet ×10000, totalet ×100, TaxGroups, TotalTax, TotalNoTax, TotalDiscount – njësoj në PosCoupon dhe CitizenCoupon (përndryshe "FAILED VERIFICATION"). |
| 2.5 | **Nënshkrimi dhe QR** | base64(protobuf) → SHA-256 → ECDSA → DER/ASN.1 → base64. QR = `citizen|signature`. |
| 2.6 | **Dërgimi para printimit** | Pas `create_sale`: nënshkruaj → dërgo → ruaj `transaction_no` → printo. Gabim i serverit → mesazh për arkëtarin + ri-provim automatik. |
| 2.7 | **Edge Function `fiscal-relay`** | Vetëm nëse CORS e kërkon: përcjell kërkesën te ATK (test/prod sipas dyqanit), kontrollon që përdoruesi i përket dyqanit, regjistron rezultatin. |
| 2.8 | **Puna offline sipas ligjit** | Kuponi nënshkruhet dhe QR krijohet në pajisje edhe pa internet; fatura shënohet **"OFFLINE"**; radha ruhet e **enkriptuar** (AES-GCM, çelës jo i eksportueshëm); njoftim i dukshëm "Duke punuar offline"; dërgim automatik sapo kthehet lidhja; paralajmërim kur afrohet afati **48 orë**. |
| 2.9 | **Gjurmët e dërgimit** | Për çdo kupon: data/ora/sekonda, numri, totali, përgjigjja e ATK-së, gabimet – të eksportueshme. |
| 2.10 | **Mjedisi Test/Prod** | Çdo dyqan zgjedh mjedisin; në Prod lejohet vetëm pas certifikimit (Application ID i vendosur). |

**Duhet ta bësh ti në Supabase:** migrimi 08 dhe deploy i Edge Function `fiscal-relay` (nëse duhet).

---

## Faza F3 – Plotësimi dhe certifikimi

| # | Puna |
|---|---|
| 3.1 | **Serbishtja** (dhe struktura për gjuhë të tjera): ndërfaqja dhe fatura. |
| 3.2 | **Blloku i veçantë i kuponëve**: formular për futjen e kuponëve të shkruar me dorë kur pajisja prishet plotësisht (afati 48 orë + 5 ditë), me numrin serik të bllokut. |
| 3.3 | **Njoftimi për kuponin fiskal**: faqe e printueshme sipas modelit të ATK-së, për ta vendosur te arka. |
| 3.4 | **Testet në ambientin test të ATK-së**: shitje, të gjitha llojet e pagesave, zbritje, anulim, kthim, offline > rilidhje, të gjitha normat e TVSH-së. Pastaj "Verifiko testimet" në faqen e ATK-së. |
| 3.5 | **Dokumentet për aplikim**: përshkrimi i zgjidhjes dhe i integrimit, lista e teknologjive, manuali i përdoruesit (i shkruaj unë); formulari i kërkesës, certifikata ARBK, deklarata e pajtueshmërisë (i nënshkruan ti). |
| 3.6 | **Pas certifikimit**: vendoset kodi unik i SEF-it (Application ID) + NUI e zhvilluesit në aplikacion; kalimi i dyqaneve në Prod. Çdo ndryshim i mëvonshëm në krijimin/ruajtjen/dërgimin e të dhënave fiskale njoftohet më parë te ATK. |

---

## Rreziqet

- **Fshirja e të dhënave të shfletuesit** fshin çelësin → arka duhet ri-regjistruar në ATK. Aplikacioni duhet ta paralajmërojë dhe ta tregojë qartë.
- **iPhone/Safari**: nënshkrimi dhe QR punojnë; printimi Bluetooth jo (mbetet printimi nga shfletuesi).
- **Specifikat e ATK-së mund të ndryshojnë**; kodi i fiskalizimit mbahet në një modul të vetëm (`src/lib/fiscal/`).
- Asgjë nga sa më sipër nuk është provuar ende me serverin test të ATK-së; për provat duhen NUI dhe numri i fiskalizimit i një biznesi test.

## Rendi i propozuar

F1 (databaza + fatura + anulim/kthim + audit) → F2 (çelësi, onboarding, nënshkrimi, dërgimi, offline) →
F3 (serbishtja, blloku manual, testet në ATK, dokumentet, aplikimi).

---

## Gjendja në Kasa (Faza 9, dega `faza-9`)

- **Libraria** `src/lib/fiscal/`: protobuf (i njëjti me protobufjs), nënshkrimi mbi tekstin base64 me SHA-256 +
  ECDSA P-256 → DER, QR `citizen|signature`, CSR PKCS#10 (C=RKS, L=Branch, O=NUI, OU=PosId, CN=emri).
  `npm run test:fiscal` i kontrollon të gjitha; `npx tsx scripts/atk-probe.ts` dërgon një kupon provë në serverin test.
- **Serveri test i ATK-së** (10.11.2026): pranon formatin tonë – kuponi i lexohet dhe ndalet te
  `business is not registered` (NUI provë). Nuk lejon thirrje nga shfletuesi (pa CORS) → Edge Function `fiscal-relay`.
- **Njësitë:** çmimi dhe totali i artikullit ×10000; Total, pagesat, TaxGroups, TotalTax, TotalNoTax, TotalDiscount
  ×100 (si te CitizenCoupon i shembullit). Shembulli i ATK-së ka `Total: 182000` te PosCoupon, por duhet të jetë i
  njëjtë me CitizenCoupon (1820) – **konfirmohet në testet me ATK**.
- **CouponId** = BranchId·10^12 + PosId·10^8 + numri rendor i arkës (unik për NUI, punon edhe offline).
- **Mbetet:** Application ID nga ATK (te `fiscal_config`), biznes test i regjistruar në portalin e ATK-së, testet
  "Testo para aplikimit", logoja RKS në faturë, serbishtja, blloku manual, dokumentet e certifikimit.
