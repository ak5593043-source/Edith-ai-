# ULTRON Android Companion (Native Accessibility Layer)

Why a Native Android Companion is Required
------------------------------------------
Standard web browsers and PWAs run inside an Android OS sandbox. While ULTRON's web app can launch apps and searches via `intent://`, `https://`, `tel:`, `sms:`, and `mailto:` links, browser JavaScript **cannot** read another app's screen hierarchy or perform taps, scrolling, or text entry inside third-party apps (Instagram, YouTube, Settings, WhatsApp).

`EdithAndroidCompanion` provides a free, open-source Kotlin Accessibility layer that runs strictly on `127.0.0.1:8765` with pairing-token authentication and zero shell execution.

Build & Installation Steps
--------------------------
1. Open `/android-companion` in **Android Studio** (or build via Gradle CLI):
   ```bash
   cd android-companion
   ./gradlew assembleDebug
   ```
   Output APK: `app/build/outputs/apk/debug/app-debug.apk`.
2. Install onto your Android phone via USB/ADB or APK file transfer:
   ```bash
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   ```
3. Launch **ULTRON Companion** on your phone:
   - Tap **Enable Accessibility Service** -> select **ULTRON Automation Accessibility** -> turn **ON**.
   - *(Android 13+ sideloaded APKs)*: If Accessibility toggle shows "Restricted setting", open *Phone Settings -> Apps -> ULTRON Companion -> 3-dot menu (top right) -> Allow restricted settings*, then return to Accessibility and toggle ON.
   - *(Optional)* Tap **Grant Display Over Other Apps** and disable Battery Optimization so the localhost bridge remains active in background.
4. Copy the **Pairing Token** shown in the app and paste it inside ULTRON Web App -> **Settings -> Automation -> Bridge Settings**.
5. Click **Check** — ULTRON will show `Native Android Companion` and unlock real cross-app `get_screen_information`, `tap_element`, `enter_text`, `scroll_screen`, and Settings sub-screen navigation.
