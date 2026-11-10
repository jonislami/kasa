# Kasa Kontabilist – plani i ndërtimit

Qëllimi: një zyrë kontabiliteti i menaxhon të gjitha bizneset e klientëve nga një llogari – faturat, blerjet,
shpenzimet, TVSH-ja, pagat, deklaratat, arka, banka, librat kontabël dhe raportet – me sa më shumë punë automatike.

Lista e plotë e funksioneve (23 pjesë + skanimi OCR/AI) është ndarë në **8 faza**. Çdo fazë del e përdorshme vetë
dhe shkon live vetëm pasi ta provosh. Pjesët e mëparshme mbeten, të njëjtat të dhëna vazhdojnë.

## Çka ka tash programi

| Pjesa | Gjendja |
|---|---|
| Shumë klientë nga një llogari, kalimi ndërmjet tyre, kërkimi dhe filtrat | ✅ |
| Të dhënat e klientit: emri, NUI, nr. fiskal, nr. TVSH, aktiviteti, adresa, kontaktet, shënimet, aktiv/arkivuar | ✅ (mungojnë përfaqësuesi, forma juridike, data e regjistrimit, dokumentet) |
| Faturat e shitjes dhe të blerjes të regjistruara si **shuma sipas normës** (18 / 8 / 0 / e liruar) | ✅ (pa rreshta artikujsh, pa pagesa, pa PDF) |
| Kategoritë e blerjeve/shpenzimeve (mall, mjete, shërbime, qira, komunali, paga, kontribute, tatime, telekom, transport, mirëmbajtje, marketing, banka) | ✅ |
| Importi i faturave nga Excel, eksporti në Excel | ✅ |
| TVSH-ja sipas muajit, statusi i periudhës (e hapur / e deklaruar / e mbyllur), afati 20 i muajit | ✅ |
| Fitimi dhe humbja, arka dhe stoku (për klientët që përdorin arkën Kasa – lexim) | ✅ |
| Lidhja me arkën Kasa: shitjet, hyrjet e mallit, stoku dalin vetë | ✅ |

## Fazat

### K1 – Partnerët, faturat dhe pagesat *(pjesët 3, 4, 5, 6)*
Baza për borxhet, TVSH-në e zbritshme dhe regjistrimet kontabël.
- **Klientët dhe furnitorët** e secilit biznes: NUI, nr. fiskal, nr. TVSH, adresa, kontaktet; historiku i faturave
  dhe pagesave; gjendja e llogarisë; eksporti.
- **Faturat e shitjes** të krijuara në program: numërim automatik sipas vitit, rreshta me produkte/shërbime, zbritje,
  18 / 8 / 0 %, eksport, proformë, fatura korrigjuese / kreditore / debitore (me referencë), këstet, PDF për printim,
  historiku i ndryshimeve.
- **Faturat e blerjes**: furnitori, nr. dhe data, vlera pa TVSH sipas normave, TVSH e zbritshme / e pazbritshme,
  klasifikimi, kontrolli i faturës së dyfishtë, bashkëngjitja e PDF-së/fotos.
- **Pagesat**: e paguar / pjesërisht / e papaguar, me kesh ose bankë; **borxhet** e klientëve dhe ndaj furnitorëve
  me vjetërsinë (0–30, 31–60, 61–90, 90+ ditë).
- **Shpenzimet**: kategoritë shtesë (karburanti, automjetet, administrative, operative, udhëtimet, përfaqësimi),
  dëshmia e bashkëngjitur, raportet mujore dhe vjetore.

### K2 – Arka, banka dhe paneli kryesor *(pjesët 1, 10)*
- Arka dhe llogaritë bankare të çdo biznesi; hyrjet/daljet, transferet, kreditë dhe këstet.
- **Importi i ekstraktit bankar** (CSV/Excel i bankave në Kosovë) dhe **rakordimi** automatik me faturat.
- Rrjedha e parasë.
- **Paneli**: bizneset aktive, shitjet ditë/muaj/vit, blerjet, shpenzimet, fitimi, tatimet për pagesë, faturat e
  papaguara, borxhet, gjendja e arkës dhe bankës, grafikët, afatet tatimore, aktivitetet e fundit.

### K3 – TVSH-ja dhe deklaratat në ATK *(pjesët 7, 9)*
- TVSH e zbritshme / e pazbritshme, për pagesë / kreditore (bartja), importet dhe eksportet, kontrolli i diferencave.
- **Deklarata e TVSH-së** e përgatitur sipas fushave të formularit të ATK-së, libri i shitjeve dhe blerjeve për
  EDI; historiku i deklaratave dhe ruajtja e konfirmimeve.
- Tatimi në të ardhura (individual – tremujor, korporata), tatimi në qira, tatimi në burim, pagesat tatimore.
- **Kalendari i afateve** me njoftime.
- *Kufizim:* ATK nuk ka qasje zyrtare për dorëzim automatik – programi i përgatit të dhënat dhe dokumentet, dorëzimi
  bëhet në EDI.

### K4 – Pagat dhe punëtorët *(pjesa 8)*
- Punëtorët: numri personal, pozita, data e punësimit, kontrata, paga bruto/neto.
- **Llogaritja automatike sipas ligjit në Kosovë**: kontributet pensionale 5% + 5% (Trusti), tatimi në paga sipas
  shkallëve, punëdhënësi parësor/dytësor.
- Fletëpagesat mujore (PDF), pushimet dhe mungesat, bonuset dhe avanset, historiku, raporti mujor, të dhënat për
  deklaratën e pagave dhe kontributeve.

### K5 – Kontabiliteti i plotë dhe asetet *(pjesët 11, 12, 14)*
- **Plani kontabël** (sipas SNK/SNRF për Kosovë), regjistri i ditarit, **regjistrimet automatike** nga faturat,
  pagesat, pagat dhe amortizimi; libri kryesor, libri i arkës dhe bankës.
- Bilanci provues, **bilanci i gjendjes**, pasqyra e të ardhurave, pasqyra e rrjedhës së parasë.
- Mbyllja mujore/vjetore, hapja e vitit të ri, korrigjimet.
- **Asetet**: kategoria, data dhe vlera e blerjes, norma, amortizimi automatik, vlera aktuale, shitja, raporti vjetor.
- Krahasimi i periudhave, eksporti Excel / PDF / CSV.

### K6 – Skanimi i faturave me OCR + AI *(pjesët 18, 23 – skanimi)*
- Fotografia nga telefoni, skaneri, PDF/JPG/PNG, disa fatura njëherësh; prerja dhe përmirësimi i fotos.
- AI lexon furnitorin, NUI/nr. fiskal, nr. dhe datën e faturës, vlerat pa TVSH dhe TVSH-në sipas normave, artikujt,
  zbritjet; propozon kategorinë dhe biznesin; kontrollon dyfishimin dhe shumat.
- Ekrani i verifikimit: fatura origjinale pranë të dhënave të lexuara, korrigjimi, **Konfirmo** → libri i blerjeve,
  shpenzimet, TVSH-ja dhe regjistrimi kontabël krijohen vetë; origjinali ruhet në arkiv.
- Statuset: Në pritje → E lexuar → Në verifikim → E konfirmuar → E regjistruar; kush e skanoi dhe kush e konfirmoi.
- Më vonë: asistenti AI (pyetje në gjuhë natyrale, analiza, parashikimi i parasë).
- *Duhet:* çelës API i shërbimit AI (Claude) në Supabase Edge Function – kostoja paguhet për faturë të lexuar.

### K7 – Zyra, ekipi dhe portali i klientit *(pjesët 16, 17, 19, 20)*
- Përdoruesit e zyrës: administratori, kontabilistët, asistentët; rolet, qasja vetëm në biznese/module të caktuara,
  historiku i veprimeve, **dy faktorë** (TOTP).
- Klientët e zyrës: kontrata e shërbimit, tarifa mujore, faturimi i shërbimeve, pagesat, detyrat, komunikimi,
  kërkesat për dokumente dhe statusi i tyre, kujtesat.
- **Portali i klientit** (web + telefon): faturat, raportet, borxhet, deklaratat; ngarkimi/fotografimi i faturave;
  mesazhet me kontabilistin.
- Njoftimet brenda programit dhe me email, raportet mujore automatike, faturat periodike.
- *Duhet:* shërbim për dërgimin e email-eve (p.sh. Resend) – çelësi në Supabase.

### K8 – Inventari, arkiva, siguria dhe cilësimet *(pjesët 13, 15, 21, 22, 23 – shtesë)*
- Inventari për klientët që nuk përdorin arkën Kasa: produktet, SKU/barkodi, depot dhe transferet, inventarizimi,
  vlerësimi, stoku i ulët.
- **Arkiva** e dokumenteve (fatura, kontrata, deklarata, banka, punëtorët) sipas biznesit/vitit/muajit, kërkimi.
- Backup ditor dhe rikthimi, regjistri i hyrjeve, sesionet aktive, fshirja e kontrolluar.
- Cilësimet: të dhënat dhe logoja e zyrës, faturat dhe numërimi, vitet fiskale, monedhat, normat, kategoritë,
  gjuhët, tema e errët, njoftimet.
- Abonimet dhe licencat e zyrave, API për integrime.
- *Kufizim:* integrimi direkt me bankat dhe ATK vetëm kur ofrohet qasje zyrtare.

## Rendi i propozuar
**K1 → K6 → K2 → K3 → K4 → K5 → K7 → K8.** K1 është baza (partnerët, faturat, pagesat, borxhet); menjëherë pas saj
skanimi me AI (K6), sepse e kursen më shumë punë dorë dhe mbështetet te faturat e blerjes së K1.
