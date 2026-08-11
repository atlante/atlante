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

function slotInputs(
  input: unknown,
  path: string[],
  arrayItems: boolean,
): unknown[] {
  if (Array.isArray(input))
    return arrayItems ? arraySlotInputs(input, path) : [];
  if (path.length === 0) return presentSlotInput(input);
  return descendSlotPath(input, path, arrayItems);
}

function arraySlotInputs(input: unknown[], path: string[]): unknown[] {
  return input.flatMap((item) => slotInputs(item, path, true));
}

function presentSlotInput(input: unknown): unknown[] {
  return input === null || input === undefined ? [] : [input];
}

function descendSlotPath(
  input: unknown,
  path: string[],
  arrayItems: boolean,
): unknown[] {
  if (typeof input !== "object" || input === null) return [];
  const segment = path[0];
  if (segment === undefined) return [];
  if (!Object.hasOwn(input, segment)) return [];
  return slotInputs(
    (input as Record<string, unknown>)[segment],
    path.slice(1),
    arrayItems,
  );
}

function arrayItemPath(input: unknown, path: string[]): string[] | undefined {
  let current = input;
  let lastArrayPathIndex = -1;
  for (let index = 0; index <= path.length; index++) {
    if (Array.isArray(current)) {
      lastArrayPathIndex = index;
      current = current[0];
    }
    if (index === path.length)
      return lastArrayPathIndex < 0
        ? undefined
        : path.slice(lastArrayPathIndex);
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[path[index] ?? ""];
  }
  return undefined;
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
    "anyPolicy",
    (policies: unknown, phases: unknown) => {
      const hasWorkflowPolicy =
        typeof policies === "object" &&
        policies !== null &&
        Object.values(policies).some(Boolean);
      const hasPhasePolicy =
        Array.isArray(phases) &&
        phases.some((phase) => {
          if (typeof phase !== "object" || phase === null) return false;
          const phasePolicies = (phase as Record<string, unknown>).policies;
          return (
            typeof phasePolicies === "object" &&
            phasePolicies !== null &&
            Object.values(phasePolicies).some(Boolean)
          );
        });
      return hasWorkflowPolicy || hasPhasePolicy;
    },
  );
  const nextStack = [...stack, template.key];
  const slots = template.slots;

  for (const group of groupSlots(slots)) {
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

      const contextPath =
        contextSlot.slot.arrayItems && context !== input
          ? arrayItemPath(input, group.path)
          : undefined;
      const slotInputsForRender = contextPath
        ? slotInputs(context, contextPath, false)
        : slotInputs(input, group.path, contextSlot.slot.arrayItems ?? false);
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
    handlebars.registerPartial(
      slotPartialName(
        (group.path.length ? group.path : [group.slots[0]?.slot.property]).join(
          "/",
        ),
      ),
      renderSlot,
    );
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
      `{{values.${path}}} resolved to a non-string value (${typeof resolved}); values must be strings (SPECIFICATION.md §4.2)`,
    );
    this.name = "NonStringValueError";
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
