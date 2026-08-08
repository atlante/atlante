/**
 * Resolver-owned template selection is kept outside the JSON value surface.
 * A symbol makes the metadata available to the renderer without exposing it
 * to JSON serialization, Handlebars enumeration, or template input fields.
 */
const RESOURCE_TEMPLATE_SELECTION = Symbol(
  "atlante.resource.template-selection",
);

const resolverSelections = new WeakSet<object>();
const resolverSelectedValues = new WeakSet<object>();

export type ResourceTemplateSelection = Readonly<{
  readonly templateId: string;
}>;

function isAttachable(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isSelectionRecord(value: unknown): value is ResourceTemplateSelection {
  if (!isAttachable(value) || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (!resolverSelections.has(value)) return false;

  const descriptor = Object.getOwnPropertyDescriptor(value, "templateId");
  return (
    descriptor !== undefined &&
    "value" in descriptor &&
    typeof descriptor.value === "string"
  );
}

export function withResourceTemplateSelection<T>(
  value: T,
  templateId: string,
): T {
  if (!isAttachable(value)) return value;
  const selection = Object.freeze({ templateId });
  resolverSelections.add(selection);
  Object.defineProperty(value, RESOURCE_TEMPLATE_SELECTION, {
    configurable: true,
    enumerable: false,
    value: selection,
    writable: false,
  });
  resolverSelectedValues.add(value);
  return value;
}

/** Copies only resolver-owned template selection metadata to a cloned value. */
export function copyResourceTemplateSelection<T>(
  source: unknown,
  target: T,
): T {
  const selection = resourceTemplateSelection(source);
  return selection
    ? withResourceTemplateSelection(target, selection.templateId)
    : target;
}

export function resourceTemplateSelection(
  value: unknown,
): ResourceTemplateSelection | undefined {
  if (!isAttachable(value)) return undefined;
  if (!resolverSelectedValues.has(value)) return undefined;
  const marker = Object.getOwnPropertyDescriptor(
    value,
    RESOURCE_TEMPLATE_SELECTION,
  );
  if (!marker || !("value" in marker)) return undefined;
  return isSelectionRecord(marker.value) ? marker.value : undefined;
}
