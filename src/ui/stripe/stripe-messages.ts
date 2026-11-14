/**
 * UI texts of the "Stripe" settings (#28): key mode and the texts of the
 * service's error codes (docs/i18n.md: business returns codes, the UI
 * translates them).
 */
import type {
  StripeApiKeyErrorCode,
  StripeDefaultsFieldError,
  StripeKeyMode,
} from "@/business/stripe";
import { m } from "@/paraglide/messages.js";

/** "Live" or "Test". */
export function keyModeLabel(mode: StripeKeyMode): string {
  return mode === "live" ? m.stripe_key_mode_live() : m.stripe_key_mode_test();
}

/** Message of a refused key. */
export function apiKeyErrorMessage(code: StripeApiKeyErrorCode): string {
  switch (code) {
    case "required":
      return m.stripe_key_error_required();
    case "secretKeyNotAllowed":
      return m.stripe_key_error_secret_key();
    case "publishableKeyNotAllowed":
      return m.stripe_key_error_publishable_key();
    case "invalidKey":
      return m.stripe_key_error_invalid();
  }
  // Unreachable with the typed codes; a new code without a text is a programmer error.
  throw new Error(`No message for Stripe key error ${String(code)}`);
}

/** Message of an error of the defaults (form field or stored value). */
export function defaultsErrorMessage(error: StripeDefaultsFieldError): string {
  switch (error.field) {
    case "defaultVatRate":
      return error.code === "required"
        ? m.stripe_defaults_error_vat_rate_required()
        : m.stripe_defaults_error_vat_rate_invalid();
    case "feeCategoryId":
    case "refundCategoryId":
      switch (error.code) {
        case "required":
          return m.stripe_defaults_error_category_required();
        case "categoryNotFound":
          return m.stripe_defaults_error_category_not_found();
        case "categoryArchived":
          return m.stripe_defaults_error_category_archived();
        case "categoryTypeMismatch":
          return error.field === "feeCategoryId"
            ? m.stripe_defaults_error_fee_category_type()
            : m.stripe_defaults_error_refund_category_type();
        case "categoryNotRevenueReduction":
          return m.stripe_defaults_error_refund_not_reduction();
        case "categoryTaxOffice":
          return m.stripe_defaults_error_fee_category_tax_office();
      }
  }
  throw new Error(`No message for Stripe defaults error ${JSON.stringify(error)}`);
}

/** Label of a defaults field, to name it in the hint about stored problems. */
export function defaultsFieldLabel(field: StripeDefaultsFieldError["field"]): string {
  switch (field) {
    case "defaultVatRate":
      return m.stripe_defaults_vat_rate_label();
    case "feeCategoryId":
      return m.stripe_defaults_fee_category_label();
    case "refundCategoryId":
      return m.stripe_defaults_refund_category_label();
  }
}
