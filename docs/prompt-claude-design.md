# Prompt për Claude Design – ekranet e reja të Kasa

Bashkëngjit screenshot-et nga `design/screenshots/` (Login, Main, Arka, Produktet, Stoku, Cilesimet, Fatura dhe
versionet M-*), pastaj ngjit tekstin më poshtë. Dërgoje në 3 pjesë (Pjesa A, B, C) që secila të dalë e plotë.

---

## Teksti bazë (ngjite para çdo pjese)

Jam duke ndërtuar **Kasa**, një aplikacion arke (POS) për biznese në Kosovë: market, kafiterie/restorant,
barnatore, butik veshjesh dhe sallon. Screenshot-et që të bashkëngjita janë ekranet ekzistuese – **ruaj saktë të
njëjtin stil**: sidebar i errët jeshil në desktop, menu poshtë (tab bar) në telefon, kartat e bardha, të njëjtat
butona, tabela, badge dhe fusha.

Sistemi i dizajnit:
- Ngjyrat: brand-900 #10241B (sidebar, header i errët), brand-800 #1B3A2C (hover), brand-600 #0E6B4E (butoni
  kryesor, aktiv), brand-400 #3FBF86 (logo), brand-100 #E3F1EA (sfond aktiv), ink #14201A (teksti), muted #56645C
  (teksti dytësor), line #E2E7E3 (kufijtë e kartave), field #CBD5CE (kufijtë e fushave), bg #F4F6F3 (sfondi),
  warn-700/100 #9A3412/#FFEDE0 (kritike, gabime), amber-700/100 #854D0E/#FEF3C7 (paralajmërime), bt-600 #1D4ED8
  (Bluetooth).
- Shkronja Inter 400/500/600/700; numrat me tabular-nums; fatura me IBM Plex Mono.
- Kartat radius 14px, butonat dhe fushat 10–12px, lartësia minimale e butonave 44px, ikonat lucide (stroke 2).
- Desktop 1440px me sidebar 232px; telefon 390px me tab bar poshtë (5 ikona) dhe shirit i errët pas orës.
- Gjithë teksti në shqip, me të dhëna realiste nga Kosova (emra, çmime në €, NUI, adresa në Prishtinë, Prizren…).
- Për çdo ekran: **një version desktop dhe një për telefon**.

---

## Pjesa A – Faqja publike dhe platforma

1. **Faqja e internetit (ballina)** – header i errët me logon "Kasa" dhe butonin "Hyr"; titulli kryesor; 5 kartat
   e llojeve të biznesit (Market, Kafiterie/Restorant, Barnatore, Butik/Veshje & Këpucë, Sallon/Shërbime) me ikonë
   dhe përshkrim; "Çfarë përfshihet" (punon në kompjuter dhe telefon, pa internet, printer Bluetooth, arkëtarë me
   PIN, raporte, fiskalizim në ATK); "Si fillohet" në 3 hapa; seksioni i shkarkimit; footer.
2. **Shkarko** – kartat për Windows (.exe), Android (Google Play + APK), iPhone/iPad (App Store) dhe "Përdore në
   shfletues", me versionin, madhësinë dhe 3 hapa instalimi për secilën.
3. **Platforma** (vetëm për adminin e të gjitha bizneseve) – lista e bizneseve: emri, lloji me ikonë, pronari dhe
   email-i i hyrjes, përdoruesit, shitjet, statusi, veprimet "Fjalëkalim i ri" dhe "Çaktivizo"; kërkim dhe filtër
   sipas llojit; butoni "Biznes i ri".
4. **Dritarja "Biznes i ri"** – zgjedhja e llojit me 5 karta (me shënimin "Lloji nuk ndryshohet më"), emri i
   biznesit, emri i pronarit, email-i, fjalëkalimi i gjeneruar me butonin e rigjenerimit.
5. **Dritarja "Të dhënat për hyrje"** – adresa, email-i dhe fjalëkalimi në kuti me shkronja mono, butonat "Kopjo"
   dhe "Dërgo në WhatsApp", paralajmërimi që fjalëkalimi nuk shfaqet më.

## Pjesa B – Ekranet e përbashkëta që mungojnë

6. **Raportet** – zgjedhja e periudhës (Sot, Dje, 7 ditë, Ky muaj, I zgjedhur), kartat e totaleve (shitjet,
   faturat, fitimi, TVSH), grafiku ditor, më të shiturat, TVSH sipas normës (E 18%, D 8%, C 0%, A e liruar), sipas
   arkëtarit, lista e faturave me kërkim dhe butoni "Eksporto".
7. **Detajet e një fature** (dritare) – fatura e plotë me artikujt, pagesat dhe ndarjen e TVSH-së, butonat
   "Printo kopje", "Anulo faturën" dhe "Kthim malli".
8. **Kthim malli** – kërko faturën me numër ose skanim, zgjidh artikujt dhe sasitë për kthim, arsyeja, totali që
   kthehet, konfirmimi.
9. **Fatura fiskale 80mm** – si Fatura.png por me të gjitha fushat e ATK-së: NUI, nr. TVSH, adresa e njësisë,
   operatori me ID, artikujt me shkronjën e TVSH-së, zbritjet me minus, pagesat sipas llojit, TVSH sipas normës,
   totali pa TVSH, data/ora, numri i SEF-it, numri ditor dhe rendor, NUIKF, kodi QR, logoja "RKS"; plus variantet
   "KOPJE E KUPONIT", "ANULIM" dhe "OFFLINE".
10. **Regjistro arkën në ATK** (Cilësimet → Arkat) – hapat: numri i fiskalizimit → verifikimi → certifikata e
    marrë; statuset (e pa regjistruar, në pritje, aktive, gabim) dhe mjedisi Test/Prod.
11. **Gjendja offline në arkë** – shiriti "Duke punuar pa internet – 3 fatura në pritje", lista e faturave në
    pritje me statusin e dërgimit dhe paralajmërimin për afatin 48 orë.
12. **Regjistri i veprimeve** – tabelë me datë/orë, përdoruesin, veprimin (hyrje, shitje, anulim, ndryshim
    çmimi…), detajet dhe filtrat; eksport CSV/PDF.

## Pjesa C – Ekranet sipas llojit të biznesit

13. **Sallon – Terminet** – kalendari ditor me një kolonë për çdo punëtor (ngjyra e tij), orët 08–21, blloqet e
    termineve me klientin dhe shërbimin; në telefon lista sipas orës; dritarja e terminit me klientin, telefonin,
    shërbimin, punëtorin, datën, orën, kohëzgjatjen dhe butonat "Paguaj në arkë", "I kryer", "Nuk erdhi", "Anulo".
14. **Sallon – Arka** – si Arka.png, me rreshtin "Punëtori: [Arta] [Blerina] [Dren]" dhe zgjedhjen e punëtorit në
    çdo rresht; shërbimet me kohëzgjatje në vend të stokut.
15. **Sallon – Punëtorët & Komisioni** – lista me ngjyrë, komisionin %, statusin; raporti i komisionit për periudhë.
16. **Restorant – Tavolinat** – plani i sallës me tavolina (të lira, të zëna me totalin dhe kohën, të rezervuara),
    zonat (Brenda, Terasa); hapja e tavolinës.
17. **Restorant – Porosia e tavolinës** – menuja sipas kategorive (Kafe, Pije, Ushqim), modifikuesit (pa sheqer,
    e madhe), "Dërgo në kuzhinë/bar", ndarja e llogarisë, ndërrimi i tavolinës, pagesa.
18. **Restorant – Ekrani i kuzhinës/barit** – kartat e porosive me tavolinën, kohën që ka pritur dhe artikujt,
    butoni "Gati".
19. **Butik – Produkti me variante** – tabela madhësi × ngjyrë me stokun dhe barkodin e secilës; printimi i
    etiketave me barkod.
20. **Butik – Arka** – zgjedhja e madhësisë dhe ngjyrës kur shtohet artikulli; ndërrimi i artikullit.
21. **Barnatore – Hyrja e mallit me seri dhe afat** – për çdo bar: numri i serisë (lot), afati i skadimit, sasia.
22. **Barnatore – Skadimet** – barnat që skadojnë brenda 30/60/90 ditëve dhe ato të skaduara, me ngjyra
    paralajmëruese; kërkimi sipas substancës aktive; shënimi "Me recetë".
23. **Paneli sipas llojit** – katër variante të Main.png: sallon (terminet e sotme, punëtorët), restorant (tavolinat
    e zëna, porositë në kuzhinë), butik (madhësitë që mungojnë), barnatore (skadimet).
24. **Paneli i punëtorit** (desktop + telefon) – ekrani që sheh punëtori pas hyrjes me PIN: butoni i madh "Shitje e
    re" / "Porosi e re" / terminet e tij të sotme (sipas llojit), "Puna ime sot" (numri i shitjeve/shërbimeve,
    totali, komisioni i vet), pa menu për produktet, stokun dhe raportet; menuja poshtë vetëm me Arka, Puna ime,
    Printeri.
25. **Puna e punëtorëve** (për adminin) – zgjedhja e punëtorit dhe periudhës; kartat (shitje, shërbime, totali,
    komisioni, orët e punës); lista e veprimeve të tij (faturat, shërbimet, anulimet, terminet) me orë; krahasimi i
    punëtorëve në një tabelë.
26. **Miratimi i adminit** – dritarja kur punëtori kërkon anulim/kthim: "Kërkohet PIN-i i menaxherit".
