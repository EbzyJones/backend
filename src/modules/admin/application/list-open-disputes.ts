import type { DisputeReviewItem, DisputeReviewReader } from '../domain/index.js';

export interface ListOpenDisputesDeps {
  disputeReviewReader: DisputeReviewReader;
}

export interface ListOpenDisputesInput {
  limit?: number;
  /** ID cursor — the previous page's `nextCursor` (`raisedAt|chainDeliveryId`). */
  after?: string;
}

export interface ListOpenDisputesResult {
  items: DisputeReviewItem[];
  nextCursor: string | null;
  /** Effective page size after clamping to `MAX_LIMIT` — mirrors
   * `ListAuditLogResult.limit` so the response envelope can echo it back. */
  limit: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Creates the use case for listing disputes that are awaiting administrative
 * review.
 *
 * The returned function fetches a page of open disputes from the injected
 * reader using `raisedAt|chainDeliveryId` keyset-cursor pagination (the same
 * shape as the `notifications` list endpoint — see #101). The requested
 * `limit` is clamped to `MAX_LIMIT` (200) and defaults to `DEFAULT_LIMIT`
 * (50) when omitted — matching `listAuditLog` and the route's zod query
 * schema. A malformed `after` cursor is rejected with `Invalid dispute
 * cursor` rather than silently restarting from the first page.
 *
 * @param deps - Use case dependencies; requires a `disputeReviewReader` used
 *   to retrieve the currently open disputes.
 * @returns An async function that accepts an optional {@link ListOpenDisputesInput}
 *   (`limit` and `raisedAt|chainDeliveryId` `after` cursor) and resolves to
 *   a {@link ListOpenDisputesResult} containing the page `items`, the
 *   `nextCursor` for the following page (or `null` when there are no more
 *   rows), and the effective `limit` that was applied.
 */
export function createListOpenDisputesUseCase(deps: ListOpenDisputesDeps) {
  return async function listOpenDisputes(
    input: ListOpenDisputesInput = {},
  ): Promise<ListOpenDisputesResult> {
    const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const page = await deps.disputeReviewReader.listOpenDisputes({
      limit,
      ...(input.after && { after: decodeCursor(input.after) }),
    });
    const hasMore = page.length > limit;
    const items = page.slice(0, limit);
    const lastItem = items[items.length - 1];
    const nextCursor =
      hasMore && lastItem
        ? `${lastItem.raisedAt.toISOString()}|${lastItem.chainDeliveryId.toString()}`
        : null;

    return { items, nextCursor, limit };
  };
}

/** ISO-8601 UTC datetime, the exact form `nextCursor` emits
 * (`Date.toISOString()`) and the route's `disputeCursor` schema accepts. */
const ISO_UTC_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
/** Unsigned decimal id without leading zeros — mirrors the route schema's
 * `/^(0|[1-9]\d{0,18})$/` so use-case-level and HTTP-level validation agree. */
const CURSOR_CHAIN_DELIVERY_ID = /^(?:0|[1-9]\d{0,18})$/;

/**
 * Decodes a `nextCursor` from a previous page back into the reader's
 * keyset filter (`raisedAt` + `chainDeliveryId`), mirroring the route's
 * `disputeCursor` zod refine (single `|` separator, ISO-8601 UTC timestamp,
 * plain-unsigned id). Throws `Invalid dispute cursor` on anything malformed —
 * a corrupted cursor must fail loudly rather than degrade to an unkeyed
 * first-page fetch that would silently loop the admin UI.
 */
function decodeCursor(cursor: string): { raisedAt: Date; chainDeliveryId: bigint } {
  const separatorIndex = cursor.indexOf('|');
  if (separatorIndex <= 0 || separatorIndex !== cursor.lastIndexOf('|')) {
    throw new Error('Invalid dispute cursor');
  }

  const raisedAtRaw = cursor.slice(0, separatorIndex);
  const chainDeliveryIdRaw = cursor.slice(separatorIndex + 1);
  const raisedAt = new Date(raisedAtRaw);
  if (
    !ISO_UTC_DATETIME.test(raisedAtRaw) ||
    Number.isNaN(raisedAt.getTime()) ||
    !CURSOR_CHAIN_DELIVERY_ID.test(chainDeliveryIdRaw) ||
    BigInt(chainDeliveryIdRaw) > 9_223_372_036_854_775_807n
  ) {
    throw new Error('Invalid dispute cursor');
  }

  return { raisedAt, chainDeliveryId: BigInt(chainDeliveryIdRaw) };
}
