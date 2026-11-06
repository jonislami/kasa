# Publikimi i Kasa-s (Windows, Android, iPhone, web)

Një kod, katër mënyra. Versioni merret nga `package.json` (`"version"`), shfaqet te Cilësimet dhe
dërgohet me çdo kupon fiskal. **Çdo version që prek fiskalizimin njoftohet te ATK para publikimit.**

## 0. Një herë: sekretet në GitHub
GitHub → repo `jonislami/kasa` → Settings → Secrets and variables → Actions → *New repository secret*:

| Emri | Vlera |
|---|---|
| `VITE_SUPABASE_URL` | si te `.env.local` |
| `VITE_SUPABASE_ANON_KEY` | si te `.env.local` |
| `ANDROID_KEYSTORE_BASE64` | *(opsionale, për Play Store)* keystore-i i koduar në base64 |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | *(opsionale)* |

Keystore-i krijohet një herë dhe **ruhet me kujdes** (pa të nuk mund të përditësohet aplikacioni në Play Store):
```bash
keytool -genkey -v -keystore kasa-release.keystore -alias kasa -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 kasa-release.keystore   # vlera për ANDROID_KEYSTORE_BASE64
```

## 1. Web (Vercel)
- Çdo push në `main` del live vetë. Variablat `VITE_SUPABASE_URL` dhe `VITE_SUPABASE_ANON_KEY` vendosen te
  Vercel → Project → Settings → Environment Variables.
- `vercel.json` kujdeset për rrugët (`/arka`, `/stoku`…) dhe që përditësimet e aplikacionit (service worker)
  të arrijnë menjëherë.

## 2. Version i ri për Windows + Android (automatikisht)
1. Ndrysho `"version"` te `package.json` (p.sh. `0.2.0`) dhe `versionCode` / `versionName` te
   `android/app/build.gradle` (versionCode rritet çdo herë: 100, 101, 102…).
2. Commit në `main`, pastaj:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
3. GitHub Actions (`.github/workflows/release.yml`) ndërton:
   - `Kasa-Setup-0.2.0.exe` + `latest.yml` → GitHub Release `v0.2.0`
   - `Kasa-0.2.0.apk` (dhe `.aab` për Play Store kur ka keystore) → i njëjti Release
4. Faqja `/shkarko` i merr vetë lidhjet dhe madhësitë nga Release-i i fundit.
5. Programet e instaluara në Windows e shkarkojnë versionin e ri vetë dhe pyesin "Instalo".

## 3. Windows në kompjuter (pa GitHub)
```bash
npm run dist:win        # release/Kasa-Setup-<version>.exe (nuk publikon)
npm run electron:start  # e hap programin nga dist/ për provë
```
Windows SmartScreen paralajmëron për programet pa nënshkrim kodi ("Më shumë info" → "Ekzekuto gjithsesi").
Për ta hequr: certifikatë *code signing* (OV/EV) dhe `win.certificateFile` / Azure Trusted Signing te
`electron-builder.yml`.

## 4. Android – Google Play
1. Llogari Google Play Console (25 $ një herë).
2. Aplikacion i ri: emri **Kasa**, paketa `app.kasa.pos`.
3. Ngarko `Kasa-<version>.aab` nga Release-i (kërkon keystore-in te sekretet).
4. Plotëso: përshkrimin në shqip, foto ekrani, politikën e privatësisë, lejet (Bluetooth për printerin,
   kamera për barkodin).
5. Pas aprovimit, vendos lidhjen te `PLAY_STORE_URL` në `src/features/download/DownloadPage.tsx`.

Provë lokale në telefon (kërkon Android Studio):
```bash
npm run cap:sync
npm run android:open    # Android Studio → Run
```

## 5. iPhone / iPad – App Store (në Mac)
Kërkon Mac me Xcode dhe llogari **Apple Developer** (99 $/vit).
```bash
npm ci
npm run cap:sync
npm run ios:open        # Xcode
```
1. Xcode → *Signing & Capabilities*: zgjidh ekipin, Bundle ID `app.kasa.pos`.
2. *Product → Archive* → *Distribute App* → App Store Connect.
3. App Store Connect: përshkrimi, foto, privatësia (Bluetooth, kamera), dërgo për shqyrtim.
4. Pas aprovimit, vendos lidhjen te `APP_STORE_URL` në `DownloadPage.tsx`.

## 6. Çka bën secila platformë (shtresa `src/lib/device/`)
| | Web | Windows (Electron) | Android / iPhone (Capacitor) |
|---|---|---|---|
| Printeri | Web Bluetooth, USB (Web Serial) – Chrome/Edge | Bluetooth + USB me listë pajisjesh në aplikacion | Bluetooth BLE (edhe në iPhone) |
| Ruajtja e enkriptuar | AES-GCM, çelës jo i eksportueshëm | AES-GCM, çelësi i mbrojtur me DPAPI | AES-GCM në WebView |
| Përditësimet | service worker ("Rifresko") | GitHub Releases ("Instalo") | Play Store / App Store |
| Çelësi i ATK-së | WebCrypto jo i eksportueshëm | WebCrypto (Faza 9: DPAPI) | WebCrypto (Faza 9: Keystore/Keychain) |
