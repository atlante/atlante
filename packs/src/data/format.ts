export function formatCount(value: number | null): string {
  if (value === null) return "0";
  if (value >= 1000) {
    return `${(value / 1000)
      .toFixed(value >= 10000 ? 1 : 2)
      .replace(/\.0$/, "")}k`;
  }
  return String(value);
}

export function formatDate(iso: string | null): string {
  if (iso === null) return "—";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

export function formatSyncTime(iso: string): string {
  const date = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
  const time = new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(iso));
  return `${date} at ${time} UTC`;
}

export function formatShortSyncTime(iso: string): string {
  const date = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    timeZone: "UTC",
  }).format(new Date(iso));
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(iso));
  return `${date} at ${time} UTC`;
}
