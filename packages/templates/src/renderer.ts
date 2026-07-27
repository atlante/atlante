import Handlebars from "handlebars";
import { slotsOf } from "./composition.js";
import type { TemplateRegistry } from "./loader.js";
import { analyzeValueReferences, isValidValueKey } from "./values.js";

export type RenderArgs = {
  registry: TemplateRegistry;
  templateId: string;
  input: Record<string, unknown>;
};

export const SLOT_PARTIAL_PREFIX = "slot/";

export function slotPartialName(property: string): string {
  return `${SLOT_PARTIAL_PREFIX}${property}`;
}

/**
 * Renders a template depth-first: each slot's child is rendered first and its
 * Markdown is registered as a partial function, so the child's output is
 * inserted verbatim and never re-parsed by Handlebars.
 *
 * `noEscape` is required because the output is Markdown — HTML escaping would
 * corrupt quotes and ampersands inside prompts. `strict` is off because
 * optional fields would otherwise throw on every `{{#if}}` over an absent key;
 * input correctness is already guaranteed by the template's inputSchema.
 *
 * `stack` tracks the chain of template ids currently being rendered so a
 * self-referential composition fails with a clear error instead of
 * overflowing the call stack. It is internal bookkeeping, not part of the
 * public API surface: callers never need to pass it.
 */
export function renderTemplate(
  { registry, templateId, input }: RenderArgs,
  stack: string[] = [],
): string {
  if (stack.includes(templateId)) {
    const chain = [...stack, templateId];
    throw new Error(`circular template composition: ${chain.join(" -> ")}`);
  }

  const template = registry.get(templateId);
  if (!template) throw new Error(`unknown template: ${templateId}`);

  const handlebars = Handlebars.create();
  const nextStack = [...stack, templateId];

  const slots = slotsOf(template.inputSchema);
  const renderedSlots = slots.map((slot) => {
    const slotInput = Object.hasOwn(input, slot.property)
      ? input[slot.property]
      : undefined;
    const rendered =
      slotInput === undefined || slotInput === null
        ? ""
        : renderTemplate(
            {
              registry,
              templateId: slot.templateId,
              input: slotInput as Record<string, unknown>,
            },
            nextStack,
          );
    return { rendered, slot };
  });

  for (const { rendered, slot } of renderedSlots) {
    handlebars.registerPartial(slotPartialName(slot.property), () => rendered);
  }

  const compiled = handlebars.compile(template.source, {
    noEscape: true,
    strict: false,
  });

  return compiled(input);
}

/** Resolves one flat key against the values map. */
function resolvePath(source: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(source, key) ? source[key] : undefined;
}

/**
 * Thrown when a `{{values.<path>}}` reference is missing. Missing values are
 * invalid input under SPECIFICATION.md §4.2; they must not silently disappear
 * from a prompt.
 */
export class MissingValueError extends Error {
  constructor(path: string) {
    super(`missing required value "{{values.${path}}}"`);
    this.name = "MissingValueError";
  }
}

/** Thrown when a values-like reference does not use the supported key syntax. */
export class InvalidValueReferenceError extends Error {
  constructor(reference: string, expression = `values.${reference}`) {
    super(
      `invalid values reference "{{${expression}}}"; value names must match [A-Za-z_$][A-Za-z0-9_$-]*`,
    );
    this.name = "InvalidValueReferenceError";
  }
}

/** Thrown when two interpolated object keys would silently overwrite data. */
export class ValueReferenceCollisionError extends Error {
  readonly path: (string | number)[];

  constructor(key: string, path: (string | number)[] = []) {
    super(`interpolated object keys collide at "${key}"`);
    this.name = "ValueReferenceCollisionError";
    this.path = path;
  }
}

/**
 * Thrown when a values reference resolves to something other than a string.
 * The document schema already rejects this, but the guard protects callers
 * that assemble a document in memory and bypass document validation.
 */
export class NonStringValueError extends Error {
  constructor(path: string, resolved: unknown) {
    super(
      `{{values.${path}}} resolved to a non-string value (${typeof resolved}); values must be strings (SPECIFICATION.md §4.2)`,
    );
    this.name = "NonStringValueError";
  }
}

/**
 * Substitutes `{{values.<key>}}` references in `source` with the resolved
 * value; a missing or nullish path throws `MissingValueError`. This is
 * targeted string substitution, not template evaluation: every other
 * character — unrelated `{{...}}` syntax, unbalanced braces, prose that
 * merely looks like a reference — is left exactly as written and this never
 * throws for those. That matters here because Atlante is a prompt-engineering
 * tool, so prompt text that documents or discusses `{{...}}` syntax is a
 * normal, expected input, not an edge case. A resolved value that is neither
 * a string (when non-nullish) throws `NonStringValueError` instead of
 * silently stringifying to `one,two` or `[object Object]`.
 */
export function renderString(
  source: string,
  values: Record<string, unknown>,
): string {
  const references = analyzeValueReferences(source);
  if (references.length === 0) return source;

  let output = "";
  let cursor = 0;
  for (const reference of references) {
    output += source.slice(cursor, reference.start);
    const key = reference.key;
    if (!key || !isValidValueKey(key))
      throw new InvalidValueReferenceError(
        key ?? reference.expression,
        reference.expression,
      );
    const resolved = resolvePath(values, key);
    if (resolved === null || resolved === undefined)
      throw new MissingValueError(key);
    if (typeof resolved !== "string")
      throw new NonStringValueError(key, resolved);
    output += resolved;
    cursor = reference.end;
  }
  return output + source.slice(cursor);
}

/**
 * Deep-walks prompt input and resolves every `{{values.x}}` reference before
 * template rendering (SPECIFICATION.md §6.4, §7). Template rendering never
 * re-processes already-substituted input, so without this pass a document
 * field containing `{{values.project}}` would reach the prompt as that
 * literal text.
 */
export function interpolateValues<T>(
  input: T,
  values: Record<string, unknown>,
  path: (string | number)[] = [],
): T {
  if (typeof input === "string") return renderString(input, values) as T;

  if (Array.isArray(input)) {
    return input.map((item, index) =>
      interpolateValues(item, values, [...path, index]),
    ) as T;
  }

  if (typeof input === "object" && input !== null) {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      const resolvedKey = renderString(key, values);
      if (Object.hasOwn(output, resolvedKey))
        throw new ValueReferenceCollisionError(resolvedKey, path);
      Object.defineProperty(output, resolvedKey, {
        configurable: true,
        enumerable: true,
        value: interpolateValues(value, values, [...path, resolvedKey]),
        writable: true,
      });
    }
    return output as T;
  }

  return input;
}
