// Backwards-compatible optional metadata on the adapter's result array.
// Enumerable domain records remain unchanged for existing callers.
export function withSourceMeta(items, sourceMeta) {
  Object.defineProperty(items, "sourceMeta", { value: sourceMeta, enumerable: false });
  return items;
}
