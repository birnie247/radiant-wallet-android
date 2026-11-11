package com.rxdexplorer.lumen;

import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Arrays;
import java.util.List;

/**
 * Open an external link in the system browser.
 *
 * Why this exists: the WebView is deliberately locked down — scripted popups and
 * multiple windows are disabled in MainActivity.hardenWebView() — so a
 * `window.open()` or `target="_blank"` from JS cannot be relied on to reach the
 * browser. This hands the URL to the OS instead, and never navigates the wallet
 * itself away from its own assets.
 *
 * Security: only `https` is accepted, and only for the block-explorer hosts we
 * ship. A wallet should not be a general-purpose intent launcher — a malicious
 * link in a transaction's metadata must not be able to fire arbitrary intents.
 */
@CapacitorPlugin(name = "OpenUrl")
public class OpenUrlPlugin extends Plugin {

    /** Hosts this app is willing to hand to the system browser. */
    private static final List<String> ALLOWED_HOSTS = Arrays.asList(
            "radiantexplorer.com",
            "www.radiantexplorer.com",
            "testnet.radiantexplorer.com",
            "explorer.radiantblockchain.org",
            "explorer1.rxd-radiant.com",
            "explorer2.rxd-radiant.com"
    );

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("url is required");
            return;
        }

        Uri uri;
        try {
            uri = Uri.parse(url.trim());
        } catch (Exception e) {
            call.reject("Unparseable url");
            return;
        }

        if (!"https".equalsIgnoreCase(uri.getScheme())) {
            call.reject("Only https links can be opened");
            return;
        }

        String host = uri.getHost();
        if (host == null || !ALLOWED_HOSTS.contains(host.toLowerCase())) {
            call.reject("Refusing to open an unrecognised host");
            return;
        }

        if (getActivity() == null) {
            call.reject("No foreground activity");
            return;
        }

        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            // Typically no browser installed.
            call.reject("Could not open a browser: " + e.getMessage());
        }
    }
}
