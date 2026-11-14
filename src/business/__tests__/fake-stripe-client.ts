import type {
  ListApplicationFeesRequest,
  StripeApplicationFee,
  StripeClient,
  StripeClientError,
  StripeFeeRefund,
} from "../stripe";

/**
 * In-memory {@link StripeClient} for business tests (#29, used by the import
 * service #30). Behaves like the HTTP client: filters fees by
 * `createdFrom ≤ created ≤ createdTo`, newest first, each with all its
 * refunds. `failWith` makes every call return that error.
 */
export interface FakeStripeClient extends StripeClient {
  /** Fees the "account" has; refunds may be added later (mutable on purpose). */
  readonly fees: StripeApplicationFee[];
  /** Every request, key included, to assert on what the caller sent. */
  readonly requests: ListApplicationFeesRequest[];
  failWith: StripeClientError | null;
}

export function createFakeStripeClient(fees: StripeApplicationFee[] = []): FakeStripeClient {
  const client: FakeStripeClient = {
    fees,
    requests: [],
    failWith: null,
    listApplicationFees: (request) => {
      client.requests.push(request);
      if (client.failWith) return Promise.resolve({ ok: false, error: client.failWith });
      const inRange = client.fees
        .filter((fee) => fee.created >= request.createdFrom && fee.created <= request.createdTo)
        .toSorted((a, b) => b.created - a.created);
      return Promise.resolve({ ok: true, fees: inRange });
    },
    verifyAccess: () => {
      if (client.failWith) return Promise.resolve({ ok: false, error: client.failWith });
      return Promise.resolve({ ok: true, livemode: client.fees[0]?.livemode ?? null });
    },
  };
  return client;
}

let sequence = 0;

/** A EUR fee with defaults; override what the test is about. */
export function stripeFee(
  overrides: Partial<StripeApplicationFee> & Pick<StripeApplicationFee, "created">,
): StripeApplicationFee {
  sequence += 1;
  return {
    id: `fee_test${sequence}`,
    amount: 1000,
    currency: "eur",
    account: "acct_test1",
    livemode: false,
    refunds: [],
    ...overrides,
  };
}

/** A EUR refund with defaults. */
export function stripeFeeRefund(
  overrides: Partial<StripeFeeRefund> & Pick<StripeFeeRefund, "created">,
): StripeFeeRefund {
  sequence += 1;
  return { id: `fr_test${sequence}`, amount: 500, currency: "eur", ...overrides };
}
