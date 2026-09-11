export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function highlightJson(source: string): string {
  const escaped = escapeHtml(source);
  const pattern =
    /("(?:\\.|[^"\\])*")(?=\s*:)|("(?:\\.|[^"\\])*")|(\b(?:true|false|null)\b|-?\d+(?:\.\d+)?)/g;
  return escaped.replace(pattern, (token, key?: string, value?: string) => {
    if (key) return `<span class="token-key">${token}</span>`;
    if (value) return `<span class="token-string">${token}</span>`;
    return `<span class="token-literal">${token}</span>`;
  });
}

export function highlightMarkdown(source: string): string {
  return escapeHtml(source)
    .replace(/^(#{1,6} .*)$/gm, '<span class="token-md-heading">$1</span>')
    .replace(/\*\*([^*]+)\*\*/g, '<span class="token-key">**$1**</span>')
    .replace(/`([^`\n]+)`/g, '<span class="token-string">`$1`</span>')
    .replace(/^([-*] .*)$/gm, '<span class="token-md-item">$1</span>');
}

/**
 * Highlights a pack file for preview with the same token colors the
 * playground uses for its configuration and generated files.
 */
export function highlightFile(path: string, content: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name.endsWith(".jsonc") || name.endsWith(".json")) {
    return highlightJson(content);
  }
  if (name.endsWith(".md")) {
    return highlightMarkdown(content);
  }
  return escapeHtml(content);
}
