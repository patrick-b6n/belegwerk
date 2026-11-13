/**
 * Small input helpers shared by the services (#14, #15).
 */

/** Ids are positive integers; anything else (e.g. `NaN` from a route param) cannot exist. */
export function isId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

// Zero-width space, non-joiner, joiner and BOM (`String#trim` only removes the BOM).
const EDGE_BLANKS = /^[\s​-‍﻿]+|[\s​-‍﻿]+$/g;

/** Trims whitespace and zero-width characters at the ends; inner ones stay (e.g. ZWJ in emoji). */
export function trimText(value: string): string {
  return value.replaceAll(EDGE_BLANKS, "");
}
