package com.jagjit.edith.companion

import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import java.util.UUID

class MainActivity : AppCompatActivity() {

    private var bridgeServer: EdithLocalBridgeServer? = null
    private lateinit var statusView: TextView
    private lateinit var tokenText: TextView
    private lateinit var toggleBridgeBtn: Button
    private lateinit var pairingToken: String
    private var promptedThisSession = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val prefs = getSharedPreferences("edith_companion", Context.MODE_PRIVATE)
        pairingToken = prefs.getString("pairing_token", null) ?: UUID.randomUUID().toString().take(12).also {
            prefs.edit().putString("pairing_token", it).apply()
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.BLACK)
            setPadding(48, 72, 48, 48)
        }

        val title = TextView(this).apply {
            text = "ULTRON Android Companion"
            textSize = 22f
            setTextColor(Color.WHITE)
        }
        val subtitle = TextView(this).apply {
            text = "Native Accessibility & Localhost Bridge (127.0.0.1:8765)"
            textSize = 13f
            setTextColor(Color.parseColor("#9CA3AF"))
            setPadding(0, 8, 0, 32)
        }

        statusView = TextView(this).apply {
            textSize = 14f
            setTextColor(Color.parseColor("#93C5FD"))
            setPadding(0, 0, 0, 28)
        }

        tokenText = TextView(this).apply {
            text = "Pairing Token: $pairingToken"
            textSize = 14f
            setTextColor(Color.WHITE)
            setPadding(0, 0, 0, 16)
        }

        val copyTokenBtn = Button(this).apply {
            text = "Copy Pairing Token"
            setOnClickListener {
                val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("ULTRON Pairing Token", pairingToken))
                Toast.makeText(this@MainActivity, "Token copied!", Toast.LENGTH_SHORT).show()
            }
        }

        toggleBridgeBtn = Button(this).apply {
            text = "Start Local Bridge Server"
            setOnClickListener {
                if (bridgeServer?.isRunning() == true) {
                    bridgeServer?.stop()
                } else {
                    bridgeServer = EdithLocalBridgeServer(this@MainActivity, 8765, pairingToken)
                    bridgeServer?.start()
                }
                refreshStatus()
            }
        }

        val openAccBtn = Button(this).apply {
            text = "Enable Accessibility Service"
            setOnClickListener {
                openAccessibilitySettings()
            }
        }

        val openAppInfoBtn = Button(this).apply {
            text = "Allow Restricted Settings (Android 13+)"
            setOnClickListener {
                openAppDetailsSettings()
            }
        }

        val openOverlayBtn = Button(this).apply {
            text = "Grant Display Over Other Apps"
            setOnClickListener {
                startActivity(
                    Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:$packageName")
                    )
                )
            }
        }

        root.addView(title)
        root.addView(subtitle)
        root.addView(statusView)
        root.addView(tokenText)
        root.addView(copyTokenBtn)
        root.addView(toggleBridgeBtn)
        root.addView(openAccBtn)
        root.addView(openAppInfoBtn)
        root.addView(openOverlayBtn)
        setContentView(root)

        bridgeServer = EdithLocalBridgeServer(this, 8765, pairingToken)
        bridgeServer?.start()

        val forcePrompt = intent?.action == "com.jagjit.edith.companion.REQUEST_ACCESSIBILITY"
        promptAccessibilityIfNeeded(forcePrompt)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == "com.jagjit.edith.companion.REQUEST_ACCESSIBILITY") {
            promptAccessibilityIfNeeded(force = true)
        }
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    override fun onDestroy() {
        super.onDestroy()
        bridgeServer?.stop()
    }

    private fun isAccessibilityEnabled(): Boolean {
        if (EdithAccessibilityService.instance != null) return true
        val expectedComponent = ComponentName(this, EdithAccessibilityService::class.java).flattenToString()
        val enabledServices = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false
        val splitter = TextUtils.SimpleStringSplitter(':')
        splitter.setString(enabledServices)
        while (splitter.hasNext()) {
            if (splitter.next().equals(expectedComponent, ignoreCase = true)) {
                return true
            }
        }
        return false
    }

    private fun openAccessibilitySettings() {
        Toast.makeText(
            this,
            "Select 'ULTRON Automation Accessibility' and turn it ON",
            Toast.LENGTH_LONG
        ).show()
        startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
    }

    private fun openAppDetailsSettings() {
        Toast.makeText(
            this,
            "Tap 3-dot menu (top right) -> Allow restricted settings",
            Toast.LENGTH_LONG
        ).show()
        startActivity(
            Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:$packageName")
            )
        )
    }

    private fun promptAccessibilityIfNeeded(force: Boolean) {
        if (isAccessibilityEnabled()) return
        if (!force && promptedThisSession) return
        promptedThisSession = true

        AlertDialog.Builder(this)
            .setTitle("Accessibility Permission Required")
            .setMessage(
                "ULTRON needs Accessibility Service permission to inspect active screens, tap buttons, enter text, scroll, and open Settings sub-screens when you run automation commands.\n\n" +
                    "On Android 13+: if the toggle looks disabled, first tap 'App Info -> Allow Restricted Settings'."
            )
            .setPositiveButton("Open Accessibility Settings") { _, _ ->
                openAccessibilitySettings()
            }
            .setNeutralButton("App Info (Android 13+)") { _, _ ->
                openAppDetailsSettings()
            }
            .setNegativeButton("Later", null)
            .show()
    }

    private fun refreshStatus() {
        val accActive = isAccessibilityEnabled()
        val overlayGranted = Settings.canDrawOverlays(this)
        val bridgeActive = bridgeServer?.isRunning() == true

        statusView.text = buildString {
            appendLine("Bridge Server: ${if (bridgeActive) "RUNNING (127.0.0.1:8765)" else "STOPPED"}")
            appendLine("Accessibility Service: ${if (accActive) "ACTIVE" else "OFF (Permission Needed)"}")
            append("Overlay Permission: ${if (overlayGranted) "GRANTED" else "NOT GRANTED"}")
        }
        toggleBridgeBtn.text = if (bridgeActive) "Stop Local Bridge Server" else "Start Local Bridge Server"
    }
}
