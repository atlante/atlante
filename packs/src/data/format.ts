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

export function formatPassRate(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatEvaluationDuration(value: number | null): string {
  if (value === null) return "Not reported";
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}s`;
  }
  return `${value}ms`;
}

export function formatEvaluationTokens(value: number | null): string {
  return value === null ? "Not reported" : formatCount(value);
}

export function formatEvaluationCost(value: number | null): string {
  if (value === null) return "Not reported";
  if (value === 0) return "Included";
  return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
}
