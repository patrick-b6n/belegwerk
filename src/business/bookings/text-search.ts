/**
 * Case-insensitive text search of the booking search (#21), shared by the
 * Drizzle repository (SQL `GLOB` pattern) and the in-memory fake (RegExp),
 * so both match exactly the same bookings.
 *
 * Why not SQLite `LIKE` or `lower()`: both fold only ASCII letters – "müller"
 * would not find "MÜLLER" – and custom SQL functions cannot be registered
 * through `tauri-plugin-sql`. Instead every character of the search text
 * becomes the set of its case variants, computed here with JavaScript's
 * Unicode case mapping, and the database matches that set per character:
 * `"Mü"` → `[mM][üÜ]`. No schema change, no derived column to keep in sync.
 */

/** Pairs JavaScript's single-character case mapping misses (`"ß".toUpperCase()` is `"SS"`). */
const EXTRA_VARIANTS: Readonly<Record<string, string>> = { ß: "ẞ", ẞ: "ß" };

/**
 * The case variants of each character (code point) of `text`, the character
 * itself first: `"Mü%"` → `[["M", "m"], ["ü", "Ü"], ["%"]]`.
 *
 * Variants are the single-character results of `toLowerCase`/`toUpperCase`
 * (applied twice, so e.g. `ς` gets `Σ` and `σ`), locale-independent.
 * Mappings to several characters are dropped (`ß` does not match `SS`, `İ`
 * not `i̇`). Characters without case (digits, punctuation, `%`, `*`, …) are
 * their own only variant.
 */
export function textSearchCharClasses(text: string): string[][] {
  return Array.from(text, (char) => {
    const variants = new Set([char]);
    for (const first of [char.toLowerCase(), char.toUpperCase()]) {
      for (const variant of [first, first.toLowerCase(), first.toUpperCase()]) {
        if (isSingleCodePoint(variant)) variants.add(variant);
      }
    }
    const extra = EXTRA_VARIANTS[char];
    if (extra !== undefined) variants.add(extra);
    return [...variants];
  });
}

function isSingleCodePoint(value: string): boolean {
  return Array.from(value).length === 1;
}
