const VALUE_KEY_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$-]*$/;

export type ValueReference = {
  expression: string;
  key?: string;
  start: number;
  end: number;
};

/**
 * Finds complete values-like Handlebars expressions without parsing or
 * evaluating the surrounding Handlebars/prose syntax. Only expressions that
 * begin with `values` as a standalone token are considered references.
 */
export function analyzeValueReferences(source: string): ValueReference[] {
  const references: ValueReference[] = [];
  const expressionPattern = /\{\{([\s\S]*?)\}\}/g;

  for (const match of source.matchAll(expressionPattern)) {
    const expression = (match[1] ?? "").trim();
    const isValuesLike = /^values(?:[^A-Za-z0-9_$-]|$)/.test(expression);
    const valueTokens = expression.match(
      /(?:^|\s)values(?=[^A-Za-z0-9_$-]|$)/g,
    );
    if (isValuesLike && valueTokens?.length === 1) {
      const supported = /values\.([^\s{}]+)$/.exec(expression);
      references.push({
        expression,
        key: supported?.[1],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  return references;
}

export type ValueReferenceVisitor = (
  reference: ValueReference,
  path: (string | number)[],
) => void;

/** Walks all string values and object keys using the same parser as rendering. */
export function walkValueReferences(
  input: unknown,
  visit: ValueReferenceVisitor,
  path: (string | number)[] = [],
): void {
  if (typeof input === "string") {
    for (const reference of analyzeValueReferences(input))
      visit(reference, path);
    return;
  }

  if (Array.isArray(input)) {
    for (const [index, value] of input.entries())
      walkValueReferences(value, visit, [...path, index]);
    return;
  }

  if (typeof input !== "object" || input === null) return;

  for (const [key, value] of Object.entries(input)) {
    for (const reference of analyzeValueReferences(key)) visit(reference, path);
    walkValueReferences(value, visit, [...path, key]);
  }
}

export function isValidValueKey(key: string): boolean {
  return VALUE_KEY_PATTERN.test(key);
}
