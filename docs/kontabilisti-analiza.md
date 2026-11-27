# Kontabilisti – analiza, pajtueshmëria me ATK-në dhe ndryshimet (27.11.2026)

Dega: `kontabilist-kontrolli-atk`. Asnjë ndryshim në databazë: gjithçka punon me migrimet ekzistuese (deri te 0058).

## 1. Gjendja e programit

Kontabilisti (`kontabilist.html`, `src/kontabilist/`, rreth 18.700 rreshta) është më i plotë se plani fillestar
(`docs/kontabilisti-plani.md`). Të tetë fazat K1–K8 janë të ndërtuara:

| Pjesa | Gjendja |
|---|---|
| Shumë klientë, zyra me ekip (admin / kontabilist / asistent), qasja për klient, 2FA, regjistri i veprimeve | ✅ (0022) – kufizimet zbatohen në RLS dhe trigger-a |
| Faturat e shitjes/blerjes me rreshta, proformat, notat kreditore/debitore, pagesat, borxhet me vjetërsi | ✅ |
| Arka dhe banka, importi i ekstraktit, rakordimi | ✅ |
| Formulari i TVSH-së TV-A7 (kutitë 9–72), bartja, statusi, librat LSH/LB në shabllonët zyrtarë të ATK-së | ✅ |
| Plani kontabël, ditari, libri kryesor, bilanci provues, pasqyrat, mjetet themelore, mbyllja e muajit | ✅ |
| Pagat, WM/CM në shabllonin e ATK-së, formulari WR, HR (kontrata, vendime, pushime, vijueshmëria) | ✅ |
| Skanimi me AI në 4 lloje, portali i klientit, detyrat dhe kërkesat për dokumente, arkiva, inventari | ✅ |
| Lidhja me KontoSef: kuponët fiskalë dalin vetë në librin e shitjes (një rresht për kupon, "Qytetar", kodi 1) | ✅ |

## 2. Pajtueshmëria me ATK-në

Burimi zyrtar i verifikuar: faqja e ATK-së **"General Information on Taxes in Kosovo"** (atk-ks.org, lexuar
27.11.2026; ligjet 08/L-257, 05/L-037, 05/L-028 me 08/L-142, 06/L-105, 04/L-101) dhe njoftimi i ATK-së
**"Raportimi i blerjeve mbi 500 €"**. Shabllonët zyrtarë që programi i mbush janë në `public/atk/`.

| Detyrimi | Forma | Afati (ATK) | Programi | Gjendja |
|---|---|---|---|---|
| TVSH 18% / 8%, pragu 30.000 € | TV | 1–20 i muajit | Formulari TV-A7, kutitë llogariten nga dokumentet | ✅ normat dhe pragu përputhen |
| Libri i shitjes / blerjes (deklarues TVSH) | LSH / LB | 1–20 i muajit | Shabllonët zyrtarë `sales_vat`, `purchase_vat` | ✅ testuar: titujt, qelizat e bashkuara, gjerësitë dhe 150 / 135 formulat e shabllonit mbeten identike |
| Libri i shitjes / blerjes (jo TVSH) | LSH / LB | 1–15 i muajit pas tremujorit | Shabllonët `sales_novat`, `purchase_novat` | ✅ skedari; ⚠️ afati mungonte në kalendar → **u shtua** |
| Tatimi në paga 0 / 8 / 10% (0–250, 250–450, >450 € në muaj), punëdhënësi dytësor 10% | WM / CM | 1–15 i muajit | `acc_wage_tax` (DB) dhe `wageTax` | ✅ përputhen me ATK-në (testuar në 9 vlera kufitare) |
| Kontributet pensionale 5% + 5% | WM / CM | 1–15 i muajit | Shablloni `lista_pagave.xls` | ✅ |
| Tatimi në të ardhurat personale vjetore 0 / 8 / 10% (0–3.000, 3.000–5.400, >5.400 €) | IL / PD | tremujor / 31 mars | `personalIncomeTax` | ❌ **gabim, u rregullua**: përdorej shkalla e vjetër me 4% (960–3.000 €), e hequr me Ligjin 08/L-142 (23.08.2024) |
| Biznes individual i vogël: 3% / 9% e të ardhurave bruto deri 50.000 € | IS | 1–15 pas tremujorit | Regjimet `individual_small_3/9` | ✅ normat; ⚠️ mungonte kontrolli i pragut → **u shtua** |
| Korporata: 10%; deri 30.000 € 3% / 9% e të ardhurave bruto | QL / QS | 1–15 pas tremujorit | Regjimi `corporate` (10% e fitimit) | ⚠️ korporata e vogël zgjedh regjimin 3%/9%; tash kontrollohet pragu 30.000 € dhe forma juridike |
| Tatimi në burim në qira 9% | WR | 1–15 i muajit | Formulari WR, kutitë 8/13/14 | ✅ |
| Interesi, të drejtat pronësore 10%; jorezidentët 5%; kategoritë e veçanta 1% / 3% | WR | 1–15 i muajit | WR: kutitë 4–7, 9–11, 12 (shumat me dorë) | ✅ formulari; llogaritja automatike vetëm për qiranë |
| Tatimi në qira 10% (qiradhënësi) | IR | 1–15 pas tremujorit | – | ➖ i takon qiradhënësit, jo klientit që paguan qiranë |
| Raporti i blerjeve mbi 500 € | RB | 1 janar – 31 mars | – | ❌ **mungonte → u shtua** |
| Pasqyrat financiare | PF | 1 janar – 31 mars | Pasqyrat ekzistojnë | ⚠️ afati mungonte në kalendar → **u shtua** |
| Deklaratat vjetore PD / CD / DI / DO | – | 1 janar – 31 mars | Shënohet si "Deklarata vjetore" | ⚠️ pa formular (shih §5) |

## 3. Ndryshimet e bëra

**Pajtueshmëria dhe llogaritjet**
- `personalIncomeTax` (vlerësimi tremujor për biznesin individual me të ardhura reale) me shkallët e sakta 0 / 8 / 10%.
  Shembull: fitim vjetor 10.000 € → 652 € (më parë 733,60 €). Etiketa e regjimit "0 / 4 / 8 / 10%" → "0 / 8 / 10%".
- Llogaritjet e pastra (tatimi në paga, kutitë e TVSH-së, tatimi në të ardhura) u ndanë në `taxMath.ts`, pa ndryshuar
  asnjë formulë, që të testohen pa databazë; `vat.ts` dhe `payroll.ts` i ri-eksportojnë.
- `compliance.ts`: rregullat e ATK-së me burimin, në një vend (`ATK_RULES`).

**Kontrolli para dorëzimit** (menyja → Administrata tatimore → *Kontrolli para dorëzimit*)
Për muajin e zgjedhur kontrollon në një faqe gjithçka që dorëzohet. Çdo gjetje ka butonin *Rregullo*, që e hap faqen
ku rregullohet:
- **librat**: numri i faturës, emri, NUI 9 shifra (10 për numrin personal te blerjet), shuma e normave = totali,
  TVSH = 18% / 8% e bazës, data brenda periudhës, dyfishimet, TVSH e zbritshme pa nr. TVSH të shitësit;
- **TVSH**: kutia [30] dhe [67] e deklaratës krahasohen me totalet e librit të shitjes / blerjes;
- **pagat WM/CM**: numri personal 10 shifra dhe pa dyfishim, kontributi ≥ 5%, tatimi sipas shkallëve të ATK-së,
  neto = bruto − kontributi − tatimi, avansi më i madh se neto, IBAN-i për urdhërpagesë;
- **regjimi**: forma juridike kundrejt regjimit (B.I. me tatim korporate, SH.P.K. me regjim individual), pragu 50.000 € /
  30.000 € i regjimit 3%/9%, pragu 30.000 € i TVSH-së, forma tremujore që pret ATK (IS / IL / QS / QL); në janar–mars
  kujtesa për RB.

**Validimi para eksportit të librave**: kur kontrolli ka gabime, *Libri i shitjes / blerjes (ATK)* nuk shkarkohet me
një klik – del arsyeja dhe zgjedhja *Shkarko gjithsesi*.

**Blerjet mbi 500 € (RB)** – faqe e re: furnitorët me blerje ≥ 500 € gjatë vitit (notat kreditore zbriten; importet dhe
ngarkesa e kundërt nga jashtë nuk hyjnë), kontrolli i numrit fiskal që mungon ose është gabim, i njëjti NUI me emra të
ndryshëm, kush e ka detyrim (të ardhurat reale; përjashtimi i deklaruesve të TVSH-së me librat e 12 muajve), Excel.

**Afatet** (Tatimet e tjera dhe afatet): shtohen LB/LSH tremujore për bizneset jashtë TVSH-së, RB dhe PF (31 mars), me
lidhje te faqja përkatëse.

**Kalimi i shpejtë ndërmjet bizneseve – Ctrl+K** (ose klik te "Kompania aktive"): kërkim me emër, NUI, qytet ose nr.
TVSH; kompania tjetër hapet **në të njëjtën faqe** (p.sh. nga TVSH-ja e klientit A direkt te TVSH-ja e klientit B –
një veprim në vend të tre). Me fjalë kërkimi del edhe çdo faqe e kompanisë ("pagat", "wr", "ditari"…). Tastiera:
↑ ↓ Enter Esc.

## 4. Testimi

| Prova | Rezultati |
|---|---|
| `npm run test:kontabilist` (i ri, `scripts/compliance-selftest.ts`) – tatimi vjetor, tatimi në paga (klienti = kontrolli = formula e DB-së në 9 vlera kufitare), paga neto, kutitë 30/67/69/70/71/72 të TVSH-së, totalet e librave, kontrollet e librave, RB, kontrollet e pagave, forma juridike, regjimi, format tremujore, afatet | **68 / 68 të sakta** |
| `scripts/books-preview.ts` + krahasim qelizë për qelizë me `public/atk/*.xlsx` | fletët, titujt, qelizat e bashkuara, gjerësitë dhe formulat identike; ndryshojnë vetëm rreshtat shembull të shabllonit |
| `scripts/atk-forms-preview.ts` (lista e pagave .xls, WR .xlsx) | gjenerohen; WR: tekstet dhe qelizat e bashkuara të shabllonit të pandryshuara |
| `npm run test:fiscal` | kalon |
| `tsc -b`, `npm run build`, `npm run build:kontabilist` | pa gabime |
| Shfletuesi (`kontabilist-dev`) | hyrja ngarkohet pa gabime në konsolë; modulet e reja ngarkohen. **Faqet e reja nuk janë parë me të dhëna reale** – kërkojnë hyrje me llogari kontabilisti |

## 5. Për t'u verifikuar (nuk u konfirmua nga burim zyrtar)

1. **Formulari i TVSH-së TV-A7 (2015)** dhe numrat e kutive: ATK nuk ka publikuar formular të ri në burimet që u
   lexuan; duhet krahasuar me formularin aktual në EDI.
2. **Importi në EDI i librave**: skedarët janë shabllonët zyrtarë të mbushur; nuk u testua ngarkimi real në EDI. Pyetje
   të hapura: a pranon EDI NUI-në si numër (programi e shkruan numër kur ka vetëm shifra) dhe kodi "3" (eksport) /
   "2" (shërbim jashtë) në librin **jo TVSH**.
3. **RB**: raporti dorëzohet online në ATK (forma në ueb). Excel-i i programit është listë pune, jo format importi, sepse
   nuk u gjet format zyrtar importi. Njoftimi i ATK-së për rregullat është i vitit 2019 (Ligji 03/L-222); ATK e liston
   ende RB me afatin 31 mars. Konfirmo nëse kufiri 500 € vlen me apo pa TVSH.
4. **Tatimi në qira 9%** llogaritet nga totali i faturës me kategori "Qiraja" (`acc_tax_overview`, DB). Duhet konfirmuar se
   mbahet vetëm kur qiradhënësi është person fizik dhe mbi shumën pa TVSH.
5. **Pragu 50.000 € / 30.000 €** krahasohet me shitjet e 12 muajve të fundit; ligji flet për të ardhurat bruto **vjetore**
   (viti kalendarik).
6. **Deklaratat vjetore PD / CD / PF**: programi ka pasqyrat, por jo formularët e ATK-së. Duhen shabllonët zyrtarë aktualë.
7. Kalendari në databazë (`acc_tax_calendar`) e shfaq tatimin tremujor për çdo klient, edhe kur regjimi nuk e kërkon;
   afatet shtesë (LB/LSH jo TVSH, RB, PF) llogariten në klient dhe nuk dalin ende në kalendarin e përbashkët të zyrës.

## 6. Çka mungon për zyra të mëdha dhe korporata (renditur sipas dobisë)

**Ndarja e përgjegjësive dhe aprovimet**
- Hapat *Përgatitur → Rishikuar → Miratuar → Dorëzuar* për TVSH-në, pagat dhe mbylljen e muajit: asistenti përgatit,
  kontabilisti miraton, me emrin dhe kohën e secilit (sot ka vetëm draft/deklaruar dhe kufizimet e asistentit).
- Kontabilisti përgjegjës dhe zëvendësi për çdo klient; faqe "Puna ime" me afatet e klientëve të mi, të filtruara sipas
  rrezikut (gabimet e *Kontrollit para dorëzimit*).
- Leje sipas modulit (p.sh. vetëm pagat), jo vetëm sipas rolit.

**Shumë biznese nga një vend**
- Kontrolli para dorëzimit **për të gjithë klientët** njëherësh (lista: klienti, gabimet, afati) – kjo kërkon një RPC
  që i kthen dokumentet e shumë klientëve, ose ekzekutim në Edge Function. Hapi tjetër i natyrshëm pas kësaj dege.
- Veprime në grup: shëno "deklaruar" për shumë klientë, shkarko librat e të gjithëve në një ZIP.

**Korporatat me kontabilitet të brendshëm**
- Njësitë / departamentet / qendrat e kostos në rreshtat e faturave dhe në ditar, raportet sipas tyre.
- Konsolidimi i disa subjekteve të grupit dhe eliminimi i transaksioneve brenda grupit.
- Buxheti dhe krahasimi buxhet – realizim.

**Automatizimi**
- Rregulla për kontimin automatik të ekstraktit bankar sipas partnerit/përshkrimit (mësohen nga rakordimet e mëparshme).
- Faturat periodike (qira, abonime) dhe amortizimi automatik në mbyllje të muajit.
- Leximi me AI i ekstraktit bankar PDF.

**Raportimi dhe kontrolli**
- Krahasimi i periudhave (muaji/viti i kaluar) në pasqyra, me ndryshimin në % .
- Analitika e partnerëve: furnitorët kryesorë, vonesat e pagesave, DSO/DPO.
- Bllokimi i periudhës së deklaruar për ndryshime (mbyllja ekziston; lidhja me deklaratën e TVSH-së duhet).

**Performanca dhe siguria në volum të madh**
- `acc_clients_overview` agregon të gjithë klientët për muaj në një thirrje; për mbi ~1.000 klientë duhet faqosje ose
  pamje e materializuar.
- `fetchBookDocs` bie muaj pas muaji te `acc_vat_book` para migrimit 0032 (deri 24 thirrje për vit) – pas 0032 një
  thirrje; mjafton të sigurohet që 0032 është vendosur kudo.
- Backup-i (0028) ekziston; shto testin periodik të rikthimit.

**Integrimi me KontoSef.app dhe sisteme të tjera**
- Sot: kuponët dhe hyrjet e mallit lexohen. Mungon: furnitorët e KontoSef-it si partnerë, kthimet/anulimet si nota
  kreditore në libër me referencë te kuponi origjinal, dhe njoftimi i kontabilistit kur arka punon offline mbi 24 orë.
- Importi i faturave elektronike (UBL/XML) kur ATK ta ofrojë e-faturën; API me çelës për zyrat që kanë ERP.
- *Kufizim:* ATK nuk ka API publike për dorëzim; programi përgatit skedarët, dorëzimi bëhet në EDI.

## 7. Dizajni

Ndryshimet u mbajtën brenda sistemit ekzistues (Inter, kartat 14px, ngjyrat `brand-*`, lucide), pa elemente
dekorative. Ndryshimi më i madh në përdorim është Ctrl+K; etiketa e gjatë "Skanimi me AI (blerje, shpenzim, investim, shitje)" u shkurtua në "Skanimi me AI". Propozime për hapin tjetër:
- Menyja ka 30 faqe në 9 grupe; "Administrata tatimore" do të ishte më e qartë si një faqe me hapat e muajit
  (Kontrolli → Librat → TVSH → Pagat → WR → Shëno të dorëzuar) në vend të pesë lidhjeve të ndara.
- Karta e kompanisë mbi çdo faqe zë ~100px; në ekrane të vogla mund të bëhet një rresht.

## 8. Ridizajnimi i ndërfaqes (dega e njëjtë)

Ndryshimet prekin vetëm Kontabilistin: sistemi i dizajnit është te `src/kontabilist/theme.css`, i kufizuar me klasën
`acc` në `<html>`, kështu që arka KontoSef dhe komponentët e përbashkët mbeten siç janë.

**Sistemi i dizajnit.** Skaje 3–4px, pa hije, pa gradiente dhe pa animacione kalimi. Një ngjyrë kryesore (`brand-600`)
për veprimet dhe gjendjen aktive; e kuqja dhe portokallia vetëm për gabime dhe afate. Në desktop dendësia rritet
rreth 12% (baza 14px, kontrollet 34px në vend të 44–48px, titujt 18/16/14px, të dhënat 13px me `tabular-nums`). Në
telefon mbeten 44px dhe input-et 16px.

**Navigimi.** Një kornizë e vetme (`Frame.tsx`) për të gjitha faqet:
- shirit i errët sipër: zyra, kërkimi global dhe llogaria;
- menu e majtë kompakte (rreshta 32px): faqet e zyrës, pastaj kompania e hapur me menunë në 10 grupe sipas rendit të
  punës (Dokumentet → Thesari → Libri kontabël → Raportet → Tatimet – ATK → Pagat…). Grupet mbyllen dhe hapen, menuja
  ngushtohet në ikona, dhe të dyja mbahen mend;
- koka e faqes në një rresht (kompania › grupi, titulli, veprimet dhe periudha) në vend të kartës së madhe të kompanisë.

**Kërkimi global (Ctrl+K)** gjen kompanitë, faqet (edhe me kodet e ATK-së: "wm", "lsh", "rb", "qs"…) dhe dokumentet e të
gjithë klientëve që përdoruesi i sheh (numri, partneri, NUI; RLS-ja e `acc_documents` e kufizon). Dokumenti hapet
direkt; kompania tjetër hapet në të njëjtën faqe.

**Tabela e re (`DataTable.tsx`).** Përdoret te kompanitë dhe te shitjet / blerjet / proformat:
- titujt e fiksuar gjatë lëvizjes poshtë dhe renditja sipas çdo kolone;
- kolonat shfaqen/fshihen dhe gjerësia ndryshohet me tërheqje; konfigurimi ruhet për përdorues në këtë pajisje;
- kërkimi i shpejtë (`/`);
- zgjedhja e shumë rreshtave me totalet e tyre dhe Excel i zgjedhjeve;
- shumat djathtas me totale në fund, Excel i asaj që shihet;
- tastiera: ↑ ↓ Enter, Hapësira për zgjedhje.

**Panelet.**
- *Kompanitë* (faqja e parë): rreshti i muajit, tri lista pune (afatet, detyrat, dokumentet e kërkuara nga klientët) dhe
  tabela e kompanive. Detyrat janë të ekipit për administratorin dhe të vetat për të tjerët; secili sheh vetëm
  klientët e vet (RLS).
- *Paneli i kompanisë*: "Për t'u bërë" (gabimet e kontrollit ATK të muajit të kaluar, TVSH-ja, faturat për pagesë,
  banka pa rakorduar, klientët me vonesë), afatet, detyrat dhe kërkesat, rezultati sipas muajve si tabelë me shifra (në
  vend të grafikut), pozicioni financiar dhe dokumentet e fundit. Kartat statistikore mbi listat u bënë një rresht.

**Tastiera dhe formularët.**
- Shkurtesat: Ctrl+K, Alt+←/→ për periudhën, N për dokument të ri, / për kërkim në tabelë, Ctrl+Enter për ruajtjen e
  faturës, ? për listën e shkurtesave.
- Fatura e re merr kategorinë e përdorur herën e fundit me të njëjtin partner.
- NUI e paplotë tregohet poshtë fushës.

**Nuk u ridizajnua ende** (marrin vetëm stilin e ri të përbashkët): formularët e brendshëm të TVSH-së, pagave, HR-së,
bankës, inventarit, ditarit dhe pasqyrave. Tabelat e tyre duhet të kalojnë te `DataTable` një nga një.

## 9. Formularët e zyrës (kontratat, aktvendimi, pasqyrat KSRF)

Burimi: skedarët origjinalë të zyrës (`formatet e atks`), të përgatitur si shabllone në `public/hr/` me
`scripts/prepare-hr-templates.ts`. Përgatitja mund të ekzekutohet përsëri kur ndryshon ndonjë formular.
Paraqitja e skedarëve nuk preket: vetëm vendet bosh marrin shenja, me formatin e pjesës origjinale. Pa të dhëna,
dokumenti del identik me origjinalin; kjo është kontrolluar me tekstin e plotë të të dy kontratave.

| Formulari | Ku | Çka plotësohet |
|---|---|---|
| Kontrata e punës me kohë të caktuar / të pacaktuar (.docx) | Punonjësit → Kontrata | kompania, NUI, adresa, përfaqësuesi; punonjësi, nr. personal, vendbanimi, profesioni, IBAN, detyrat; periudha, fillimi, puna provuese; orët, orari, vendi; paga bruto mujore dhe për orë (bruto ÷ orët mujore = orët javore × 52 ÷ 12); pushimi vjetor; gjykata (qyteti i kompanisë). Pas shkarkimit tregohen fushat që mbetën bosh. |
| Aktvendim për pushim vjetor (.docx) | Pushimet → Vendimi (pushimi vjetor) | koka (kompania, NUI, adresa), punonjësi, viti, ditët, nga–deri, data e kthimit (dita e parë e punës pas pushimit) |
| Pasqyrat financiare sipas SKRF (.xlsx) | Pasqyrat financiare → Pasqyrat KSRF | fleta "Shpalosje" nga bilanci provues i vitit (kolona C) dhe i vitit para tij (D); 3.2 mjetet në kolonën G; titujt dhe vitet. Fletët B-Gj, P-A, PNE, Prr-P i llogarit Excel-i me formulat e skedarit kur hapet. |

**Të dhënat shembull të origjinaleve u hoqën:**
- aktvendimi kishte 8 vendime me punëtorët e një kompanie tjetër, dhe mbeti vetëm struktura e njërit;
- pasqyrat kishin emrin, NUI-në, adresën dhe shifrat e vitit 2023 të asaj kompanie, si dhe rezultatet e formulave të ruajtura;
- te të gjithë skedarët u hoqën emrat e autorëve në metadata.

**Ndryshimet e vetme në paraqitje (vetëm kur ka të dhëna):**
- Te "Vendi i punës" etiketa është e qendërzuar me 13 hapësira dhe me zhvendosje negative. Kur ka vlerë, ai paragraf
  merr zhvendosje 0 dhe rreshtim majtas, përndryshe teksti del jashtë qelizës.
- Aktvendimi mbaron me një paragraf të fshehur 0,7 pt, në vend të rreshtave bosh që e kishin aktvendimin tjetër
  pas vetes. Kështu printohet në 1 faqe, si në origjinal.

**Lidhja e kontove me shpalosjet** (plani kontabël i programit):
- **Paraja (3.3):** arka 1010 dhe banka 10xx; saldo negative shkon te mbitërheqja (3.7).
- **Arkëtueshmet dhe parapagimet:** arkëtueshmet 1200 te 3.4; parapagimet 14xx dhe TVSH 1600 te 3.4.1. Kredia e TVSH-së
  (3790 me saldo debi) llogaritet si parapagim i TVSH-së.
- **Stoqet dhe mjetet:** stoqet 13xx te 3.5; mjetet 22xx dhe amortizimi 229x te 3.2.
- **Detyrimet:** furnitorët 31xx te 3.8; kreditë 32xx, pagat 34xx, kontributet 35xx, TVSH 36xx/3790 dhe tatimet 3700 te 3.7.
- **Kapitali (3.13):** kapitali 4000; pjesa tjetër e kapitalit dhe rezultatet e viteve të kaluara si fitime të bartura.
- **Të hyrat dhe KMSH:** të hyrat 5xxx te 3.6; KMSH 6000 te 3.9.
- **Shpenzimet:** administrative, të shpërndarjes dhe financiare sipas kontos (3.10.1–3.10.3); pagat edhe te 3.10.1.1.
- **Konto të tjera:** shkojnë te "të tjera" dhe tregohen pas shkarkimit.

**Për t'u konfirmuar:**
1. Bilanci (B-Gj) i merr furnitorët nga 3.8 (D34) dhe pjesën tjetër të 3.7 nga C116 (D40) pa zbritur rreshtin 114.
   Prandaj furnitorët shkruhen vetëm te 3.8, që të mos numërohen dy herë.
2. Kreditë 32xx shkojnë te "Kredi afatgjatë" (programi nuk e ndan pjesën afatshkurtër).
3. Tatimi 3700 shkon te "Obligimi për tatim në fitim"; P-A e llogarit vetë tatimin 10% të fitimit.
4. Stoku 1300 shkon te "Mallrat e përfunduara".
5. Pasqyra e rrjedhës së parasë (Prr-P) mbetet për t'u plotësuar me dorë, siç është edhe në skedar.
6. Excel-i në këtë kompjuter nuk u hap dot me automatizim (bllokohet edhe me skedarin origjinal), ndaj rezultatet e
   formulave nuk u lexuan nga Excel. Barazimi u kontrollua me të njëjtat formula në program (diferenca 0 me provën dhe
   me JetFund SH.P.K.).
