# Kërkesat e ATK-së për SEF – krahasimi me Kasën (16.11.2026)

Burimet (dosja "kriteret per seff"): Udhëzimi Administrativ (MF) 01/2026 (nenet 6, 7, 31–34, 37–46),
Kërkesat specifike teknike dhe funksionale – Kapitulli IV, nenet 22–31 dhe Shtojcat A, F, G, H (faqet 43–88),
Ndryshim-plotësimi i 22.06.2026 (dok. 01-06-1967), Kushtet dhe procedurat për certifikim të SEF (03.07.2026),
Udhëzuesi i sistemit për testim dhe aplikim, Forma për SEF, Ligji 08/L-257 (ruajtja e regjistrave 6 vjet),
"Njësitë matëse – Kategoritë" (docx).

Legjenda: ✅ e plotësuar · 🟡 pjesërisht · ❌ mungon · ➖ nuk vlen për Kasën

## A. Funksionet e detyrueshme (Neni 25–26, UA neni 32)

| # | Kërkesa | Gjendja | Shënim |
|---|---|---|---|
| 1 | Instalim në së paku një pajisje (ndryshimi 2026) | ✅ | Windows (.exe), Android (APK), web vetëm për menaxhim |
| 2 | Regjistrimi i çdo transaksioni me ID, datë/orë, operator, artikull, sasi, çmim, zbritje | ✅ | |
| 3 | Kuponi dërgohet në kohë reale, para printimit | ✅ | provuar me ATK test (kuponi 17) |
| 4 | Nënshkrim digjital ECDSA, çelës privat i sigurt, certifikatë nga ATK | ✅ | DPAPI (Windows), Keystore (Android) |
| 5 | HTTPS, format sipas "Specifikat e implementimit" | ✅ | |
| 6 | Çmimet me 4 shifra pas presjes, totalet me 2 | ✅ | |
| 7 | Të dhënat e pandryshueshme; anulimi/korrigjimi vetëm me transaksion të ri | ✅ | RPC + RLS |
| 8 | Historiku i plotë i ndryshimeve për transaksion dhe artikull | 🟡 | audit_log ka ndryshimet e çmimeve/cilësimeve; nuk ka historik për çdo artikull |
| 9 | Audit log (hyrje, shitje, anulim, konfigurim), **i mbrojtur me kriptim dhe kontroll integriteti**, ruajtje sipas ligjit (6 vjet) | 🟡 | ka regjistrin + CSV/printim; **mungon kontrolli i integritetit (zinxhir hash-esh)** |
| 10 | Offline: kuponi lëshohet me QR, shënohet "OFFLINE", njoftim vizual, dërgim automatik, 48 orë | ✅ | |
| 11 | Të dhënat lokale të enkriptuara | ✅ | radha offline AES-GCM |
| 12 | **Të dhënat e padërguara eksportohen në CSV/PDF vetëm me kërkesë të ATK-së** (ndryshimi 2026) | ❌ | duhet ekran/eksport te arka |
| 13 | Gabim i qartë + ri-provim automatik kur ATK refuzon | ✅ | |
| 14 | Ora e sinkronizuar me ATK (data, ora, min, sek) | ✅ | ora nga serveri + treguesi "Ora e saktë" |
| 15 | Gjurmët: dërguar/dështuar (data, ora, sekonda, nr., totali), gabimet, ndërhyrjet | 🟡 | fiscal_log ka dërgimet dhe gabimet; "ndërhyrjet/modifikimet në SEF" (versionet, përditësimet) nuk regjistrohen |
| 16 | Eksporti i log-eve CSV/PDF | ✅ | Regjistri i veprimeve |
| 17 | NUIKF alfanumerik, ≤ 16 karaktere | ✅ | |
| 18 | Ndërlidhje me kontabilitet/furnitorë | ✅ | Kasa Kontabilist |
| 19 | Letër termike 58–100 mm | ✅ | 58 dhe 80 mm |
| 20 | Print Preview me QR në ekran | ✅ | |
| 21 | "KOPJE E KUPONIT" në ri-printim | ✅ | |
| 22 | Kthimi i artikullit me referencë | ✅ | |
| 23 | Ndërrimi i artikullit (kthim + shitje e re) | ✅ | |
| 24 | Anulimi me arsye, i lidhur me origjinalin | ✅ | |
| 25 | Së paku 4 norma: A, C, D, E; pa vlera negative TVSH | ✅ | |
| 26 | Konfigurimi i njësive matëse dhe kategorive sipas listës së ATK-së | 🟡 | gati në `main`, del me 0.3.7; **duhen rregulluar 2 kode** (shih C) |
| 27 | **Shumëgjuhësia (shqip + serbisht, shkronja latine)** | ❌ | e gjithë ndërfaqja dhe kuponi vetëm shqip |
| 28 | **Blloku i veçantë i kuponëve** – futja në SEF e kuponëve me dorë (5 ditë) | ❌ | |
| 29 | Përditësimi i softuerit | ✅ | automatik (Windows), njoftim (Android) |
| 30 | Mënyrat e pagesës: kesh, kartelë, llogari bankare, vauçer, çek, SMS… | 🟡 | vetëm kesh / kartelë / të kombinuara |
| 31 | I njëjti artikull në një rresht | 🟡 | në arkë bashkohen, por te salloni i njëjti shërbim me punëtorë të ndryshëm del në rreshta të veçantë |
| 32 | Kuponi elektronik (me pëlqimin e blerësit), teksti "e-kupon" | 🟡 | printim + preview po; dërgimi elektronik dhe "e-kupon" jo (opsional: "printim **ose** dërgim") |
| 33 | Karburantet (neni 29), Taksi (neni 30), Automatët (neni 27) | ➖ | Kasa nuk i mbulon – deklarohet te aplikimi |

## B. Kuponi fiskal – Neni 25 pika 18, UA neni 7 dhe Shtojca F (shembujt zyrtarë)

| # | Elementi | Gjendja | Çfarë duhet ndryshuar |
|---|---|---|---|
| 1 | NUI/NF, nr. TVSH, emri, adresa, nr. i njësisë, operatori + ID | ✅ | etiketat si në shembull: "TATIMPAGUESI:", "NF-NUI:", "NUMRI I TVSH-SË:" |
| 2 | Artikujt: sasia, çmimi, emri, vlera, shkronja e TVSH-së | ✅ | shembulli: kolona "SASIA X ÇMIMI" (2 X 2.50) dhe "SHUMA" me shkronjën (5.00 D) |
| 3 | Zbritja për artikull: "Ulje 10%" nën artikull me minus | 🟡 | sot "zbritje"; duhet "Ulje x%" / vlera |
| 4 | Nëntotali dhe zbritja në total: "NËNTOTALI" + "ULJE 10%  -1.29" | 🟡 | sot "ZBRITJE GJITHSEJ" pa nëntotal |
| 5 | Totali, pagesat, TVSH sipas normës, totali pa TVSH | ✅ | |
| 6 | Data, ora, minutat; numri i SEF-it [Njësia]-[NUI]-[PosId]; numri rendor; numri ditor; QR; NUIKF | ✅ | |
| 7 | **Logoja RKS: stema + "RKS / MF", min 15×8 mm, max 20×10 mm (Shtojca A)** | ❌ | sot vetëm stema, rreth 14×16 mm (më e lartë se 10 mm) |
| 8 | **Kuponi i anuluar**: "KUPON FISKAL I ANULUAR", "KUPON FISKAL NR. … DATË: …", "ARSYEJA E ANULIMIT: …" | 🟡 | titulli sot "ANULIM"; rreshti me datën e origjinalit mungon |
| 9 | **Kuponi i kthimit**: "KUPON FISKAL KTHIMI", artikujt e origjinalit, "KTHIMI I ARTIKUJVE" me minus, "TOTALI I KTHIMIT", "TOTALI I MBETUR", "ARTIKUJ TË KTHYER - n" | ❌ | sot vetëm artikujt e kthyer me titullin "KTHIM MALLI" |
| 10 | "e-kuponi" (kur dërgohet elektronikisht) dhe "TEKST I LIRË" | 🟡 | teksti i lirë po (Cilësimet); "e-kuponi" jo |
| 11 | Logoja e biznesit lart (opsionale) | 🟡 | ka "Shfaq logon" te printeri – të kontrollohet që del në kupon |

## C. Njësitë dhe kategoritë (docx zyrtar)

- **VM = "Veshmbathje"** (tesha, këpucë) – jo "Vreshtari". Butikët duhet të marrin **VM** si kategori, jo TT.
- Njësia nr. 21 në listën zyrtare të makinës: **KWH** (në PDF del "KËH").
- **PM** është kodi i dy kategorive (nr. 8 dhe nr. 36) – kështu e ka edhe lista zyrtare.

## D. Certifikimi (Kushtet, Udhëzuesi, Forma)

1. Testimi në https://apps.atk-ks.org/sefaplikimi ("Testo para aplikimit") – ✅ në rrjedhë (ApplicationID test 843115822380).
2. Aplikimi: formulari (NUI/NF/ID, komuna, emri, email, adresa, telefoni, adresa postare, personi kontaktues, emri dhe
   versioni i SEF-it, përshkrimi) + dokumentet: NIP ose certifikata ARBK, përshkrimi i zgjidhjes dhe i integrimit +
   teknologjitë, manuali i përdoruesit, deklarata e pajtueshmërisë. **Vetëm PDF/DOCX/XLSX, maksimum 5 skedarë, 5 MB secili.**
3. Komisioni teston: sigurinë dhe integritetin, saktësinë e kuponëve, raportimin në kohë reale, ruajtjen dhe dërgimin pas
   ndërprerjes. Mangësitë: 7 ditë pune. Vendimi: 15 ditë pune. Refuzimi: riaplikim pas 30 ditësh.
4. Pas certifikimit: Numri identifikues i SEF-it + NUI/NF e zhvilluesit futen në softuer dhe dërgohen me çdo kupon.
5. Çdo ndryshim që prek gjenerimin, ruajtjen ose dërgimin e të dhënave fiskale njoftohet **paraprakisht** te ATK.

## E. Detyrimet e biznesit (jo të softuerit, por Kasa mund të ndihmojë)

- Njoftimi për kuponin fiskal në vend të dukshëm (UA neni 40) – përmbajtjen e cakton ATK; Kasa mund ta printojë kur ATK
  ta publikojë modelin.
- Njoftimi i ATK-së për ndryshime (lokacion, shitje, çregjistrim) – UA neni 31.4.
- Ruajtja e regjistrave 6 vjet (Ligji 08/L-257) – të dhënat e një biznesi nuk fshihen nga platforma.

## Rendi i propozuar i punës

1. **Kuponi sipas Shtojcës F**: logoja RKS me përmasat e sakta, etiketat, "Ulje", nëntotali, kuponi i anuluar dhe i
   kthimit si në shembuj (ekrani + printeri termik 58/80 mm).
2. **Kodet**: VM (butiku), KWH; publikimi i 0.3.7 pas provës me ATK.
3. **Eksporti i kuponëve të padërguar** (CSV + PDF) dhe **integriteti i audit log-ut** (zinxhir hash-esh) + regjistrimi i
   përditësimeve të softuerit.
4. **Blloku i veçantë i kuponëve**: futja e kuponëve të shkruar me dorë (numri serik, data) dhe dërgimi në ATK.
5. **Mënyrat e tjera të pagesës**: llogari bankare, vauçer, çek.
6. **Bashkimi i rreshtave** të njëjtë në kupon (edhe te salloni).
7. **Serbishtja**: ndërfaqja e arkës dhe kuponi (shkronja latine).
8. Opsionale: kuponi elektronik me "e-kuponi"; njoftimi për kuponin fiskal kur ATK ta japë modelin.

## Gjendja pas punës (dega `atk-kerkesat`, 16.11.2026)

| Pika | Çfarë u bë | Gjendja |
|---|---|---|
| B7 Logoja RKS | stema + "RKS / MF", 19 × 9,5 mm (ekran dhe printer termik) | ✅ |
| B1–B4 Kuponi | etiketat si në shembull, SASIA X ÇMIMI, "Ulje x%", NËNTOTALI + ULJE | ✅ |
| B8 Anulimi | "KUPON FISKAL I ANULUAR", nr. dhe data e origjinalit, "ARSYEJA E ANULIMIT", fatura origjinale | ✅ (kërkon 0033) |
| B9 Kthimi | "KUPON FISKAL KTHIMI", fatura origjinale, "KTHIMI I ARTIKUJVE", "TOTALI I KTHIMIT", "TOTALI I MBETUR" | ✅ (kërkon 0033) |
| C Kodet | VM = Veshmbathje (butikët), KWH | ✅ |
| A12 Kuponët e padërguar | eksport CSV/PDF vetëm me kërkesë (shënohet kërkesa, ruhet në regjistër) – arka dhe web | ✅ |
| A9 Integriteti i log-ut | zinxhir SHA-256 në regjistrin e veprimeve + "Kontrollo integritetin" | ✅ (kërkon 0034) |
| A15 Ndërhyrjet në SEF | çdo version i ri i programit në pajisje shënohet në regjistër | ✅ |
| A28 Blloku i veçantë | kupon nga blloku me numër serik dhe kohën në letër, nënshkruhet dhe dërgohet me atë kohë | ✅ |
| A30 Pagesat | transfer bankar, vauçer, çek (ATK: Voucher 3, Cheque 4, Other 6) | ✅ (kërkon 0033) |
| A31 Një artikull – një rresht | grupim në kupon dhe te ATK | ✅ |
| A27 Serbishtja | arka (hyrja, menuja, shitja, pagesa) dhe kuponi; zgjedhja te Printeri | 🟡 paneli i menaxhimit në web mbetet shqip |
| A32 e-kupon | kuponi me email (Edge Function send-ecoupon), me pëlqimin e blerësit, QR dhe "e-kuponi" | ✅ (kërkon send-ecoupon) |
