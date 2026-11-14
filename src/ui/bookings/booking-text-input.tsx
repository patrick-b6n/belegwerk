import { useMemo, useState } from "react";

import type { BookingTextField } from "@/business/bookings";
import type { BookingType } from "@/business/model";
import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
} from "@/ui/components/ui/autocomplete";
import type { ControlProps } from "@/ui/forms/form-field";

import { filterTextSuggestions } from "./booking-form-model";
import { useBookingTextSuggestions } from "./booking-queries";

/**
 * Text input of description or counterparty with suggestions from earlier
 * bookings (Base UI Autocomplete): any text can be typed, the suggestions
 * only help. They are filtered while typing (`filterTextSuggestions`);
 * arrow keys move through them, Enter takes the highlighted one, Escape
 * closes the list, Tab leaves the field as usual. Without a highlighted
 * suggestion, Enter submits the form. The list only opens when something
 * matches; suggestions appear once loaded, the field never waits for them.
 */
export function BookingTextInput({
  field,
  type,
  control,
  value,
  maxLength,
  listLabel,
  onValueChange,
  onBlur,
}: Readonly<{
  field: BookingTextField;
  /** Booking type in the form: its texts are suggested first. */
  type: BookingType;
  control: ControlProps;
  value: string;
  maxLength: number;
  /** Accessible name of the suggestion list. */
  listLabel: string;
  onValueChange: (value: string) => void;
  onBlur: () => void;
}>) {
  const suggestions = useBookingTextSuggestions(field, type);
  const items = useMemo(
    () => filterTextSuggestions(suggestions.data ?? [], value),
    [suggestions.data, value],
  );
  const [open, setOpen] = useState(false);

  return (
    <Autocomplete
      items={items}
      // Filtered above (umlauts, word starts first); the component shows them as given.
      filter={null}
      value={value}
      onValueChange={(next) => onValueChange(next)}
      open={open && items.length > 0}
      onOpenChange={setOpen}
    >
      <AutocompleteInput
        {...control}
        required
        autoComplete="off"
        maxLength={maxLength}
        onBlur={onBlur}
      />
      <AutocompleteContent>
        <AutocompleteList aria-label={listLabel}>
          {(item: string) => (
            <AutocompleteItem key={item} value={item}>
              {item}
            </AutocompleteItem>
          )}
        </AutocompleteList>
      </AutocompleteContent>
    </Autocomplete>
  );
}
