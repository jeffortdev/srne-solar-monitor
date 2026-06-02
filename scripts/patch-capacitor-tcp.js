/**
 * Patches capacitor-tcp-connect@1.0.23 after npm install.
 *
 * The stock plugin has two bugs:
 *   1. Never reads the TCP response – returns { success: true } with no `value`.
 *   2. Uses text.getBytes() (UTF-8) which corrupts binary bytes > 0x7F.
 *      Modbus / SolarmanV5 frames routinely contain bytes in 0x80-0xFF range.
 *
 * This script replaces the two affected files with the fixed versions.
 */

const fs = require('fs');
const path = require('path');

const PLUGIN_DIR = path.join(
  __dirname,
  '..',
  'node_modules',
  'capacitor-tcp-connect',
  'android',
);

// ── 1. build.gradle — add namespace (required by AGP 8+) ─────────────────────

const buildGradle = path.join(PLUGIN_DIR, 'build.gradle');
let gradle = fs.readFileSync(buildGradle, 'utf8');

if (!gradle.includes("namespace 'com.mycompany.plugins.example'")) {
  gradle = gradle.replace(
    "apply plugin: 'com.android.library'\n\nandroid {",
    "apply plugin: 'com.android.library'\n\nandroid {\n    namespace 'com.mycompany.plugins.example'",
  );
  fs.writeFileSync(buildGradle, gradle, 'utf8');
  console.log('[patch-capacitor-tcp] Patched build.gradle (added namespace)');
} else {
  console.log('[patch-capacitor-tcp] build.gradle already patched – skipping');
}

// ── 2. SocketConnectPlugin.java — read response + fix encoding ───────────────

const javaFile = path.join(
  PLUGIN_DIR,
  'src/main/java/com/mycompany/plugins/example/SocketConnectPlugin.java',
);

const fixedJava = `package com.mycompany.plugins.example;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.Charset;

@CapacitorPlugin(name = "SocketConnect")
public class SocketConnectPlugin extends Plugin {

    // Latin-1 (ISO-8859-1) maps Unicode U+0000-U+00FF directly to bytes 0x00-0xFF.
    // This is essential for binary Modbus/SolarmanV5 frames which contain bytes > 0x7F.
    private static final Charset LATIN1 = Charset.forName("ISO-8859-1");

    @PluginMethod()
    public void open(PluginCall call) {
        String ip = call.getString("ip");
        String port = call.getString("port");
        String text = call.getString("text");

        try {
            Socket socket = new Socket(ip, Integer.parseInt(port));

            // Write request - use Latin-1 so every byte value 0x00-0xFF is preserved exactly.
            OutputStream out = socket.getOutputStream();
            out.write(text.getBytes(LATIN1));
            out.flush();

            // Read response: wait up to 3 s for the first byte, then 500 ms for subsequent chunks.
            socket.setSoTimeout(3000);
            InputStream in = socket.getInputStream();
            ByteArrayOutputStream responseBytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];

            try {
                int n = in.read(buffer);
                if (n > 0) {
                    responseBytes.write(buffer, 0, n);
                    socket.setSoTimeout(500); // shorter timeout once data has started arriving
                    try {
                        while ((n = in.read(buffer)) > 0) {
                            responseBytes.write(buffer, 0, n);
                        }
                    } catch (java.net.SocketTimeoutException ignored) {
                        // No more data within 500 ms - treat as end of response.
                    }
                }
            } catch (java.net.SocketTimeoutException ignored) {
                // No data arrived within 3 s - responseBytes stays empty.
            }

            socket.close();

            JSObject ret = new JSObject();
            // Return response bytes as a Latin-1 string so the JS layer can read char codes
            // back as raw byte values via charCodeAt().
            ret.put("value", responseBytes.toString("ISO-8859-1"));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }
}
`;

const existing = fs.readFileSync(javaFile, 'utf8');
if (existing.includes('ByteArrayOutputStream')) {
  console.log('[patch-capacitor-tcp] SocketConnectPlugin.java already patched – skipping');
} else {
  fs.writeFileSync(javaFile, fixedJava, 'utf8');
  console.log('[patch-capacitor-tcp] Patched SocketConnectPlugin.java (read response + Latin-1 encoding)');
}
