/**
 * Clipboard writes for the WebView.
 *
 * `navigator.clipboard` needs a secure context. Capacitor serves the app from
 * `https://localhost`, so it is normally there, but an older WebView or a denied
 * permission still throws — hence the textarea fallback. The boolean return
 * matters: callers must not say "Copied" when nothing reached the clipboard.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
