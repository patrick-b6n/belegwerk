/**
 * Small input helpers shared by the services (#14, #15).
 */

/** Ids are positive integers; anything else (e.g. `NaN` from a route param) cannot exist. */
export function isId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

// Whitespace plus invisible format characters (\p{Cf}: zero-width space/joiners,
// word joiner U+2060, soft hyphen U+00AD, BOM, Mongolian vowel separator, …).
const EDGE_BLANKS = /^[\s\p{Z}\p{Cf}]+|[\s\p{Z}\p{Cf}]+$/gu;
const VISIBLE = /[^\s\p{Z}\p{Cf}]/u;

/**
 * Trims whitespace and invisible format characters at the ends; inner ones
 * stay (e.g. ZWJ in emoji). A text without any visible character counts as
 * blank and gives `""`.
 */
export function trimText(value: string): string {
  if (!VISIBLE.test(value)) return "";
  return value.replaceAll(EDGE_BLANKS, "");
}
