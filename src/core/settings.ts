export function settingsEqual(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.is(left[key], right[key]));
}
