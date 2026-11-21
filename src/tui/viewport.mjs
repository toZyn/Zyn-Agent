export const DEFAULT_VISIBLE_ITEMS = 400;

export function appendVisibleItem(items, item, limit = DEFAULT_VISIBLE_ITEMS) {
  const max = Number.isInteger(limit) && limit >= 100 && limit <= 5000
    ? limit
    : DEFAULT_VISIBLE_ITEMS;
  return [...items.slice(-(max - 1)), item];
}
