export function shout(text: string): string {
  const trimmed = text.trim();
  return `${trimmed.toUpperCase()}!`;
}
