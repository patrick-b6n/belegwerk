/**
 * Stripe settings service (#28): stores the restricted API key and the
 * defaults of the Stripe import. Same conventions as the other services
 * (docs/architecture.md): one {@link UnitOfWork.run} per operation, result
 * objects with field-addressable codes, programmer errors throw.
 *
 * **The key never reaches the UI.** `get()` returns it masked; the import
 * (#30) reads it with {@link loadStripeImportSettings} inside its own unit
 * of work – a business-internal function, not part of `AppServices`.
 */
import type { Category, VatRate } from "../model";
import type { Repositories, UnitOfWork } from "../repositories";
import type { StripeClient, StripeClientError } from "./stripe-client";
import {
  maskStripeApiKey,
  parseStoredId,
  parseStoredVatRate,
  STRIPE_SETTING_KEYS,
  type StoredStripeDefaults,
  type StripeApiKeyErrorCode,
  type StripeApiKeyInfo,
  type StripeDefaultsFieldError,
  type StripeDefaultsInput,
  validateStripeApiKey,
  validateStripeDefaults,
} from "./stripe-settings";

/** What the settings page shows. */
export interface StripeSettings {
  /** The stored key, masked; `null` = no key stored. */
  readonly apiKey: StripeApiKeyInfo | null;
  /**
   * The stored defaults as saved – they may have become invalid since
   * (e.g. an archived category); check with `validateStripeDefaults`.
   */
  readonly defaults: StoredStripeDefaults;
}

export type SetStripeApiKeyResult =
  | { readonly ok: true; readonly apiKey: StripeApiKeyInfo }
  | {
      readonly ok: false;
      readonly reason: "invalid";
      readonly errors: readonly [
        { readonly field: "apiKey"; readonly code: StripeApiKeyErrorCode },
      ];
    };

export type SetStripeDefaultsResult =
  | { readonly ok: true; readonly defaults: StripeDefaultsInput }
  | {
      readonly ok: false;
      readonly reason: "invalid";
      /** All field errors (at most one per field), in the order VAT rate, fee, refund. */
      readonly errors: readonly StripeDefaultsFieldError[];
    };

export interface StripeSettingsService {
  get(): Promise<StripeSettings>;
  /** Validates and stores (replaces) the key; see `validateStripeApiKey`. */
  setApiKey(apiKey: string): Promise<SetStripeApiKeyResult>;
  /** Removes the key; `deleted: false` if none was stored. Defaults stay. */
  deleteApiKey(): Promise<{ readonly ok: true; readonly deleted: boolean }>;
  /** Validates and stores all three defaults together (nothing on error). */
  setDefaults(input: StripeDefaultsInput): Promise<SetStripeDefaultsResult>;
  /**
   * Checks the stored key against Stripe ("Verbindung testen"): one request
   * listing at most one application fee. Reads nothing else and writes
   * nothing.
   */
  testConnection(): Promise<TestStripeConnectionResult>;
}

export type TestStripeConnectionResult =
  /** Key valid with the needed permission; `livemode` of a listed fee, `null` without fees. */
  | { readonly ok: true; readonly livemode: boolean | null }
  /** No (valid) key stored. */
  | { readonly ok: false; readonly reason: "noApiKey" }
  /** Stripe refused or was not reachable; codes of the client. */
  | { readonly ok: false; readonly reason: "stripe"; readonly error: StripeClientError };

export interface StripeSettingsServiceDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly stripeClient: StripeClient;
}

export function createStripeSettingsService({
  unitOfWork,
  stripeClient,
}: StripeSettingsServiceDependencies): StripeSettingsService {
  return {
    get: () =>
      unitOfWork.run(async (repos) => {
        const apiKey = await repos.settings.get(STRIPE_SETTING_KEYS.apiKey);
        return {
          apiKey: apiKey === undefined ? null : maskStripeApiKey(apiKey),
          defaults: await readDefaults(repos),
        };
      }),

    setApiKey: async (input) => {
      const result = validateStripeApiKey(input);
      if (!result.ok) {
        return { ok: false, reason: "invalid", errors: [{ field: "apiKey", code: result.code }] };
      }
      try {
        await unitOfWork.run((repos) =>
          repos.settings.set(STRIPE_SETTING_KEYS.apiKey, result.apiKey),
        );
      } catch {
        // The database error (Drizzle) carries the bound parameters – the key.
        // Callers log errors, so rethrow without message details or cause.
        throw new Error("Saving the Stripe API key failed");
      }
      return { ok: true, apiKey: maskStripeApiKey(result.apiKey) };
    },

    deleteApiKey: () =>
      unitOfWork.run(async (repos) => ({
        ok: true,
        deleted: await repos.settings.delete(STRIPE_SETTING_KEYS.apiKey),
      })),

    setDefaults: (input) =>
      unitOfWork.run(async (repos): Promise<SetStripeDefaultsResult> => {
        const errors = validateStripeDefaults(input, await repos.categories.list());
        if (errors.length > 0) return { ok: false, reason: "invalid", errors };
        const { defaultVatRate, feeCategoryId, refundCategoryId } = input;
        await repos.settings.set(STRIPE_SETTING_KEYS.defaultVatRate, defaultVatRate);
        await repos.settings.set(STRIPE_SETTING_KEYS.feeCategoryId, String(feeCategoryId));
        await repos.settings.set(STRIPE_SETTING_KEYS.refundCategoryId, String(refundCategoryId));
        return { ok: true, defaults: { defaultVatRate, feeCategoryId, refundCategoryId } };
      }),

    testConnection: async () => {
      // Read in a unit of work, call Stripe outside of it: no transaction
      // stays open during the HTTP request.
      const stored = await unitOfWork.run((repos) =>
        repos.settings.get(STRIPE_SETTING_KEYS.apiKey),
      );
      const key = validateStripeApiKey(stored);
      if (!key.ok) return { ok: false, reason: "noApiKey" };
      const result = await stripeClient.verifyAccess({ apiKey: key.apiKey });
      return result.ok ? result : { ok: false, reason: "stripe", error: result.error };
    },
  };
}

async function readDefaults(repos: Repositories): Promise<StoredStripeDefaults> {
  return {
    defaultVatRate: parseStoredVatRate(
      await repos.settings.get(STRIPE_SETTING_KEYS.defaultVatRate),
    ),
    feeCategoryId: parseStoredId(await repos.settings.get(STRIPE_SETTING_KEYS.feeCategoryId)),
    refundCategoryId: parseStoredId(await repos.settings.get(STRIPE_SETTING_KEYS.refundCategoryId)),
  };
}

/** Everything the import needs, validated. */
export type StripeImportSettingsResult =
  | {
      readonly ok: true;
      /** The full key – for the Stripe client only; never log it or pass it to the UI. */
      readonly apiKey: string;
      /** For regularly taxed years; small business years book without a rate. */
      readonly defaultVatRate: VatRate;
      readonly feeCategory: Category;
      readonly refundCategory: Category;
    }
  /** No key stored (#31 links to the settings). */
  | { readonly ok: false; readonly reason: "noApiKey" }
  /** Defaults missing or no longer valid (e.g. archived category); codes as in `setDefaults`. */
  | {
      readonly ok: false;
      readonly reason: "invalidDefaults";
      readonly errors: readonly StripeDefaultsFieldError[];
    };

/**
 * Reads key and defaults for the Stripe import (#30) **within the caller's
 * unit of work** (pass its `repos`) and validates them again: stored
 * defaults can become invalid after saving (category archived, deleted or
 * edited). A stored key that is no valid restricted key (edited database)
 * counts as missing. Business-internal: the UI never gets the key.
 */
export async function loadStripeImportSettings(
  repos: Repositories,
): Promise<StripeImportSettingsResult> {
  const stored = await repos.settings.get(STRIPE_SETTING_KEYS.apiKey);
  const key = validateStripeApiKey(stored);
  if (!key.ok) return { ok: false, reason: "noApiKey" };
  const defaults = await readDefaults(repos);
  const categories = await repos.categories.list();
  const errors = validateStripeDefaults(defaults, categories);
  const feeCategory = categories.find((c) => c.id === defaults.feeCategoryId);
  const refundCategory = categories.find((c) => c.id === defaults.refundCategoryId);
  if (errors.length > 0 || !defaults.defaultVatRate || !feeCategory || !refundCategory) {
    return { ok: false, reason: "invalidDefaults", errors };
  }
  return {
    ok: true,
    apiKey: key.apiKey,
    defaultVatRate: defaults.defaultVatRate,
    feeCategory,
    refundCategory,
  };
}
