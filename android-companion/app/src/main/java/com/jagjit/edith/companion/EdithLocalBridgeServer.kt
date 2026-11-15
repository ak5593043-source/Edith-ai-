package com.jagjit.edith.companion

import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.Executors

/**
 * Localhost-only (127.0.0.1) HTTP/JSON bridge server allowing EDITH PWA/Web App on the same
 * Android device to probe Accessibility permissions, inspect active UI trees, and execute
 * allowlisted Accessibility actions.
 */
class EdithLocalBridgeServer(
    private val context: Context,
    private val port: Int = 8765,
    private val pairingToken: String
) {
    @Volatile
    private var running = false
    private var serverSocket: ServerSocket? = null
    private val pool = Executors.newCachedThreadPool()

    fun isRunning(): Boolean = running

    fun start() {
        if (running) return
        running = true
        Thread {
            try {
                val socket = ServerSocket(port, 16, InetAddress.getByName("127.0.0.1"))
                serverSocket = socket
                while (running) {
                    val client = socket.accept()
                    pool.execute { handleClient(client) }
                }
            } catch (_: Exception) {
                running = false
            }
        }.start()
    }

    fun stop() {
        running = false
        try {
            serverSocket?.close()
        } catch (_: Exception) {
        }
        serverSocket = null
    }

    private fun handleClient(client: Socket) {
        client.use { sock ->
            try {
                val reader = BufferedReader(InputStreamReader(sock.getInputStream()))
                val requestLine = reader.readLine() ?: return
                val parts = requestLine.split(" ")
                val method = parts.getOrNull(0)?.uppercase() ?: "GET"
                val path = parts.getOrNull(1)?.substringBefore("?") ?: "/"

                val headers = HashMap<String, String>()
                var contentLength = 0
                while (true) {
                    val line = reader.readLine() ?: break
                    if (line.isEmpty()) break
                    val colon = line.indexOf(':')
                    if (colon > 0) {
                        val key = line.substring(0, colon).trim().lowercase()
                        val value = line.substring(colon + 1).trim()
                        headers[key] = value
                        if (key == "content-length") {
                            contentLength = value.toIntOrNull() ?: 0
                        }
                    }
                }

                if (method == "OPTIONS") {
                    writeJsonResponse(sock, 204, "")
                    return
                }

                if (pairingToken.isNotEmpty() && headers["x-edith-token"] != pairingToken) {
                    val err = JSONObject().put("error", "Unauthorized pairing token").toString()
                    writeJsonResponse(sock, 401, err)
                    return
                }

                var bodyStr = ""
                if (contentLength > 0 && contentLength < 1024 * 256) {
                    val buf = CharArray(contentLength)
                    var readTotal = 0
                    while (readTotal < contentLength) {
                        val n = reader.read(buf, readTotal, contentLength - readTotal)
                        if (n <= 0) break
                        readTotal += n
                    }
                    bodyStr = String(buf, 0, readTotal)
                }

                when {
                    method == "GET" && path == "/health" -> {
                        val payload = JSONObject().apply {
                            put("status", "ok")
                            put("accessibilityServiceEnabled", EdithAccessibilityService.instance != null)
                            put("overlayPermissionGranted", Settings.canDrawOverlays(context))
                            put("deviceModel", "${Build.MANUFACTURER} ${Build.MODEL}")
                            put("androidSdk", Build.VERSION.SDK_INT)
                        }.toString()
                        writeJsonResponse(sock, 200, payload)
                    }

                    method == "GET" && path == "/screen" -> {
                        val svc = EdithAccessibilityService.instance
                        if (svc == null) {
                            writeJsonResponse(
                                sock,
                                503,
                                JSONObject().put("error", "Accessibility service is not enabled").toString()
                            )
                        } else {
                            writeJsonResponse(sock, 200, svc.getScreenInformation().toString())
                        }
                    }

                    method == "POST" && path == "/execute" -> {
                        val svc = EdithAccessibilityService.instance
                        if (svc == null) {
                            writeJsonResponse(
                                sock,
                                503,
                                JSONObject().put("error", "Enable ULTRON Accessibility Service first").toString()
                            )
                            return
                        }
                        val reqJson = JSONObject(bodyStr.ifEmpty { "{}" })
                        val tool = reqJson.optString("tool", "")
                        val args = reqJson.optJSONObject("arguments") ?: JSONObject()
                        val result = svc.executeAllowlistedTool(tool, args)
                        val code = if (result.optBoolean("success")) 200 else 400
                        writeJsonResponse(sock, code, result.toString())
                    }

                    method == "POST" && path == "/stop" -> {
                        EdithAccessibilityService.requestStop()
                        writeJsonResponse(sock, 200, JSONObject().put("stopped", true).toString())
                    }

                    method == "POST" && path == "/request-accessibility" -> {
                        val accIntent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        context.startActivity(accIntent)
                        writeJsonResponse(
                            sock,
                            200,
                            JSONObject().put("openedSettings", true).toString()
                        )
                    }

                    else -> {
                        writeJsonResponse(sock, 404, JSONObject().put("error", "Not found").toString())
                    }
                }
            } catch (e: Exception) {
                writeJsonResponse(
                    sock,
                    500,
                    JSONObject().put("error", e.message ?: "Bridge internal error").toString()
                )
            }
        }
    }

    private fun writeJsonResponse(sock: Socket, statusCode: Int, body: String) {
        val statusText = when (statusCode) {
            200 -> "OK"
            204 -> "No Content"
            400 -> "Bad Request"
            401 -> "Unauthorized"
            404 -> "Not Found"
            503 -> "Service Unavailable"
            else -> "Internal Server Error"
        }
        val bytes = body.toByteArray(Charsets.UTF_8)
        val writer = OutputStreamWriter(sock.getOutputStream(), Charsets.UTF_8)
        writer.write("HTTP/1.1 $statusCode $statusText\r\n")
        writer.write("Content-Type: application/json; charset=utf-8\r\n")
        writer.write("Access-Control-Allow-Origin: *\r\n")
        writer.write("Access-Control-Allow-Headers: Content-Type, X-EDITH-Token\r\n")
        writer.write("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n")
        writer.write("Content-Length: ${bytes.size}\r\n")
        writer.write("Connection: close\r\n\r\n")
        if (bytes.isNotEmpty()) {
            writer.write(body)
        }
        writer.flush()
    }
}
