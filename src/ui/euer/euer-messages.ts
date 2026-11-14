import { EUER_POSITIONS, type EuerCsvLabels } from "@/business/euer";
import { m } from "@/paraglide/messages.js";

import { euerPositionName } from "./position-name";

/** Texts of the EÜR CSV export (#27); same wording as the view. */
export function euerCsvLabels(): EuerCsvLabels {
  return {
    columns: {
      section: m.euer_csv_column_section(),
      line: m.euer_column_line(),
      label: m.euer_column_label(),
      amount: m.euer_column_amount(),
      nonDeductible: m.euer_csv_column_non_deductible(),
    },
    sections: {
      income: m.euer_income_title(),
      informational: m.euer_csv_section_informational(),
      expenses: m.euer_expenses_title(),
      result: m.euer_result_title(),
    },
    totals: {
      income: m.euer_income_total(),
      expenses: m.euer_expenses_total(),
      profit: m.euer_result_profit(),
      loss: m.euer_result_loss(),
      zero: m.euer_result_zero(),
    },
    positionNames: Object.fromEntries(
      EUER_POSITIONS.map((position) => [position, euerPositionName(position)]),
    ) as EuerCsvLabels["positionNames"],
  };
}
