# Testimi teknik në ATK – 21.01.2027, ora 09:30

Ftesa nga Komisioni SEF për **Kontosef.app, versioni 1.0.0, aplikimi nr. 81955841**.
Vendi: ATK, ish-objekti i Auditorit, kati I, zyra 105.
Krahasimi i kërkesave të ftesës me kodin (gjendja më 26.11.2026). Legjenda: ✅ gati · 🟡 pjesërisht / për t'u provuar · ❌ mungon

## 0. Për t'u bërë menjëherë (jo kod)
- [ ] **Konfirmo pjesëmarrjen** me përgjigje në email-in e ATK-së.
- [ ] Dy biznese prove në ambientin test të ATK-së: **një me TVSH** dhe **një pa TVSH** (NUI, Branch ID, POS ID, ApplicationID test).
- [ ] Mos e ndrysho më versionin pa e njoftuar ATK-në: aplikimi është për **1.0.0** (`package.json` = 1.0.0). Ndryshimet
      më poshtë (G1–G3) prekin kuponin fiskal → ATK njoftohet para testimit, ose testimi bëhet me versionin e njoftuar.

## 1. Kërkesat e ftesës

| # | Kërkesa | Gjendja | Ku / shënim |
|---|---|---|---|
| 1 | Onboarding i ri (regjistrim i ri i arkës te ATK) | ✅ | `registerOnDevice()` – çelës i ri, verify → CSR → signcsr. Të provohet nga zero në një pajisje të pastër |
| 2 | Kuponi sipas UA neni 7 + Shtojcat (logo RKS, etiketat, anulimi, kthimi) | ✅ | `docs/atk/krahasimi-kerkesat-2026.md`, pjesa B |
| 3 | Kupon për subjekt **me TVSH** | ✅ | normat E/D/C/A, TaxGroups |
| 4 | Kupon për subjekt **pa TVSH** | 🟡 | produktet marrin `A` (`QuickProductDialog`, `ProductForm`); **të verifikohet në ambientin test** se ATK e pranon dhe kuponi nuk shfaq "NUMRI I TVSH-SË"/ndarjen e TVSH-së |
| 5 | 5 artikuj për kupon me norma të ndryshme | ✅ | |
| 6 | **Çmime me 2 dhe 4 shifra pas presjes** | ✅ | G2 (dega `atk-cmimi-me-zbritje`, kërkon migrimin 0056): çmimi `numeric(14,4)`, ekrani `formatPrice`, kuponi deri 4 shifra |
| 7 | **Sasi me 2 dhe 4 shifra pas presjes** | ✅ | G2: sasia `numeric(14,4)`; kg, metër, orë… deri 4 shifra (`_unit_decimals`, `src/lib/units.ts`); copë, pako, litër mbeten të plota |
| 8 | Zbritje për artikull në % dhe vlerë | ✅ | `dialogs.tsx` (€ / %) |
| 9 | **`Price` i artikullit me zbritjen e përfshirë** (edhe `Price`, edhe `Total` te `CouponItem`) | ✅ | G1 (dega `atk-cmimi-me-zbritje`): `Price = Total / Quantity` pas zbritjes së rreshtit dhe pjesës së zbritjes së totalit; kuponi i printuar mbetet si Shtojca F (çmimi + "Ulje") |
| 10 | Zbritje në totalin e shitjes në % dhe vlerë | ✅ | `dialogs.tsx` (zbritja e nëntotalit), ndahet në rreshta (`invoice_discount`) |
| 11 | Pagesa: kesh, kartelë, të kombinuara | ✅ | edhe bankë, vauçer, çek (0033, 0046) |
| 12 | Kthim i plotë dhe i pjesshëm | ✅ | ReferenceNo = CouponId origjinal |
| 13 | Anulim i kuponit | ✅ | me arsye, "KUPON FISKAL I ANULUAR" |
| 14 | Raportim në kohë reale, para printimit | ✅ | `fiscalize()` → `fiscal-relay` |
| 15 | Modaliteti offline (QR, "OFFLINE", njoftim, 48 orë) | ✅ | radha e enkriptuar, `hoursLeft()` |
| 16 | Dërgimi automatik pas rikthimit të lidhjes | ✅ | `flushFiscal()`; të provohet me shkëputje të rrjetit gjatë testit |
| 17 | Kuponët nga blloku i kuponëve (me dorë) | ✅ | numri serik + koha në letër (UA neni 45) |
| 18 | Sinkronizimi i orës online dhe offline | 🟡 | `serverNow()` (`src/lib/clock`); offline përdor diferencën e fundit me serverin – të provohet: ndrysho orën e Windows-it, pastaj shit offline |
| 19 | Siguria dhe integriteti | ✅ | çelës jo i eksportueshëm (DPAPI / Keystore), RLS, shitje të pandryshueshme |
| 20 | **Log-et: PayLoad, Hash Chain (Current Hash, Previous Hash, Integrity Check)** | ✅ | G3 (kërkon migrimin 0057): `fiscal_log` me payload (details + signature të dërguara te ATK) dhe zinxhir SHA-256, `fiscal_verify()`; Raporti i auditit: skeda "Komunikimi me ATK", kolona Integriteti, CSV/PDF me Payload, Previous Hash, Current Hash, Integrity Check për çdo rresht (edhe për Veprimet) |
| 21 | Printimi fizik i kuponit | ✅ | ESC/POS Bluetooth/USB, 58/80 mm |

## 2. Punët që mungojnë (renditja e propozuar)

**G1 – `Price` me zbritje.** Në `src/lib/fiscal/coupon.ts`: `Price` = çmimi për njësi pas zbritjes së artikullit dhe pjesës
së zbritjes së totalit (`total / quantity`, 4 shifra), që `Price × Quantity = Total`. Kontroll se `TotalDiscount`, TaxGroups
dhe totali mbeten si sot. Edhe kuponi i printuar duhet të tregojë të njëjtat vlera (ose "Ulje" nën rresht, si në Shtojcën F).
Provë në ambientin test me zbritje % dhe € në artikull dhe në total.

**G2 – 4 shifra për çmimin dhe sasinë.** Migrim: `products.sale_price`, `sale_items.unit_price` → `numeric(12,4)`,
`quantity` → `numeric(14,4)`; `create_sale` dhe `_unit_decimals` (kg, litër… deri në 4). Klienti: input-et e çmimit dhe
sasisë, `round2` → rrumbullakim me 4 te çmimi për njësi, totalet mbeten me 2. Kuponi i printuar: çmimi me deri 4 shifra.
Duhet të mos e prishë versionin live (rezervë kur migrimi s'është aplikuar).

**G3 – Log-et për ATK.** Zinxhir SHA-256 edhe në `fiscal_log` (si 0034) me kolonën `payload` (PosCoupon i nënshkruar,
base64), `prev_hash`, `hash`; `fiscal_verify()`. Eksporti CSV/PDF i raportit të auditit (SEF) me kolonat **Payload,
Previous Hash, Current Hash, Integrity Check** (OK / I PRISHUR për çdo rresht).

**G4 – Subjekti pa TVSH.** Provë e plotë në ambientin test; rregullim i kuponit nëse ATK kërkon tjetër normë/pamje.

## 3. Skenarët për provë para 21.01 (secili kupon 5 artikuj)

Biznesi **me TVSH**:
1. 5 artikuj E/D/C/A, kesh, pa zbritje.
2. Çmime me 4 shifra (p.sh. 1.2345) dhe sasi 0.7550 kg; kartelë.
3. Zbritje 10% në një artikull + 0.50 € në një tjetër; pagesë e kombinuar kesh + kartelë.
4. Zbritje 5% në total; kesh me kusur.
5. Zbritje 2.00 € në total + zbritje artikulli; kartelë.
6. Kthim i pjesshëm i kuponit 3 (2 artikuj); kthim i plotë i kuponit 1.
7. Anulim i kuponit 5.
8. Offline: shkëput rrjetin, 2 shitje + 1 kthim, rilidh → dërgohen vetë, me renditje të saktë.
9. Kupon nga blloku i kuponëve (numër serik, ora e djeshme).

Biznesi **pa TVSH**: skenarët 1–7 me normën A.

Pas çdo skenari: QR-ja verifikohet te ATK, kuponi printohet, log-u tregon payload + hash, "Kontrollo integritetin" = OK.

## 4. Pajisjet për t'i marrë më vete
- Laptop Windows me Kasa (.exe) të instaluar dhe arkën e regjistruar në ambientin test; telefon Android me APK si rezervë.
- Printer termik (Bluetooth + kabllo USB), rrotulla letre 80 mm dhe 58 mm.
- Hotspot celular (për të treguar online → offline → online pa varur nga rrjeti i ATK-së).
- Blloku i kuponëve me disa kuponë të shkruar.
- Printim i këtij dokumenti dhe i manualit; çelësat e aktivizimit `KASA-…` rezervë.
