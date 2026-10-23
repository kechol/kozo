/** How long ago `iso` was, in the largest whole unit, as "3 h ago". */
export function ago(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const units: [number, string][] = [
    [86_400, "d"],
    [3600, "h"],
    [60, "min"],
  ];
  for (const [size, name] of units) {
    if (seconds >= size) return `${Math.floor(seconds / size)} ${name} ago`;
  }
  return "just now";
}

export const usd = (amount: number) => `$${amount.toFixed(2)}`;
