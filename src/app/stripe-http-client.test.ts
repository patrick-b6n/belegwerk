import { beforeEach, describe, expect, it, vi } from "vitest";

type FetchInit = RequestInit & { maxRedirections?: number; connectTimeout?: number };

const plugin = vi.hoisted(() => ({
  fetch: vi.fn<(input: string, init?: FetchInit) => Promise<Response>>(),
}));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: plugin.fetch }));

const { createStripeHttpClient, STRIPE_API_VERSION } = await import("./stripe-http-client");

// A made-up key: no real key anywhere.
const API_KEY = "rk_test_FAKEFAKEFAKEFAKE0123456789";
const RANGE = { apiKey: API_KEY, createdFrom: 1_735_686_000, createdTo: 1_767_221_999 };

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const list = (data: unknown[], hasMore = false, url = "/v1/application_fees") => ({
  object: "list",
  data,
  has_more: hasMore,
  url,
});

const refund = (id: string, created = 1_740_000_000, amount = 50) => ({
  id,
  object: "fee_refund",
  amount,
  balance_transaction: null,
  created,
  currency: "eur",
  fee: "fee_x",
  metadata: {},
});

const fee = (id: string, refunds = list([]), extra: Record<string, unknown> = {}) => ({
  id,
  object: "application_fee",
  account: "acct_1Connected",
  amount: 250,
  amount_refunded: 0,
  application: "ca_1",
  charge: "ch_1",
  created: 1_740_000_000,
  currency: "eur",
  livemode: false,
  refunded: false,
  refunds,
  ...extra,
});

/** The requested URLs, parsed. */
const requestedUrls = () => plugin.fetch.mock.calls.map(([input]) => new URL(input));

const sleep = vi.fn<(ms: number) => Promise<void>>();
const client = () => createStripeHttpClient({ sleep });

describe("createStripeHttpClient – listApplicationFees", () => {
  beforeEach(() => {
    plugin.fetch.mockReset();
    sleep.mockReset().mockResolvedValue(undefined);
  });

  it("sends the range as created[gte|lte], the key as Bearer header only and pins the version", async () => {
    plugin.fetch.mockResolvedValueOnce(json(list([fee("fee_1")])));
    expect(await client().listApplicationFees(RANGE)).toEqual({
      ok: true,
      fees: [
        {
          id: "fee_1",
          amount: 250,
          currency: "eur",
          created: 1_740_000_000,
          account: "acct_1Connected",
          livemode: false,
          refunds: [],
        },
      ],
    });
    const [input, init] = plugin.fetch.mock.calls[0] ?? [];
    const url = new URL(input ?? "");
    expect(url.origin + url.pathname).toBe("https://api.stripe.com/v1/application_fees");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      "created[gte]": "1735686000",
      "created[lte]": "1767221999",
      limit: "100",
    });
    expect(input).not.toContain(API_KEY);
    expect(init).toMatchObject({
      method: "GET",
      headers: { Authorization: `Bearer ${API_KEY}`, "Stripe-Version": STRIPE_API_VERSION },
      maxRedirections: 0,
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("follows the cursor while has_more", async () => {
    plugin.fetch
      .mockResolvedValueOnce(json(list([fee("fee_3"), fee("fee_2")], true)))
      .mockResolvedValueOnce(json(list([fee("fee_1")], false)));
    const result = await client().listApplicationFees(RANGE);
    expect(result.ok && result.fees.map((f) => f.id)).toEqual(["fee_3", "fee_2", "fee_1"]);
    const [first, second] = requestedUrls();
    expect(first?.searchParams.has("starting_after")).toBe(false);
    expect(second?.searchParams.get("starting_after")).toBe("fee_2");
    expect(second?.searchParams.get("created[gte]")).toBe("1735686000");
  });

  it("takes embedded refunds and pages the refunds endpoint when they are truncated", async () => {
    const embedded = list(
      [refund("fr_3", 1_740_000_300), refund("fr_2", 1_740_000_200)],
      true,
      "/v1/application_fees/fee_2/refunds",
    );
    plugin.fetch
      .mockResolvedValueOnce(
        json(list([fee("fee_2", embedded), fee("fee_1", list([refund("fr_a", 1_740_000_100)]))])),
      )
      .mockResolvedValueOnce(json(list([refund("fr_1", 1_740_000_100, 70)], false)));
    const result = await client().listApplicationFees(RANGE);
    expect(result).toMatchObject({
      ok: true,
      fees: [
        {
          id: "fee_2",
          refunds: [
            { id: "fr_3", created: 1_740_000_300 },
            { id: "fr_2" },
            { id: "fr_1", amount: 70, currency: "eur", created: 1_740_000_100 },
          ],
        },
        { id: "fee_1", refunds: [{ id: "fr_a" }] },
      ],
    });
    const refundsUrl = requestedUrls()[1];
    expect(refundsUrl?.pathname).toBe("/v1/application_fees/fee_2/refunds");
    expect(Object.fromEntries(refundsUrl?.searchParams ?? [])).toEqual({
      limit: "100",
      starting_after: "fr_2",
    });
    expect(plugin.fetch).toHaveBeenCalledTimes(2);
  });

  it("fetches all refunds from the endpoint if the fee has no embedded list", async () => {
    plugin.fetch
      .mockResolvedValueOnce(json(list([fee("fee_1", undefined, { refunds: undefined })])))
      .mockResolvedValueOnce(json(list([refund("fr_9")], true)))
      .mockResolvedValueOnce(json(list([refund("fr_8")], false)));
    const result = await client().listApplicationFees(RANGE);
    expect(result.ok && result.fees[0]?.refunds.map((r) => r.id)).toEqual(["fr_9", "fr_8"]);
    const urls = requestedUrls();
    expect(urls[1]?.searchParams.has("starting_after")).toBe(false);
    expect(urls[2]?.searchParams.get("starting_after")).toBe("fr_9");
  });

  it("accepts an expanded account object", async () => {
    plugin.fetch.mockResolvedValueOnce(
      json(list([fee("fee_1", list([]), { account: { id: "acct_2", object: "account" } })])),
    );
    const result = await client().listApplicationFees(RANGE);
    expect(result.ok && result.fees[0]?.account).toBe("acct_2");
  });

  it.each([
    [401, { code: "invalidApiKey" }],
    [403, { code: "permissionDenied" }],
  ])("maps HTTP %i", async (status, error) => {
    plugin.fetch.mockResolvedValueOnce(
      json(
        {
          error: {
            type: "invalid_request_error",
            message: `Invalid API Key provided: rk_test_****6789`,
          },
        },
        status,
      ),
    );
    expect(await client().listApplicationFees(RANGE)).toEqual({ ok: false, error });
  });

  it("maps other errors with Stripe's code and message", async () => {
    plugin.fetch.mockResolvedValueOnce(
      json({ error: { code: "parameter_invalid_integer", message: "Invalid integer" } }, 400),
    );
    expect(await client().listApplicationFees(RANGE)).toEqual({
      ok: false,
      error: {
        code: "stripeError",
        status: 400,
        stripeCode: "parameter_invalid_integer",
        message: "Invalid integer",
      },
    });
    plugin.fetch.mockResolvedValueOnce(new Response("<html>Not found</html>", { status: 404 }));
    expect(await client().listApplicationFees(RANGE)).toEqual({
      ok: false,
      error: { code: "stripeError", status: 404, stripeCode: null, message: null },
    });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries 429 respecting Retry-After, then succeeds", async () => {
    plugin.fetch
      .mockResolvedValueOnce(json({ error: { code: "rate_limit" } }, 429, { "Retry-After": "3" }))
      .mockResolvedValueOnce(json({ error: { code: "rate_limit" } }, 429))
      .mockResolvedValueOnce(json(list([fee("fee_1")])));
    const result = await client().listApplicationFees(RANGE);
    expect(result.ok).toBe(true);
    expect(sleep.mock.calls).toEqual([[3000], [2000]]);
  });

  it("gives up after three rate-limited attempts and caps the wait", async () => {
    plugin.fetch.mockImplementation(() =>
      Promise.resolve(json({ error: { code: "rate_limit" } }, 429, { "Retry-After": "120" })),
    );
    expect(await client().listApplicationFees(RANGE)).toEqual({
      ok: false,
      error: { code: "rateLimited", retryAfterSeconds: 120 },
    });
    expect(plugin.fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[10_000], [10_000]]);
  });

  it("maps a failed request to network after the retries, without the plugin's message", async () => {
    plugin.fetch.mockRejectedValue(new Error("url not allowed on the configured scope"));
    expect(await client().listApplicationFees(RANGE)).toEqual({
      ok: false,
      error: { code: "network" },
    });
    expect(plugin.fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
  });

  it("retries a network error and continues", async () => {
    plugin.fetch
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(json(list([fee("fee_1")])));
    expect(await client().listApplicationFees(RANGE)).toMatchObject({ ok: true });
    expect(sleep.mock.calls).toEqual([[1000]]);
  });

  it.each([500, 502, 503, 504])("retries %i with backoff, then succeeds", async (status) => {
    plugin.fetch
      .mockResolvedValueOnce(json({ error: { message: "temporary" } }, status))
      .mockResolvedValueOnce(
        json({ error: { message: "temporary" } }, status, { "Retry-After": "4" }),
      )
      .mockResolvedValueOnce(json(list([fee("fee_1")])));
    expect(await client().listApplicationFees(RANGE)).toMatchObject({ ok: true });
    expect(sleep.mock.calls).toEqual([[1000], [4000]]);
  });

  it("gives up on a server error after three attempts", async () => {
    plugin.fetch.mockImplementation(() =>
      Promise.resolve(new Response("<html>Bad gateway</html>", { status: 502 })),
    );
    expect(await client().listApplicationFees(RANGE)).toEqual({
      ok: false,
      error: { code: "stripeError", status: 502, stripeCode: null, message: null },
    });
    expect(plugin.fetch).toHaveBeenCalledTimes(3);
  });

  it("does not retry a timeout", async () => {
    plugin.fetch.mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const result = await createStripeHttpClient({ sleep, timeoutMs: 5 }).listApplicationFees(RANGE);
    expect(result).toEqual({ ok: false, error: { code: "timeout" } });
    expect(plugin.fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a reversed range as a programmer error", async () => {
    await expect(
      client().listApplicationFees({ ...RANGE, createdFrom: RANGE.createdTo + 1 }),
    ).rejects.toThrow(RangeError);
    expect(plugin.fetch).not.toHaveBeenCalled();
  });

  it("aborts after the timeout", async () => {
    plugin.fetch.mockImplementationOnce(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const result = await createStripeHttpClient({ sleep, timeoutMs: 5 }).listApplicationFees(RANGE);
    expect(result).toEqual({ ok: false, error: { code: "timeout" } });
  });

  it.each([
    ["no JSON", "<html>"],
    ["no list", JSON.stringify({ object: "application_fee" })],
    ["wrong item", JSON.stringify(list([{ ...fee("fee_1"), amount: "250" }]))],
    ["negative amount", JSON.stringify(list([{ ...fee("fee_1"), amount: -1 }]))],
    ["bad currency", JSON.stringify(list([{ ...fee("fee_1"), currency: "EUR" }]))],
    ["bad id", JSON.stringify(list([{ ...fee("ch_1") }]))],
    [
      "bad refund",
      JSON.stringify(list([fee("fee_1", list([{ ...refund("fr_1"), amount: 1.5 }]))])),
    ],
    ["has_more without data", JSON.stringify(list([], true))],
  ])("rejects an invalid response (%s)", async (_name, body) => {
    plugin.fetch.mockResolvedValueOnce(new Response(body, { status: 200 }));
    expect(await client().listApplicationFees(RANGE)).toEqual({
      ok: false,
      error: { code: "invalidResponse" },
    });
  });

  it("drops everything on an error in a later page", async () => {
    plugin.fetch
      .mockResolvedValueOnce(json(list([fee("fee_2")], true)))
      .mockResolvedValueOnce(json({ error: { message: "boom" } }, 400));
    expect(await client().listApplicationFees(RANGE)).toMatchObject({
      ok: false,
      error: { code: "stripeError", status: 400 },
    });
  });

  it("never puts the key into a result", async () => {
    plugin.fetch.mockResolvedValueOnce(json({ error: { message: "Invalid API Key" } }, 401));
    const result = await client().listApplicationFees(RANGE);
    expect(JSON.stringify(result)).not.toContain(API_KEY);
  });
});

describe("createStripeHttpClient – verifyAccess", () => {
  beforeEach(() => plugin.fetch.mockReset());

  it("lists one fee and reports its mode", async () => {
    plugin.fetch.mockResolvedValueOnce(
      json(list([fee("fee_1", list([]), { livemode: true })], true)),
    );
    expect(await client().verifyAccess({ apiKey: API_KEY })).toEqual({ ok: true, livemode: true });
    expect(Object.fromEntries(requestedUrls()[0]?.searchParams ?? [])).toEqual({ limit: "1" });
    expect(plugin.fetch).toHaveBeenCalledTimes(1);
  });

  it("reports null without fees and passes errors on", async () => {
    plugin.fetch.mockResolvedValueOnce(json(list([])));
    expect(await client().verifyAccess({ apiKey: API_KEY })).toEqual({ ok: true, livemode: null });
    plugin.fetch.mockResolvedValueOnce(json({}, 403));
    expect(await client().verifyAccess({ apiKey: API_KEY })).toEqual({
      ok: false,
      error: { code: "permissionDenied" },
    });
  });
});

const account = (extra: Record<string, unknown> = {}) => ({
  id: "acct_1Connected",
  object: "account",
  business_profile: { name: null },
  settings: { dashboard: { display_name: null } },
  ...extra,
});

describe("createStripeHttpClient – getAccountName", () => {
  beforeEach(() => {
    plugin.fetch.mockReset();
    sleep.mockReset().mockResolvedValue(undefined);
  });

  const request = { apiKey: API_KEY, accountId: "acct_1Connected" };

  it("requests the account with the key as header and returns the business name", async () => {
    plugin.fetch.mockResolvedValueOnce(
      json(account({ business_profile: { name: "  Yoga Studio  " } })),
    );
    expect(await client().getAccountName(request)).toEqual({ ok: true, name: "Yoga Studio" });
    const [url] = requestedUrls();
    expect(`${url?.origin}${url?.pathname}`).toBe(
      "https://api.stripe.com/v1/accounts/acct_1Connected",
    );
    expect(url?.toString()).not.toContain(API_KEY);
    const init = plugin.fetch.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${API_KEY}`);
  });

  it.each([
    ["dashboard display name", { settings: { dashboard: { display_name: "Display" } } }, "Display"],
    ["company name", { company: { name: "Firma GmbH" } }, "Firma GmbH"],
    [
      "individual's name",
      { individual: { first_name: "Erika", last_name: "Muster" } },
      "Erika Muster",
    ],
    ["nothing", {}, null],
  ])("falls back to the %s", async (_, extra, name) => {
    plugin.fetch.mockResolvedValueOnce(json(account(extra)));
    expect(await client().getAccountName(request)).toEqual({ ok: true, name });
  });

  it("rejects another object or account and maps 403", async () => {
    plugin.fetch.mockResolvedValueOnce(json(account({ id: "acct_Other" })));
    expect(await client().getAccountName(request)).toEqual({
      ok: false,
      error: { code: "invalidResponse" },
    });
    plugin.fetch.mockResolvedValueOnce(json({ error: { message: "no" } }, 403));
    expect(await client().getAccountName(request)).toEqual({
      ok: false,
      error: { code: "permissionDenied" },
    });
  });

  it("refuses an ID that is no account ID", async () => {
    await expect(
      client().getAccountName({ apiKey: API_KEY, accountId: "../application_fees" }),
    ).rejects.toThrow(RangeError);
    expect(plugin.fetch).not.toHaveBeenCalled();
  });
});
