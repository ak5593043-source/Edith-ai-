package com.jagjit.edith.companion

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class EdithAccessibilityService : AccessibilityService() {

    companion object {
        @Volatile
        var instance: EdithAccessibilityService? = null
            private set

        @Volatile
        var stopRequested: Boolean = false
            private set

        fun requestStop() {
            stopRequested = true
        }

        fun clearStop() {
            stopRequested = false
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        clearStop()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Passive observation on-demand via getScreenInformation(); zero heavy work on UI events
    }

    override fun onInterrupt() {
        // Required override
    }

    override fun onDestroy() {
        super.onDestroy()
        if (instance === this) {
            instance = null
        }
    }

    /**
     * Captures a compact, privacy-aware AccessibilityNodeInfo snapshot of the active Android window.
     * Password fields are automatically masked and security/CAPTCHA screens set securityBlocked=true.
     */
    fun getScreenInformation(): JSONObject {
        val root = rootInActiveWindow
        val visibleTexts = JSONArray()
        val interactive = JSONArray()
        val seenTexts = HashSet<String>()
        var securityBlocked = false
        var pkgName = root?.packageName?.toString() ?: ""

        if (root != null) {
            val flattened = mutableListOf<AccessibilityNodeInfo>()
            collectNodes(root, flattened, maxNodes = 250)

            var interactiveIdx = 0
            for (node in flattened) {
                if (pkgName.isEmpty() && node.packageName != null) {
                    pkgName = node.packageName.toString()
                }
                val isPwd = node.isPassword
                val rawText = if (isPwd) "[PROTECTED_INPUT]" else node.text?.toString()?.trim().orEmpty()
                val desc = node.contentDescription?.toString()?.trim().orEmpty()
                val viewId = node.viewIdResourceName?.substringAfterLast("/")?.trim().orEmpty()

                val combinedLower = "$rawText $desc".lowercase()
                if (
                    isPwd ||
                    combinedLower.contains("captcha") ||
                    combinedLower.contains("verify you are human") ||
                    combinedLower.contains("two-factor") ||
                    combinedLower.contains("enter otp")
                ) {
                    securityBlocked = true
                }

                if (rawText.isNotEmpty() && !isPwd && seenTexts.add(rawText) && visibleTexts.length() < 30) {
                    visibleTexts.put(rawText)
                }

                if ((node.isClickable || node.isEditable || node.isScrollable) && interactive.length() < 40) {
                    val rect = Rect()
                    node.getBoundsInScreen(rect)
                    val obj = JSONObject().apply {
                        put("index", interactiveIdx++)
                        if (rawText.isNotEmpty()) put("text", rawText)
                        if (desc.isNotEmpty()) put("contentDescription", desc)
                        if (viewId.isNotEmpty()) put("viewId", viewId)
                        put("className", node.className?.toString()?.substringAfterLast(".") ?: "View")
                        put("clickable", node.isClickable)
                        put("editable", node.isEditable)
                        put("scrollable", node.isScrollable)
                        put("bounds", JSONObject().apply {
                            put("left", rect.left)
                            put("top", rect.top)
                            put("right", rect.right)
                            put("bottom", rect.bottom)
                        })
                    }
                    interactive.put(obj)
                }
            }
        }

        val appLabel = resolveAppLabel(pkgName)
        return JSONObject().apply {
            put("source", "android-accessibility")
            put("timestamp", System.currentTimeMillis())
            put("packageName", pkgName)
            put("appName", appLabel)
            put("screenTitle", appLabel.ifEmpty { pkgName })
            put("visibleTexts", visibleTexts)
            put("interactiveElements", interactive)
            put("securityBlocked", securityBlocked)
            put(
                "summary",
                if (pkgName.isNotEmpty())
                    "Active screen: $appLabel ($pkgName), ${interactive.length()} interactive nodes."
                else
                    "No active window tree retrieved."
            )
        }
    }

    fun executeAllowlistedTool(tool: String, args: JSONObject): JSONObject {
        clearStop()
        return when (tool) {
            "open_app" -> handleOpenApp(
                appName = args.optString("appName", ""),
                packageName = args.optString("packageName", ""),
                targetScreen = args.optString("targetScreen", "")
            )
            "open_url" -> handleOpenUrl(
                url = args.optString("url", ""),
                browserApp = args.optString("browserApp", "default")
            )
            "search_text" -> handleSearchText(
                query = args.optString("query", ""),
                targetApp = args.optString("targetApp", "current")
            )
            "tap_element" -> handleTapElement(args)
            "scroll_screen" -> handleScrollScreen(
                direction = args.optString("direction", "down"),
                steps = args.optInt("steps", 1).coerceIn(1, 5)
            )
            "enter_text" -> handleEnterText(
                text = args.optString("text", ""),
                targetFieldHint = args.optString("targetFieldHint", ""),
                submitAfter = args.optBoolean("submitAfter", false)
            )
            "get_screen_information" -> JSONObject().apply {
                val obs = getScreenInformation()
                put("success", true)
                put("message", obs.optString("summary"))
                put("observation", obs)
            }
            else -> JSONObject().apply {
                put("success", false)
                put("error", "Tool '$tool' is not on the Android companion allowlist.")
            }
        }
    }

    private fun handleOpenApp(appName: String, packageName: String, targetScreen: String): JSONObject {
        if (stopRequested) return stoppedResponse()

        // Settings direct Android Intent support
        if (packageName == "com.android.settings" || appName.equals("settings", ignoreCase = true)) {
            val action = when (targetScreen.lowercase()) {
                "wifi", "wi-fi", "internet" -> Settings.ACTION_WIFI_SETTINGS
                "bluetooth" -> Settings.ACTION_BLUETOOTH_SETTINGS
                "display", "brightness", "dark mode" -> Settings.ACTION_DISPLAY_SETTINGS
                "sound", "volume" -> Settings.ACTION_SOUND_SETTINGS
                "battery" -> Intent.ACTION_POWER_USAGE_SUMMARY
                "apps" -> Settings.ACTION_APPLICATION_SETTINGS
                "privacy" -> Settings.ACTION_PRIVACY_SETTINGS
                "location" -> Settings.ACTION_LOCATION_SOURCE_SETTINGS
                "accessibility" -> Settings.ACTION_ACCESSIBILITY_SETTINGS
                else -> Settings.ACTION_SETTINGS
            }
            val intent = Intent(action).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
            startActivity(intent)
            Thread.sleep(650)
            return okWithObservation("Opened Android Settings ($targetScreen).")
        }

        val resolvedPkg = packageName.ifEmpty { guessPackage(appName) }
        if (resolvedPkg.isNotEmpty()) {
            val launchIntent = packageManager.getLaunchIntentForPackage(resolvedPkg)
            if (launchIntent != null) {
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                startActivity(launchIntent)
                Thread.sleep(800)
                return okWithObservation("Launched $appName ($resolvedPkg).")
            }
        }

        return errorResponse("App '$appName' ($resolvedPkg) is not installed or could not be launched.")
    }

    private fun handleOpenUrl(url: String, browserApp: String): JSONObject {
        if (stopRequested) return stoppedResponse()
        if (!url.startsWith("https://") && !url.startsWith("http://")) {
            return errorResponse("Only safe https:// or http:// URLs are permitted by companion.")
        }
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (browserApp == "chrome") {
                setPackage("com.android.chrome")
            }
        }
        startActivity(intent)
        Thread.sleep(800)
        return okWithObservation("Opened URL: $url")
    }

    private fun handleSearchText(query: String, targetApp: String): JSONObject {
        if (stopRequested) return stoppedResponse()

        when (targetApp.lowercase()) {
            "youtube" -> return handleOpenUrl("https://www.youtube.com/results?search_query=${Uri.encode(query)}", "default")
            "chrome", "google" -> return handleOpenUrl("https://www.google.com/search?q=${Uri.encode(query)}", "chrome")
        }

        // In-app accessibility search sequence: find Search button/box -> tap -> enter query -> submit
        val tapRes = handleTapElement(JSONObject().apply {
            put("text", "Search")
            put("contentDescription", "Search and explore")
        })
        if (tapRes.optBoolean("success")) {
            Thread.sleep(450)
        }
        return handleEnterText(query, targetFieldHint = "Search", submitAfter = true)
    }

    private fun handleTapElement(args: JSONObject): JSONObject {
        if (stopRequested) return stoppedResponse()
        val root = rootInActiveWindow ?: return errorResponse("No active window root available.")

        val targetText = args.optString("text", "").trim()
        val targetDesc = args.optString("contentDescription", "").trim()
        val targetViewId = args.optString("viewId", "").trim()
        val hasIndex = args.has("index") && !args.isNull("index")
        val targetIndex = if (hasIndex) args.optInt("index", -1) else -1

        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes, 250)

        var match: AccessibilityNodeInfo? = null
        if (targetIndex >= 0) {
            val interactive = nodes.filter { it.isClickable || it.isEditable || it.isScrollable }
            match = interactive.getOrNull(targetIndex)
        }
        if (match == null) {
            match = nodes.firstOrNull { node ->
                val nText = node.text?.toString()?.trim().orEmpty()
                val nDesc = node.contentDescription?.toString()?.trim().orEmpty()
                val nId = node.viewIdResourceName?.substringAfterLast("/")?.trim().orEmpty()

                (targetViewId.isNotEmpty() && nId.equals(targetViewId, ignoreCase = true)) ||
                    (targetDesc.isNotEmpty() && nDesc.contains(targetDesc, ignoreCase = true)) ||
                    (targetText.isNotEmpty() && (nText.contains(targetText, ignoreCase = true) || nDesc.contains(targetText, ignoreCase = true)))
            }
        }

        if (match == null) {
            return errorResponse("UI element not found on screen (text='$targetText', desc='$targetDesc').")
        }

        // Climb up to nearest clickable container if target text node itself isn't flagged clickable
        var clickableNode: AccessibilityNodeInfo? = match
        while (clickableNode != null && !clickableNode.isClickable) {
            clickableNode = clickableNode.parent
        }

        val clicked = clickableNode?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true
        if (clicked) {
            Thread.sleep(350)
            return okWithObservation("Tapped UI element '${targetText.ifEmpty { targetDesc.ifEmpty { targetViewId } }}'.")
        }

        // Coordinate gesture tap fallback
        val bounds = Rect()
        match.getBoundsInScreen(bounds)
        val cx = bounds.centerX().toFloat()
        val cy = bounds.centerY().toFloat()
        if (cx > 0f && cy > 0f && dispatchTapGesture(cx, cy)) {
            Thread.sleep(350)
            return okWithObservation("Gesture tapped (${cx.toInt()}, ${cy.toInt()}).")
        }

        return errorResponse("Found element, but could not perform click or tap gesture.")
    }

    private fun handleEnterText(text: String, targetFieldHint: String, submitAfter: Boolean): JSONObject {
        if (stopRequested) return stoppedResponse()
        val root = rootInActiveWindow ?: return errorResponse("No active window root available.")
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes, 250)

        val editableNodes = nodes.filter { it.isEditable }
        val targetNode = editableNodes.firstOrNull { node ->
            if (targetFieldHint.isEmpty()) return@firstOrNull node.isFocused
            val hint = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) node.hintText?.toString().orEmpty() else ""
            val nText = node.text?.toString().orEmpty()
            val nDesc = node.contentDescription?.toString().orEmpty()
            hint.contains(targetFieldHint, ignoreCase = true) ||
                nText.contains(targetFieldHint, ignoreCase = true) ||
                nDesc.contains(targetFieldHint, ignoreCase = true)
        } ?: editableNodes.firstOrNull { it.isFocused } ?: editableNodes.firstOrNull()
            ?: return errorResponse("No editable text field found on screen.")

        targetNode.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
        val bundle = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        val setOk = targetNode.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, bundle)
        if (!setOk) {
            return errorResponse("Failed to set text on target field.")
        }

        if (submitAfter && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            targetNode.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
        }

        Thread.sleep(450)
        return okWithObservation("Entered text into ${targetFieldHint.ifEmpty { "input field" }}.")
    }

    private fun handleScrollScreen(direction: String, steps: Int): JSONObject {
        val root = rootInActiveWindow ?: return errorResponse("No active window root available.")
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes, 250)
        val scrollable = nodes.firstOrNull { it.isScrollable }

        for (i in 0 until steps) {
            if (stopRequested) return stoppedResponse()
            val action = if (direction == "up" || direction == "left") {
                AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
            } else {
                AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
            }
            val scrolled = scrollable?.performAction(action) == true
            if (!scrolled) {
                dispatchSwipeGesture(direction)
            }
            Thread.sleep(320)
        }
        return okWithObservation("Scrolled $direction ($steps steps).")
    }

    private fun dispatchTapGesture(x: Float, y: Float): Boolean {
        val path = Path().apply { moveTo(x, y) }
        val stroke = GestureDescription.StrokeDescription(path, 0, 60)
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        val latch = CountDownLatch(1)
        var completed = false
        dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                completed = true
                latch.countDown()
            }
            override fun onCancelled(gestureDescription: GestureDescription?) {
                latch.countDown()
            }
        }, null)
        latch.await(1500, TimeUnit.MILLISECONDS)
        return completed
    }

    private fun dispatchSwipeGesture(direction: String): Boolean {
        val dm = resources.displayMetrics
        val w = dm.widthPixels.toFloat()
        val h = dm.heightPixels.toFloat()
        val (startX, startY, endX, endY) = when (direction) {
            "up" -> arrayOf(w * 0.5f, h * 0.35f, w * 0.5f, h * 0.72f)
            "left" -> arrayOf(w * 0.25f, h * 0.5f, w * 0.8f, h * 0.5f)
            "right" -> arrayOf(w * 0.8f, h * 0.5f, w * 0.25f, h * 0.5f)
            else -> arrayOf(w * 0.5f, h * 0.72f, w * 0.5f, h * 0.35f)
        }
        val path = Path().apply {
            moveTo(startX, startY)
            lineTo(endX, endY)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, 260)
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        val latch = CountDownLatch(1)
        var completed = false
        dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                completed = true
                latch.countDown()
            }
            override fun onCancelled(gestureDescription: GestureDescription?) {
                latch.countDown()
            }
        }, null)
        latch.await(1500, TimeUnit.MILLISECONDS)
        return completed
    }

    private fun collectNodes(root: AccessibilityNodeInfo, out: MutableList<AccessibilityNodeInfo>, maxNodes: Int) {
        if (out.size >= maxNodes) return
        out.add(root)
        for (i in 0 until root.childCount) {
            val child = root.getChild(i) ?: continue
            collectNodes(child, out, maxNodes)
            if (out.size >= maxNodes) break
        }
    }

    private fun resolveAppLabel(pkgName: String): String {
        if (pkgName.isEmpty()) return ""
        return try {
            val appInfo = packageManager.getApplicationInfo(pkgName, 0)
            packageManager.getApplicationLabel(appInfo).toString()
        } catch (_: Exception) {
            pkgName
        }
    }

    private fun guessPackage(appName: String): String = when (appName.lowercase().trim()) {
        "instagram", "insta" -> "com.instagram.android"
        "youtube" -> "com.google.android.youtube"
        "chrome" -> "com.android.chrome"
        "whatsapp" -> "com.whatsapp"
        "spotify" -> "com.spotify.music"
        "maps", "google maps" -> "com.google.android.apps.maps"
        "settings" -> "com.android.settings"
        "telegram" -> "org.telegram.messenger"
        else -> ""
    }

    private fun okWithObservation(message: String): JSONObject {
        val obs = getScreenInformation()
        return JSONObject().apply {
            put("success", true)
            put("message", message)
            put("observation", obs)
        }
    }

    private fun stoppedResponse(): JSONObject = JSONObject().apply {
        put("success", false)
        put("error", "Automation stopped by user.")
    }

    private fun errorResponse(msg: String): JSONObject = JSONObject().apply {
        put("success", false)
        put("error", msg)
    }
}
