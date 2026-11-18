/** Wix Madefor from Google Fonts (Display for headlines/numbers, Text for UI). */
const WIX_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Wix+Madefor+Display:wght@500..800&family=Wix+Madefor+Text:wght@400..700&display=swap";
const WIX_FONTS_LINK_ID = "wx-fonts";

/** Adds the font stylesheet once (system-ui is the fallback until it loads). */
export function loadWixFonts() {
  if (typeof document === "undefined" || document.getElementById(WIX_FONTS_LINK_ID)) return;
  for (const origin of ["https://fonts.googleapis.com", "https://fonts.gstatic.com"]) {
    const pre = document.createElement("link");
    pre.rel = "preconnect";
    pre.href = origin;
    if (origin.includes("gstatic")) pre.crossOrigin = "anonymous";
    document.head.appendChild(pre);
  }
  const link = document.createElement("link");
  link.id = WIX_FONTS_LINK_ID;
  link.rel = "stylesheet";
  link.href = WIX_FONTS_HREF;
  document.head.appendChild(link);
}
