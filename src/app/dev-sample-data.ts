import type { BookingFormInput } from "@/business/bookings";
import type { BookingType, VatRate } from "@/business/model";

import type { AppServices } from "./services";

/**
 * Sample data for development builds only (`pnpm tauri dev`, which uses its
 * own `belegwerk-dev.db`, see src-tauri/src/lib.rs). `startApp` loads this
 * module lazily behind `import.meta.env.DEV`, so it is not part of release
 * builds.
 *
 * Fills an empty database (no bookings) with about 14 months of plausible
 * bookings up to `today` – monthly costs, client invoices, Stripe fees,
 * quarterly VAT prepayments and some one-off expenses – enough for paging
 * (more than 100 rows), filters, sorting and the EÜR. Everything goes
 * through the regular services, so the data always passes the current
 * validation. Deterministic: the same `today` gives the same bookings.
 *
 * A database that has bookings is left alone; to start over, delete
 * `belegwerk-dev.db` and restart the app.
 */
export async function seedSampleData(
  services: AppServices,
  today: Date = new Date(),
): Promise<SeedResult> {
  const existing = await services.bookings.list({ pageSize: 1 });
  if (!existing.ok || existing.total > 0) return { seeded: false, created: 0 };

  const categories = await services.categories.list();
  const categoryId = (name: string, type: BookingType) => {
    const match =
      categories.find((category) => category.name === name && !category.archived) ??
      categories.find((category) => category.type === type && !category.archived);
    if (!match) throw new Error(`No category for sample data: ${name}`);
    return match.id;
  };

  const end = isoDate(today);
  const first = new Date(Date.UTC(today.getFullYear() - 1, today.getMonth() - 1, 1));
  for (let year = first.getUTCFullYear(); year <= today.getFullYear(); year++) {
    await services.taxYears.addYear(year);
  }

  const random = seededRandom(20_251_115);
  const inputs: BookingFormInput[] = [];
  const add = (
    date: string,
    type: BookingType,
    grossCents: number,
    vatRate: VatRate,
    category: string,
    description: string,
    counterparty: string,
    extra: Partial<BookingFormInput> = {},
  ) => {
    if (date > end) return;
    inputs.push({
      date,
      type,
      grossCents,
      vatRate,
      categoryId: categoryId(category, type),
      description,
      counterparty,
      reference: null,
      note: null,
      ...extra,
    });
  };

  let invoice = 1;
  let stripeFee = 1;
  for (
    let month = new Date(first);
    isoDate(month) <= end;
    month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1))
  ) {
    const y = month.getUTCFullYear();
    const m = month.getUTCMonth() + 1;
    const day = (d: number) => isoDate(new Date(Date.UTC(y, m - 1, d)));
    const label = month.toLocaleDateString("de-DE", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });

    // Monthly costs.
    add(
      day(1),
      "expense",
      25_000,
      "19",
      "Miete Geschäftsräume",
      `Coworking ${label}`,
      "Hafenbüro Kiel GmbH",
    );
    add(
      day(3),
      "expense",
      1_190,
      "19",
      "EDV-Kosten / Software",
      "Cloud-Server",
      "Hetzner Online GmbH",
      {
        reference: `R${y}${String(m).padStart(2, "0")}-${4100 + m}`,
      },
    );
    add(
      day(5),
      "expense",
      3_998,
      "19",
      "Telefon / Internet",
      "Telefon & Internet",
      "Telekom Deutschland GmbH",
    );
    add(
      day(12),
      "expense",
      2_142,
      "19",
      "EDV-Kosten / Software",
      "Claude Pro",
      "Anthropic Ireland, Limited",
    );
    add(
      day(18),
      "expense",
      1_189,
      "19",
      "EDV-Kosten / Software",
      "Buchhaltungs-Abo",
      "Lexware GmbH",
    );

    // Client invoices: one or two per month.
    const clients = [
      ["Müller & Partner GbR", "Website-Relaunch"],
      ["Stadtwerke Kiel AG", "Workshop UX-Grundlagen"],
      ["Nordlicht Reisen GmbH", "Wartung und Support"],
      ["Kaffeerösterei Hansen", "Shop-Erweiterung"],
    ] as const;
    const invoices = 1 + Math.floor(random() * 2);
    for (let i = 0; i < invoices; i++) {
      const [client, topic] = clients[Math.floor(random() * clients.length)] ?? clients[0];
      const gross = Math.round((800 + random() * 3_200) / 10) * 1_190; // multiple of 11,90 €
      add(day(8 + i * 12), "income", gross, "19", "Umsatzerlöse", `${topic} (${label})`, client, {
        reference: `RE-${y}-${String(invoice++).padStart(3, "0")}`,
      });
    }

    // Stripe application fees: several small income bookings.
    for (const d of [4, 11, 19, 26]) {
      const gross = random() < 0.6 ? 40 : 320;
      add(
        day(d),
        "income",
        gross,
        "0",
        "Steuerfreie / nicht steuerbare Erlöse",
        "Stripe Application Fee",
        "acct_1SONSb2NA9qguX7T",
        {
          source: "stripe",
          externalId: `fee_sample_${String(stripeFee++).padStart(4, "0")}`,
        },
      );
    }

    // Quarterly VAT prepayment (tax office: no VAT).
    if (m % 3 === 1) {
      add(
        day(10),
        "expense",
        18_000 + Math.round(random() * 40_000),
        "0",
        "USt-Vorauszahlung",
        `USt-Vorauszahlung ${quarterBefore(y, m)}`,
        "Finanzamt Kiel",
      );
    }
  }

  // One-off expenses spread over the period.
  const oneOffs: [number, number, VatRate, string, string, string][] = [
    [
      20,
      4_000,
      "7",
      "Bürobedarf / Porto / Fachliteratur",
      "Fachbuch Softwarearchitektur",
      "Buchhandlung am Markt",
    ],
    [45, 9_800, "19", "Fahrtkosten", "Bahnfahrt Berlin – Hamburg", "Deutsche Bahn AG"],
    [
      46,
      12_900,
      "7",
      "Übernachtung / Reisenebenkosten",
      "Hotel Hamburg, 1 Nacht",
      "Motel One Hamburg",
    ],
    [80, 8_640, "19", "Bewirtung", "Geschäftsessen Projektstart", "Restaurant Seeblick"],
    [
      120,
      79_900,
      "19",
      "Geringwertige Wirtschaftsgüter (GWG)",
      "Monitor 27 Zoll",
      "Cyberport GmbH",
    ],
    [
      150,
      59_500,
      "19",
      "Rechts- und Steuerberatung, Buchführung",
      "Jahresabschluss",
      "Steuerkanzlei Petersen",
    ],
    [200, 2_791, "19", "Bürobedarf / Porto / Fachliteratur", "Büromaterial", "Büro Schmidt"],
    [240, 38_275, "0", "Beiträge / Versicherungen", "Berufshaftpflicht", "Hanse Versicherung AG"],
    [300, 29_000, "19", "Fortbildung", "Konferenzticket", "Web Summit Nord e. V."],
    [330, 15_470, "19", "Werbung", "Visitenkarten und Flyer", "Druckerei Nord"],
    [360, 4_950, "19", "Sonstige Betriebsausgaben", "Domain-Verlängerung", "INWX GmbH"],
  ];
  for (const [offset, gross, vat, category, description, counterparty] of oneOffs) {
    const date = isoDate(new Date(first.getTime() + offset * 86_400_000));
    add(date, "expense", gross, vat, category, description, counterparty);
  }

  // A refund to a customer (reduces income).
  add(
    isoDate(new Date(first.getTime() + 210 * 86_400_000)),
    "expense",
    11_900,
    "19",
    "Erlösminderung / Rückerstattung",
    "Gutschrift Wartungsvertrag",
    "Nordlicht Reisen GmbH",
  );

  let created = 0;
  for (const input of inputs) {
    const result = await services.bookings.create(input);
    if (result.ok) created++;
    else console.warn("Sample booking rejected", input, result);
  }
  return { seeded: true, created };
}

export interface SeedResult {
  /** `false`: the database already had bookings and was left alone. */
  readonly seeded: boolean;
  readonly created: number;
}

function isoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** "Q4 2025" for a prepayment paid in January 2026. */
function quarterBefore(year: number, month: number): string {
  const quarter = Math.floor((month - 1) / 3);
  return quarter === 0 ? `Q4 ${year - 1}` : `Q${quarter} ${year}`;
}

/** Small deterministic generator (mulberry32), so the sample data is stable. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
