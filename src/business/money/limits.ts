/**
 * Largest amount of a single booking in cents: 100.000.000,00 € (10^10
 * cents).
 *
 * Far above any realistic booking of a small business, and small enough that
 * sums stay exact JavaScript numbers: `Number.MAX_SAFE_INTEGER` (≈ 9 · 10^15)
 * holds the sum of about 900.000 bookings at this maximum – the totals of the
 * search (#21) and the EÜR (#25) can be added up as plain numbers. Shared by
 * `parseAmount` (`"tooLarge"`) and the booking service (`"amountTooLarge"`).
 */
export const MAX_AMOUNT_CENTS = 10_000_000_000;
