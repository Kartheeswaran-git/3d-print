import { Bangers, Fredoka, Manrope, Pacifico, Playfair_Display } from "next/font/google";
import type { KeychainFont } from "./settings";

/*
 * Keychain typefaces, self-hosted by next/font at build time (no runtime requests to Google, FIXES P5).
 * `preload: false` because only the selected face is needed; ensureFontLoaded() fetches it on demand.
 */
const manrope = Manrope({ weight: "800", display: "swap", preload: false, fallback: ["system-ui", "sans-serif"] });
const pacifico = Pacifico({ weight: "400", display: "swap", preload: false, fallback: ["cursive"] });
const bangers = Bangers({ weight: "400", display: "swap", preload: false, fallback: ["Impact", "sans-serif"] });
const playfair = Playfair_Display({ weight: "700", display: "swap", preload: false, fallback: ["Georgia", "serif"] });
const fredoka = Fredoka({ weight: "600", display: "swap", preload: false, fallback: ["system-ui", "sans-serif"] });

export interface KeychainFontFace {
  id: KeychainFont;
  /** Style label shown in the picker ("Clean", "Script"…). */
  label: string;
  /** Typeface name ("Manrope"…). */
  name: string;
  /** CSS font-family list from next/font (hashed family + metric-matched fallback). */
  family: string;
  weight: number;
  /** Applies the family and weight to an element. */
  className: string;
}

export const KEYCHAIN_FONT_FACES: Record<KeychainFont, KeychainFontFace> = {
  manrope: { id: "manrope", label: "Clean", name: "Manrope", family: manrope.style.fontFamily, weight: 800, className: manrope.className },
  pacifico: { id: "pacifico", label: "Script", name: "Pacifico", family: pacifico.style.fontFamily, weight: 400, className: pacifico.className },
  bangers: { id: "bangers", label: "Comic", name: "Bangers", family: bangers.style.fontFamily, weight: 400, className: bangers.className },
  playfair: { id: "playfair", label: "Elegant", name: "Playfair Display", family: playfair.style.fontFamily, weight: 700, className: playfair.className },
  fredoka: { id: "fredoka", label: "Rounded", name: "Fredoka", family: fredoka.style.fontFamily, weight: 600, className: fredoka.className },
};

/** CSS `font` shorthand for canvas / FontFaceSet calls, e.g. `800 120px '__Manrope_…', …`. */
export function fontCss(face: KeychainFontFace, sizePx: number): string {
  const size = Math.round(sizePx * 100) / 100;
  return `${face.weight} ${size}px ${face.family}`;
}

/** Characters whose glyphs cover the Latin subsets most names need. */
const SAMPLE_TEXT = "AaBbGgJjQqYy0123456789";
/** Give up waiting (and render with the fallback) if a font takes longer than this. */
const LOAD_TIMEOUT_MS = 5000;

/**
 * Load the selected face before rasterising (FIXES K2 — `document.fonts.ready` doesn't load
 * faces that nothing on the page uses yet). Pass the text being rendered so non-Latin subsets
 * are fetched too. Never rejects: on failure or timeout the canvas falls back to the next family.
 */
export async function ensureFontLoaded(font: KeychainFont, text?: string): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const face = KEYCHAIN_FONT_FACES[font];
  if (!face) return;
  const css = fontCss(face, 64);
  const sample = text && text.trim() ? `${SAMPLE_TEXT}${text}` : SAMPLE_TEXT;
  try {
    if (document.fonts.check(css, sample)) return;
  } catch {
    // Malformed font string in an old engine: attempt the load anyway.
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      document.fonts.load(css, sample),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, LOAD_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Network or decode failure — the fallback family keeps the keychain usable.
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
