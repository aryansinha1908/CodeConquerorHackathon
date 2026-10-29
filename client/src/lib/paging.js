// Paging (api.md "Values": page 1–10000, default 1; limit ≥ 1, default 20, capped at 50;
// meta { page, limit, total } where limit is the value actually used).

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE = 10000;

/** A ?page= value → a whole number from 1 to 10000 (1 when missing or not one). */
export function readPage(value) {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1;
}

/** meta { page, limit, total } → the number of pages, at least 1. */
export function pageCount(meta, fallbackLimit = DEFAULT_PAGE_SIZE) {
  const limit = Number(meta?.limit) || fallbackLimit;
  const total = Number(meta?.total) || 0;
  return Math.max(1, Math.ceil(total / limit));
}
