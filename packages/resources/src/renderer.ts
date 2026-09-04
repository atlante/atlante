import Handlebars from "handlebars";
import {
  copyResourceTemplateSelection,
  resourceTemplateSelection,
} from "./resolution.js";
import type { ResolvedTemplate, ResolvedTemplateSlot } from "./resolve.js";
import { analyzeValueReferences, isValidValueKey } from "./values.js";

export const SLOT_PARTIAL_PREFIX = "slot/";

export function slotPartialName(property: string): string {
  return `${SLOT_PARTIAL_PREFIX}${property}`;
}

function presentSlotInput(input: unknown): unknown[] {
  return input === null || input === undefined ? [] : [input];
}

// Unlike isRecord, this intentionally accepts arrays: indexed itemPath segments
// (tuple positions) are looked up through hasOwn on array elements.
function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Resolves every location of a slot value in the template input.
 *
 * For `arrayItems` slots the leading dataPath segments address the arrays whose
 * items carry the slot; those are iterated and the remaining item-relative path
 * is descended plainly within each item, so a slot value of any shape (including
 * an array) is returned whole. Without `arrayItems` the whole dataPath is a
 * plain descent from the template input.
 */
function slotValues(
  input: unknown,
  dataPath: string[],
  itemPath: string[],
  arrayItems: boolean,
): unknown[] {
  if (!arrayItems) return itemSlotValues(input, dataPath);
  const collections = dataPath.length - itemPath.length;
  return collectSlotValues(input, dataPath.slice(0, collections), itemPath);
}

function collectSlotValues(
  input: unknown,
  collections: string[],
  itemPath: string[],
): unknown[] {
  const segment = collections[0];
  if (segment === undefined) return itemSlotValues(input, itemPath);
  if (!isRecordLike(input) || !Object.hasOwn(input, segment)) return [];
  const value = input[segment];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    collectSlotValues(item, collections.slice(1), itemPath),
  );
}

function itemSlotValues(input: unknown, itemPath: string[]): unknown[] {
  const segment = itemPath[0];
  if (segment === undefined) return presentSlotInput(input);
  if (!isRecordLike(input) || !Object.hasOwn(input, segment)) return [];
  return itemSlotValues(input[segment], itemPath.slice(1));
}

/**
 * Reports whether a value exists along the slot path but its shape blocks slot
 * resolution (an iteration segment that is not an array, or a scalar where the
 * path must continue). Diagnostics only: it never iterates for resolution and
 * is consulted exclusively when a slot resolved to zero inputs.
 */
function blockedSlotValues(
  input: unknown,
  dataPath: string[],
  itemPath: string[],
  arrayItems: boolean,
): boolean {
  if (!arrayItems) return blockedDescent(input, dataPath);
  const collections = dataPath.length - itemPath.length;
  return blockedCollections(input, dataPath.slice(0, collections), itemPath);
}

function blockedCollections(
  input: unknown,
  collections: string[],
  itemPath: string[],
): boolean {
  const segment = collections[0];
  if (segment === undefined) return blockedDescent(input, itemPath);
  if (!isRecordLike(input) || !Object.hasOwn(input, segment)) return false;
  const value = input[segment];
  if (!Array.isArray(value)) return true;
  return value.some((item) =>
    blockedCollections(item, collections.slice(1), itemPath),
  );
}

function blockedDescent(input: unknown, path: string[]): boolean {
  const segment = path[0];
  if (segment === undefined) return false;
  if (!isRecordLike(input) || !Object.hasOwn(input, segment)) return false;
  const value = input[segment];
  if (path.length === 1) return false;
  if (!isRecordLike(value)) return true;
  return blockedDescent(value, path.slice(1));
}

type SlotLookup = Readonly<{
  /** Resolution walk producing the slot inputs for one render. */
  resolve: () => unknown[];
  /** Mirror of `resolve` consulted only when it produced zero inputs. */
  blocked: () => boolean;
}>;

/**
 * Selects the slot walk and its mirror blocked-shape check from a single
 * branch decision, so the ambiguity diagnostic can never desynchronize from
 * the walk it mirrors. Partial invocations rendered for an item context
 * (`context !== input`) descend the item path within that context; every other
 * invocation walks the group's full data path from the template input.
 */
function slotLookup(
  input: unknown,
  context: unknown,
  dataPath: string[],
  itemPath: string[],
  arrayItems: boolean,
): SlotLookup {
  if (context !== input && arrayItems) {
    return {
      resolve: () => itemSlotValues(context, itemPath),
      blocked: () => blockedDescent(context, itemPath),
    };
  }
  return {
    resolve: () => slotValues(input, dataPath, itemPath, arrayItems),
    blocked: () => blockedSlotValues(input, dataPath, itemPath, arrayItems),
  };
}

function unwrapArrayTemplateInput(
  input: unknown,
  property: string,
  inputSchema: unknown,
): unknown {
  if (
    typeof inputSchema !== "object" ||
    inputSchema === null ||
    (inputSchema as { type?: unknown }).type !== "array" ||
    typeof input !== "object" ||
    input === null ||
    !Object.hasOwn(input, property)
  ) {
    return input;
  }
  return (input as Record<string, unknown>)[property];
}

function isArrayInputSchema(inputSchema: unknown): boolean {
  return (
    typeof inputSchema === "object" &&
    inputSchema !== null &&
    (inputSchema as { type?: unknown }).type === "array"
  );
}

type SlotGroup = Readonly<{
  readonly path: string[];
  readonly slots: readonly ResolvedTemplateSlot[];
}>;

function groupSlots(slots: readonly ResolvedTemplateSlot[]): SlotGroup[] {
  const groups = new Map<
    string,
    { path: string[]; slots: ResolvedTemplateSlot[] }
  >();
  for (const resolvedSlot of slots) {
    const path = resolvedSlot.slot.dataPath ?? [resolvedSlot.slot.property];
    const key = JSON.stringify(path);
    const group = groups.get(key);
    if (group) group.slots.push(resolvedSlot);
    else groups.set(key, { path: [...path], slots: [resolvedSlot] });
  }
  return [...groups.values()];
}

function selectedSlot(
  slots: readonly ResolvedTemplateSlot[],
  input: unknown,
): ResolvedTemplateSlot {
  const selected = resourceTemplateSelection(input)?.templateId;
  const matched = selected
    ? slots.find(({ slot }) => slot.templateId === selected)
    : undefined;
  return (matched ??
    [...slots].sort((left, right) =>
      left.slot.templateId.localeCompare(right.slot.templateId),
    )[0]) as ResolvedTemplateSlot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type PathValue = Readonly<{
  readonly found: boolean;
  readonly value: unknown;
}>;

function pathValue(source: unknown, path: unknown): PathValue {
  if (typeof path !== "string" || path.length === 0)
    return { found: false, value: undefined };

  let current = source;
  for (const segment of path.split(".")) {
    if (!isRecord(current) || !Object.hasOwn(current, segment))
      return { found: false, value: undefined };
    current = current[segment];
  }
  return { found: true, value: current };
}

function hasTruthyMember(value: unknown): boolean {
  return isRecord(value) && Object.values(value).some(Boolean);
}

function anyTruthyAt(collection: unknown, path: unknown): boolean {
  if (!Array.isArray(collection)) return false;
  return collection.some((item) => {
    const resolved = pathValue(item, path);
    return resolved.found && hasTruthyMember(resolved.value);
  });
}

function anyTruthy(
  value: unknown,
  collection: unknown,
  path: unknown,
): boolean {
  return hasTruthyMember(value) || anyTruthyAt(collection, path);
}

function anyEqual(
  collection: unknown,
  path: unknown,
  expected: unknown,
): boolean {
  if (!Array.isArray(collection)) return false;
  return collection.some((item) => {
    const resolved = pathValue(item, path);
    return resolved.found && resolved.value === expected;
  });
}

export type ResolvedRenderArgs = {
  readonly template: ResolvedTemplate;
  readonly input: unknown;
};

/** Renders a template graph that was already selected by resource resolution. */
export function renderResolvedTemplate(
  { template, input }: ResolvedRenderArgs,
  stack: string[] = [],
): string {
  if (stack.includes(template.key)) {
    const chain = [...stack, template.key];
    throw new Error(`circular template composition: ${chain.join(" -> ")}`);
  }

  const handlebars = Handlebars.create();
  handlebars.registerHelper("increment", (value: unknown) => Number(value) + 1);
  handlebars.registerHelper("input", () => input);
  handlebars.registerHelper(
    "isEqual",
    (value: unknown, expected: unknown) => value === expected,
  );
  handlebars.registerHelper("anyEqual", anyEqual);
  handlebars.registerHelper("anyTruthy", anyTruthy);
  const nextStack = [...stack, template.key];
  const slots = template.slots;

  for (const group of groupSlots(slots)) {
    const partial = slotPartialName(
      (group.path.length ? group.path : [group.slots[0]?.slot.property]).join(
        "/",
      ),
    );
    const renderSlot = (context: unknown): string => {
      const contextSlot = selectedSlot(group.slots, context);
      const contextChild = contextSlot.template;
      if (
        isArrayInputSchema(contextChild.facet.inputSchema) &&
        Array.isArray(context)
      ) {
        return renderResolvedTemplate(
          { template: contextChild, input: context },
          nextStack,
        );
      }

      const arrayItems = contextSlot.slot.arrayItems === true;
      const itemPath = arrayItems ? (contextSlot.slot.itemPath ?? []) : [];
      const lookup = slotLookup(
        input,
        context,
        group.path,
        itemPath,
        arrayItems,
      );
      const slotInputsForRender = lookup.resolve();
      if (
        slotInputsForRender.length === 0 &&
        (isArrayInputSchema(contextChild.facet.inputSchema) ||
          contextSlot.slot.tupleItems !== true) &&
        lookup.blocked()
      ) {
        throw new AmbiguousSlotInvocationError(partial);
      }
      return slotInputsForRender
        .map((slotInput) => {
          const slot = selectedSlot(group.slots, slotInput);
          const child = slot.template;
          return renderResolvedTemplate(
            {
              template: child,
              input: unwrapArrayTemplateInput(
                slotInput,
                slot.slot.property,
                child.facet.inputSchema,
              ),
            },
            nextStack,
          );
        })
        .join("");
    };
    handlebars.registerPartial(partial, renderSlot);
  }

  const compiled = handlebars.compile(template.facet.source, {
    noEscape: true,
    strict: false,
  });
  return compiled(input);
}

function resolvePath(source: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(source, key) ? source[key] : undefined;
}

export class MissingValueError extends Error {
  constructor(path: string) {
    super(`missing required value "{{values.${path}}}"`);
    this.name = "MissingValueError";
  }
}

export class InvalidValueReferenceError extends Error {
  constructor(reference: string, expression = `values.${reference}`) {
    super(
      `invalid values reference "{{${expression}}}"; value names must match [A-Za-z_$][A-Za-z0-9_$-]*`,
    );
    this.name = "InvalidValueReferenceError";
  }
}

export class ValueReferenceCollisionError extends Error {
  readonly path: (string | number)[];

  constructor(key: string, path: (string | number)[] = []) {
    super(`interpolated object keys collide at "${key}"`);
    this.name = "ValueReferenceCollisionError";
    this.path = path;
  }
}

export class NonStringValueError extends Error {
  constructor(path: string, resolved: unknown) {
    super(
      `{{values.${path}}} resolved to a non-string value (${typeof resolved}); values must be strings (SPECIFICATION.md, Configuration Document)`,
    );
    this.name = "NonStringValueError";
  }
}

export class AmbiguousSlotInvocationError extends Error {
  constructor(partial: string) {
    super(
      `array-valued slot partial "{{> ${partial}}}" resolved to no input although data exists along its path; the invocation is ambiguous — pass the slot value explicitly: {{> ${partial} value}}`,
    );
    this.name = "AmbiguousSlotInvocationError";
  }
}

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

export function interpolateValues<T>(
  input: T,
  values: Record<string, unknown>,
  path: (string | number)[] = [],
): T {
  if (typeof input === "string") return renderString(input, values) as T;

  if (Array.isArray(input)) {
    const output = input.map((item, index) =>
      interpolateValues(item, values, [...path, index]),
    ) as T;
    return copyResourceTemplateSelection(input, output);
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
    return copyResourceTemplateSelection(input, output as T);
  }

  return input;
}
