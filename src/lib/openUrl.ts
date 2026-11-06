/**
 * Hand an https link to the system browser.
 *
 * On the device this goes through the app-local `OpenUrl` plugin, because the
 * WebView deliberately blocks scripted popups and multiple windows — a
 * `window.open()` here would silently do nothing, which is exactly the kind of
 * bug that only shows up on a phone. In a desktop browser it falls back to
 * `window.open`, which works normally.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

interface OpenUrlApi {
  open(options: { url: string }): Promise<{ ok: boolean }>;
}

const OpenUrl = registerPlugin<OpenUrlApi>("OpenUrl");

export async function openExternalUrl(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await OpenUrl.open({ url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
