/** A named base + text filament pairing offered as a one-click preset. Colours are product data (preview only). */
export interface ColourPreset {
  id: string;
  label: string;
  base: string;
  text: string;
}

export const COLOUR_PRESETS: readonly ColourPreset[] = [
  { id: "charcoal-orange", label: "Charcoal & orange", base: "#333333", text: "#ff7b00" },
  { id: "white-cobalt", label: "White & cobalt", base: "#f5f5f5", text: "#3f49c9" },
  { id: "black-gold", label: "Black & gold", base: "#1a1a1a", text: "#d4a017" },
  { id: "navy-white", label: "Navy & white", base: "#1f2a44", text: "#ffffff" },
  { id: "mint-charcoal", label: "Mint & charcoal", base: "#a8e6cf", text: "#2d3436" },
];

/** The preset matching both colours (case-insensitive), if any. */
export function findColourPreset(base: string, text: string): ColourPreset | null {
  const b = base.toLowerCase();
  const t = text.toLowerCase();
  return COLOUR_PRESETS.find((p) => p.base === b && p.text === t) ?? null;
}
