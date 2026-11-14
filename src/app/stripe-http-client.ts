import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

import type {
  StripeApplicationFee,
  StripeClient,
  StripeClientError,
  StripeFeeRefund,
} from "@/business/stripe";

/**
 * {@link StripeClient} of the app (#29): the Stripe REST API over
 * `tauri-plugin-http` – Rust performs the HTTPS request, the WebView talks to
 * it over the IPC, so the CSP needs no `connect-src` for Stripe.
 *
 * - Capability (`src-tauri/capabilities/default.json`): `http:default` with
 *   the scope `https://api.stripe.com/v1/application_fees` and
 *   `…/application_fees/*` only (query strings match: the plugin sets an
 *   omitted search to `*`); redirects are not followed (`maxRedirections: 0`).
 * - The key goes into the `Authorization: Bearer` header only – never into
 *   the URL – and into no result, error or log.
 * - API version pinned via `Stripe-Version` ({@link STRIPE_API_VERSION}).
 * - Every response is validated; anything unexpected is `invalidResponse`.
 * - 429: up to {@link MAX_ATTEMPTS} attempts, waiting `Retry-After` (capped)
 *   or an exponential backoff; then `rateLimited`.
 * - Transient failures – 500/502/503/504 and `network` (no response) – are
 *   retried the same way. `network` includes a refusal by the HTTP scope
 *   (the plugin rejects like for a connection error, distinguishable only by
 *   its message text); it is retried too – harmless, the scope covers every
 *   URL the client builds, and the request never leaves the app – (exponential backoff 1 s, 2 s; `Retry-After` if
 *   sent), then reported as `stripeError`/`network`. Not `timeout`: a
 *   request that took 30 s is not retried (the import would wait minutes).
 *   All requests are GETs, so retrying is safe.
 */

export const STRIPE_API_BASE = "https://api.stripe.com/v1";
/** The API version the response validation is written against. */
export const STRIPE_API_VERSION = "2026-10-28.endive";
/** Stripe's maximum page size. */
export const PAGE_LIMIT = 100;
export const MAX_ATTEMPTS = 3;
/** Total time of one request (connect, send, read body). */
export const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRY_WAIT_SECONDS = 10;
/** Server errors worth retrying (temporary per Stripe's docs). */
const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);

export interface StripeHttpClientOptions {
  /** Waits between retries; tests pass a fake. */
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly timeoutMs?: number;
}

type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: StripeClientError };

interface Page<T> {
  readonly data: readonly T[];
  readonly hasMore: boolean;
}

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function createStripeHttpClient(options: StripeHttpClientOptions = {}): StripeClient {
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  /** One GET with retries on 429, transient 5xx and network errors; returns the parsed JSON body. */
  async function getJson(
    apiKey: string,
    path: string,
    params: Record<string, string>,
  ): Promise<Outcome<unknown>> {
    const url = `${STRIPE_API_BASE}${path}?${new URLSearchParams(params).toString()}`;
    for (let attempt = 1; ; attempt++) {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      let status: number;
      let retryAfter: string | null;
      let body: string;
      try {
        const response = await tauriFetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Stripe-Version": STRIPE_API_VERSION,
            Accept: "application/json",
          },
          maxRedirections: 0,
          connectTimeout: timeoutMs,
          signal: controller.signal,
        });
        status = response.status;
        retryAfter = response.headers.get("Retry-After");
        body = await response.text();
      } catch {
        // The plugin's message may name the URL (no key in it) – still only
        // the code leaves this function.
        // A scope refusal lands here as well and is retried like a network
        // error (the message text is not a stable API to tell them apart).
        if (timedOut) return { ok: false, error: { code: "timeout" } };
        if (attempt >= MAX_ATTEMPTS) return { ok: false, error: { code: "network" } };
        await sleep(backoffSeconds(attempt, null) * 1000);
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (status === 429) {
        const retryAfterSeconds = parseRetryAfter(retryAfter);
        if (attempt >= MAX_ATTEMPTS) {
          return { ok: false, error: { code: "rateLimited", retryAfterSeconds } };
        }
        await sleep(backoffSeconds(attempt, retryAfterSeconds) * 1000);
        continue;
      }
      if (RETRYABLE_STATUS.has(status) && attempt < MAX_ATTEMPTS) {
        await sleep(backoffSeconds(attempt, parseRetryAfter(retryAfter)) * 1000);
        continue;
      }
      if (status === 401) return { ok: false, error: { code: "invalidApiKey" } };
      if (status === 403) return { ok: false, error: { code: "permissionDenied" } };
      if (status < 200 || status >= 300) {
        const details = parseStripeErrorBody(body);
        return { ok: false, error: { code: "stripeError", status, ...details } };
      }
      try {
        return { ok: true, value: JSON.parse(body) as unknown };
      } catch {
        return { ok: false, error: { code: "invalidResponse" } };
      }
    }
  }

  /** All items of a Stripe list endpoint, following `starting_after` while `has_more`. */
  async function listAll<T>(
    apiKey: string,
    path: string,
    params: Record<string, string>,
    parseItem: (value: unknown) => T | undefined,
    idOf: (item: T) => string,
    startingAfter?: string,
  ): Promise<Outcome<T[]>> {
    const items: T[] = [];
    let cursor = startingAfter;
    for (;;) {
      const response = await getJson(apiKey, path, {
        ...params,
        limit: String(PAGE_LIMIT),
        ...(cursor === undefined ? {} : { starting_after: cursor }),
      });
      if (!response.ok) return response;
      const page = parseList(response.value, parseItem);
      if (!page) return { ok: false, error: { code: "invalidResponse" } };
      items.push(...page.data);
      const last = page.data.at(-1);
      if (!page.hasMore) return { ok: true, value: items };
      // `has_more` without items would loop forever.
      if (last === undefined) return { ok: false, error: { code: "invalidResponse" } };
      cursor = idOf(last);
    }
  }

  async function completeRefunds(
    apiKey: string,
    fee: ParsedFee,
  ): Promise<Outcome<StripeApplicationFee>> {
    const embedded = fee.refunds;
    if (embedded && !embedded.hasMore) {
      return { ok: true, value: { ...fee.fee, refunds: embedded.data } };
    }
    // Embedded list truncated (more than Stripe embeds) or not embedded:
    // continue with the refunds endpoint after the last embedded refund.
    const known = embedded?.data ?? [];
    const rest = await listAll(
      apiKey,
      `/application_fees/${encodeURIComponent(fee.fee.id)}/refunds`,
      {},
      parseRefund,
      (refund) => refund.id,
      known.at(-1)?.id,
    );
    if (!rest.ok) return rest;
    return { ok: true, value: { ...fee.fee, refunds: [...known, ...rest.value] } };
  }

  return {
    listApplicationFees: async ({ apiKey, createdFrom, createdTo }) => {
      if (!Number.isSafeInteger(createdFrom) || !Number.isSafeInteger(createdTo)) {
        throw new RangeError("createdFrom/createdTo must be integer epoch seconds");
      }
      if (createdFrom > createdTo) {
        throw new RangeError("createdFrom must not be after createdTo");
      }
      const listed = await listAll(
        apiKey,
        "/application_fees",
        { "created[gte]": String(createdFrom), "created[lte]": String(createdTo) },
        parseFee,
        (fee) => fee.fee.id,
      );
      if (!listed.ok) return listed;
      const fees: StripeApplicationFee[] = [];
      for (const fee of listed.value) {
        const complete = await completeRefunds(apiKey, fee);
        if (!complete.ok) return complete;
        fees.push(complete.value);
      }
      return { ok: true, fees };
    },

    verifyAccess: async ({ apiKey }) => {
      const response = await getJson(apiKey, "/application_fees", { limit: "1" });
      if (!response.ok) return response;
      const page = parseList(response.value, parseFee);
      if (!page) return { ok: false, error: { code: "invalidResponse" } };
      return { ok: true, livemode: page.data[0]?.fee.livemode ?? null };
    },
  };
}

// --- Response validation ---------------------------------------------------

interface ParsedFee {
  readonly fee: Omit<StripeApplicationFee, "refunds">;
  /** The embedded `refunds` list; `undefined` if the response has none. */
  readonly refunds: Page<StripeFeeRefund> | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown, prefix: string): value is string {
  return typeof value === "string" && value.startsWith(prefix) && value.length > prefix.length;
}

function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isCurrency(value: unknown): value is string {
  return typeof value === "string" && /^[a-z]{3}$/.test(value);
}

function parseList<T>(
  value: unknown,
  parseItem: (item: unknown) => T | undefined,
): Page<T> | undefined {
  if (!isRecord(value) || value.object !== "list" || !Array.isArray(value.data)) return undefined;
  if (typeof value.has_more !== "boolean") return undefined;
  const data: T[] = [];
  for (const item of value.data) {
    const parsed = parseItem(item);
    if (parsed === undefined) return undefined;
    data.push(parsed);
  }
  return { data, hasMore: value.has_more };
}

function parseRefund(value: unknown): StripeFeeRefund | undefined {
  if (!isRecord(value) || value.object !== "fee_refund") return undefined;
  const { id, amount, currency, created } = value;
  if (!isId(id, "fr_") || !isAmount(amount) || !isCurrency(currency) || !isTimestamp(created)) {
    return undefined;
  }
  return { id, amount, currency, created };
}

function parseFee(value: unknown): ParsedFee | undefined {
  if (!isRecord(value) || value.object !== "application_fee") return undefined;
  const { id, amount, currency, created, livemode, refunds } = value;
  // `account` is an ID unless expanded (the client never expands it).
  const account = isRecord(value.account) ? value.account.id : value.account;
  if (
    !isId(id, "fee_") ||
    !isAmount(amount) ||
    !isCurrency(currency) ||
    !isTimestamp(created) ||
    !isId(account, "acct_") ||
    typeof livemode !== "boolean"
  ) {
    return undefined;
  }
  let embedded: Page<StripeFeeRefund> | undefined;
  if (refunds !== undefined && refunds !== null) {
    embedded = parseList(refunds, parseRefund);
    if (!embedded) return undefined;
  }
  return { fee: { id, amount, currency, created, account, livemode }, refunds: embedded };
}

/** Wait before the next attempt: `Retry-After` if sent, else 1 s, 2 s, … – capped. */
function backoffSeconds(attempt: number, retryAfterSeconds: number | null): number {
  return Math.min(retryAfterSeconds ?? 2 ** (attempt - 1), MAX_RETRY_WAIT_SECONDS);
}

/** `Retry-After` as seconds (delta-seconds form only); `null` if absent or unreadable. */
function parseRetryAfter(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

/** Stripe's `{ error: { code, message } }`, tolerant of any other body. */
function parseStripeErrorBody(body: string): {
  readonly stripeCode: string | null;
  readonly message: string | null;
} {
  try {
    const parsed: unknown = JSON.parse(body);
    if (isRecord(parsed) && isRecord(parsed.error)) {
      const { code, message } = parsed.error;
      return {
        stripeCode: typeof code === "string" ? code : null,
        message: typeof message === "string" ? message : null,
      };
    }
  } catch {
    // Not JSON (e.g. a proxy's HTML error page).
  }
  return { stripeCode: null, message: null };
}
