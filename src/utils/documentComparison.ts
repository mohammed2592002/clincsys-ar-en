// JSON object property order is not an edit. Array order and value types still are.
export function stableJson(value: any): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
      : item,
  );
}
export function sameValue(a: any, b: any): boolean {
  return stableJson(a ?? null) === stableJson(b ?? null);
}
export const SERVER_METADATA = new Set(['updatedAt', '_fieldEdits', '_syncStatus']);
