import type { EuerCsvLabels } from "../euer/euer-csv";
import { EUER_POSITIONS } from "../euer/positions";

/** Labels for EÜR CSV tests (the app takes them from Paraglide). */
export const TEST_EUER_CSV_LABELS: EuerCsvLabels = {
  columns: {
    section: "Bereich",
    line: "Zeile",
    label: "Bezeichnung",
    amount: "Betrag",
    nonDeductible: "Nicht abziehbar",
  },
  sections: {
    income: "Betriebseinnahmen",
    informational: "Betriebseinnahmen (nachrichtlich)",
    expenses: "Betriebsausgaben",
    result: "Ergebnis",
  },
  totals: {
    income: "Summe Betriebseinnahmen",
    expenses: "Summe Betriebsausgaben",
    profit: "Gewinn",
    loss: "Verlust",
    zero: "Weder Gewinn noch Verlust",
  },
  positionNames: Object.fromEntries(
    EUER_POSITIONS.map((position) => [position, `Name ${position}`]),
  ) as EuerCsvLabels["positionNames"],
};
