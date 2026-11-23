/**
 * Text suggestions of the booking form: earlier values of description and
 * counterparty, most relevant first. The ranking is pure (tested here and
 * through `BookingService.suggestTexts`); the repository only aggregates
 * (`BookingRepository.listTextUsage`).
 */
import type { BookingType } from "../model";
import type { BookingTextField, BookingTextUsage } from "../repositories";

export type { BookingTextField } from "../repositories";

export const BOOKING_TEXT_SUGGESTION_FIELDS: readonly BookingTextField[] = [
  "description",
  "counterparty",
];

/** Suggestions per request by default: enough for typing to filter, small to keep in memory. */
export const DEFAULT_BOOKING_TEXT_SUGGESTION_LIMIT = 300;

export const MAX_BOOKING_TEXT_SUGGESTION_LIMIT = 1000;

export interface BookingTextSuggestionRequest {
  readonly field: BookingTextField;
  /**
   * The booking type being entered: texts used with it come first, then
   * texts used only with the other type (e.g. a customer is rarely a
   * supplier). Without it, all texts rank together.
   */
  readonly type?: BookingType;
  /** Maximum number of suggestions, 1–{@link MAX_BOOKING_TEXT_SUGGESTION_LIMIT}. */
  readonly limit?: number;
}

interface Usage {
  count: number;
  lastDate: string;
}

interface Candidate {
  /** Spellings of the same text (differing in case only) with their usage over all types. */
  readonly spellings: Map<string, Usage>;
  readonly matching: Usage;
  readonly other: Usage;
}

/**
 * Ranks the usage groups into suggestions:
 *
 * - **One entry per text ignoring case** (`toLocaleLowerCase("de")`, NFC):
 *   "Müller GmbH" and "MÜLLER GMBH" are one suggestion, shown in the most
 *   used spelling (ties: the most recently used, then by code point). Their
 *   uses add up.
 * - **Order:** with `type`, texts used with that type first, then the rest;
 *   within each part by number of uses (of that part's type), then most
 *   recent date, then alphabetically (`localeCompare("de")`).
 * - At most `limit` suggestions.
 */
export function rankBookingTextSuggestions(
  usages: readonly BookingTextUsage[],
  {
    type,
    limit = DEFAULT_BOOKING_TEXT_SUGGESTION_LIMIT,
  }: Omit<BookingTextSuggestionRequest, "field">,
): string[] {
  const candidates = new Map<string, Candidate>();
  for (const usage of usages) {
    const text = usage.text.normalize("NFC");
    if (text.trim() === "") continue;
    const key = text.toLocaleLowerCase("de");
    let candidate = candidates.get(key);
    if (!candidate) {
      candidate = {
        spellings: new Map(),
        matching: { count: 0, lastDate: "" },
        other: { count: 0, lastDate: "" },
      };
      candidates.set(key, candidate);
    }
    addUsage(candidate.spellings, text, usage);
    merge(type === undefined || usage.type === type ? candidate.matching : candidate.other, usage);
  }

  const ranked = [...candidates.values()].map((candidate) => {
    const tier = candidate.matching.count > 0 ? 0 : 1;
    return {
      text: preferredSpelling(candidate.spellings),
      tier,
      usage: tier === 0 ? candidate.matching : candidate.other,
    };
  });
  ranked.sort(
    (a, b) =>
      a.tier - b.tier ||
      b.usage.count - a.usage.count ||
      compareText(b.usage.lastDate, a.usage.lastDate) ||
      a.text.localeCompare(b.text, "de") ||
      compareText(a.text, b.text),
  );
  return ranked.slice(0, limit).map((entry) => entry.text);
}

function addUsage(spellings: Map<string, Usage>, text: string, usage: BookingTextUsage) {
  const existing = spellings.get(text);
  if (existing) merge(existing, usage);
  else spellings.set(text, { count: usage.count, lastDate: usage.lastDate });
}

function merge(target: Usage, usage: BookingTextUsage) {
  target.count += usage.count;
  if (usage.lastDate > target.lastDate) target.lastDate = usage.lastDate;
}

function preferredSpelling(spellings: Map<string, Usage>): string {
  let best: [string, Usage] | undefined;
  for (const entry of spellings) {
    if (
      !best ||
      entry[1].count > best[1].count ||
      (entry[1].count === best[1].count &&
        (entry[1].lastDate > best[1].lastDate ||
          (entry[1].lastDate === best[1].lastDate && compareText(entry[0], best[0]) < 0)))
    ) {
      best = entry;
    }
  }
  // A candidate is created with its first spelling.
  return best![0];
}

/** Plain code unit order – deterministic, independent of the locale. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
