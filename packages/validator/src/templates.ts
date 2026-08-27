import type {
  ResolvedResourceBinding,
  ResolvedResourceDocument,
  ResolvedTemplate,
  ResourceOrigin,
} from "@atlante/resources";
import {
  InvalidValueReferenceError,
  interpolateValues,
  isCompositionMarker,
  isValidValueKey,
  jsonValueAtPath,
  MAX_REFERENCE_HOPS,
  MissingValueError,
  NonStringValueError,
  parseResourceLocator,
  resolveSystemValues,
  resourceTemplateSelection,
  resourceValueTombstones,
  UnknownSystemVariableError,
  ValueReferenceCollisionError,
  walkValueReferences,
  withResourceTemplateSelection,
} from "@atlante/resources";
import type { ErrorObject } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { Diagnostic } from "./diagnostic.js";
import {
  error,
  escapeJsonPointerSegment,
  sortDiagnostics,
} from "./diagnostic.js";
import { decorateResourceDiagnostic } from "./diagnostic-decoration.js";

function unescapeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type SchemaContainer = Record<string, unknown> | unknown[];
type SchemaLocation = { parent: SchemaContainer; key: string };

type ResolvedSchemaContext = Readonly<{
  readonly inputPath: readonly string[];
  readonly schemaPath: readonly string[];
  readonly template: ResolvedTemplate;
}>;

type ExpandedResolvedSchema = Readonly<{
  readonly schema?: Record<string, unknown>;
  readonly diagnostics: Diagnostic[];
  readonly contexts: readonly ResolvedSchemaContext[];
}>;

const MISSING_SCHEMA_CHILD = Symbol("missing schema child");

function isSchemaContainer(value: unknown): value is SchemaContainer {
  return isRecord(value) || Array.isArray(value);
}

function schemaChild(
  current: SchemaContainer,
  segment: string,
): unknown | typeof MISSING_SCHEMA_CHILD {
  if (isRecord(current)) {
    if (
      isRecord(current.properties) &&
      Object.hasOwn(current.properties, segment)
    )
      return current.properties[segment];
    if (Array.isArray(current) && /^\d+$/.test(segment))
      return current[Number(segment)];
    if (Object.hasOwn(current, segment)) return current[segment];
  }
  return MISSING_SCHEMA_CHILD;
}

function schemaLocation(
  schema: Record<string, unknown>,
  path: string[],
): SchemaLocation | undefined {
  let current: unknown = schema;
  let location: SchemaLocation | undefined;

  for (const segment of path) {
    if (!isSchemaContainer(current)) return undefined;
    const child = schemaChild(current, segment);
    if (child === MISSING_SCHEMA_CHILD) return undefined;
    location = { parent: current, key: segment };
    current = child;
  }
  return location;
}

function defineSchemaValue(
  target: Record<string, unknown>,
  key: string,
  value: Record<string, unknown>,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function replaceSchemaValue(
  parent: SchemaContainer,
  key: string,
  value: Record<string, unknown>,
): void {
  if (Array.isArray(parent)) {
    parent[Number(key)] = value;
    return;
  }
  const properties = parent.properties;
  const target =
    isRecord(properties) && Object.hasOwn(properties, key)
      ? properties
      : parent;
  defineSchemaValue(target, key, value);
}

function setSchemaPath(
  schema: Record<string, unknown>,
  path: string[],
  value: Record<string, unknown>,
): void {
  const location = schemaLocation(schema, path);
  if (location) replaceSchemaValue(location.parent, location.key, value);
}

function schemaPathForInputPath(
  schema: Record<string, unknown>,
  path: readonly string[],
): string[] {
  let current: unknown = schema;
  const schemaPath: string[] = [];

  for (const segment of path) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      schemaPath.push(segment);
      current = current[Number(segment)];
      continue;
    }
    if (!isRecord(current)) break;

    if (
      isRecord(current.properties) &&
      Object.hasOwn(current.properties, segment)
    ) {
      schemaPath.push("properties", segment);
      current = current.properties[segment];
      continue;
    }
    if (!Object.hasOwn(current, segment)) break;
    schemaPath.push(segment);
    current = current[segment];
  }

  return schemaPath;
}

function bindingPath(
  root: "agents" | "skills",
  bindingId: string,
  segments: (string | number)[] = [],
): string {
  return `/${root}/${escapeJsonPointerSegment(bindingId)}${segments
    .map((segment) => `/${escapeJsonPointerSegment(String(segment))}`)
    .join("")}`;
}

function issueProperty(
  issue: ErrorObject,
  key: "additionalProperty" | "missingProperty",
): string | undefined {
  return issue.params && key in issue.params
    ? String(issue.params[key])
    : undefined;
}

function issueMessageSuffix(issue: ErrorObject): string {
  return [
    issueProperty(issue, "additionalProperty"),
    issueProperty(issue, "missingProperty"),
  ]
    .filter((property): property is string => property !== undefined)
    .map((property) => ` (${property})`)
    .join("");
}

function issuePathSuffix(issue: ErrorObject): string {
  const property =
    issueProperty(issue, "missingProperty") ??
    issueProperty(issue, "additionalProperty");
  return property === undefined ? "" : `/${escapeJsonPointerSegment(property)}`;
}

function promptResourceLocation(
  context: ResolvedSchemaContext | undefined,
): Partial<Pick<Diagnostic, "source" | "location">> {
  if (!context || context.inputPath.length === 0) return {};
  const extra: Partial<Pick<Diagnostic, "source" | "location">> = {};
  if (context.template.origin.path)
    extra.source = String(context.template.origin.path);
  if (context.template.locations?.[""])
    extra.location = context.template.locations[""];
  return extra;
}

function invalidPromptDiagnostic(
  subject: "agent" | "skill",
  bindingId: string,
  root: "agents" | "skills",
  issue: ErrorObject,
  context?: ResolvedSchemaContext,
): Diagnostic {
  return error(
    "invalid-prompt-input",
    `${subject} "${bindingId}": ${issue.instancePath || "<root>"} ${issue.message ?? "is invalid"}${issueMessageSuffix(issue)}`,
    {
      path: `${bindingPath(root, bindingId)}${issue.instancePath}${issuePathSuffix(issue)}`,
      ...promptResourceLocation(context),
    },
  );
}

function pointerSegments(pointer: string): string[] {
  if (pointer === "") return [];
  return pointer.slice(1).split("/").map(unescapeJsonPointerSegment);
}

function pathStartsWith(
  path: readonly string[],
  prefix: readonly string[],
): boolean {
  let pathIndex = 0;
  for (const segment of prefix) {
    while (
      pathIndex < path.length &&
      path[pathIndex] !== segment &&
      /^\d+$/.test(path[pathIndex] ?? "")
    )
      pathIndex++;
    if (path[pathIndex] !== segment) return false;
    pathIndex++;
  }
  return true;
}

function schemaPathStartsWith(
  path: readonly string[],
  prefix: readonly string[],
): boolean {
  return prefix.every((segment, index) => path[index] === segment);
}

function schemaContextForIssue(
  issue: ErrorObject,
  contexts: readonly ResolvedSchemaContext[],
): ResolvedSchemaContext | undefined {
  const instancePath = pointerSegments(issue.instancePath);
  const schemaPath = pointerSegments(
    issue.schemaPath.startsWith("#")
      ? issue.schemaPath.slice(1)
      : issue.schemaPath,
  );
  return [...contexts]
    .sort(
      (left, right) =>
        right.inputPath.length - left.inputPath.length ||
        right.schemaPath.length - left.schemaPath.length,
    )
    .find(
      (context) =>
        pathStartsWith(instancePath, context.inputPath) &&
        schemaPathStartsWith(schemaPath, context.schemaPath),
    );
}

function validateInputSchema(
  schema: Record<string, unknown>,
  templateId: string,
  input: Record<string, unknown>,
  bindingId: string,
  root: "agents" | "skills",
  subject: "agent" | "skill",
  contexts: readonly ResolvedSchemaContext[] = [],
): Diagnostic[] {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  let validate: ReturnType<typeof ajv.compile>;
  try {
    validate = ajv.compile(schema);
  } catch {
    // A structurally invalid inputSchema (SPECIFICATION.md, Validation) must be
    // rejected as a diagnostic, not surfaced as Ajv's uncaught compile error.
    return [
      error(
        "invalid-input-schema",
        `${subject} "${bindingId}" template "${templateId}": inputSchema is invalid; expected a valid JSON Schema Draft 2020-12 object`,
        { path: bindingPath(root, bindingId) },
      ),
    ];
  }
  if (validate(input)) return [];

  const inputDiagnostics: Diagnostic[] = [];
  for (const issue of validate.errors ?? [])
    inputDiagnostics.push(
      invalidPromptDiagnostic(
        subject,
        bindingId,
        root,
        issue,
        schemaContextForIssue(issue, contexts),
      ),
    );
  return inputDiagnostics;
}

function expandResolvedTemplateSchema(
  template: ResolvedTemplate,
  stack: readonly string[] = [],
  inputPath: readonly string[] = [],
  schemaPath: readonly string[] = [],
): ExpandedResolvedSchema {
  const context: ResolvedSchemaContext = {
    inputPath: [...inputPath],
    schemaPath: [...schemaPath],
    template,
  };
  if (stack.includes(template.key)) {
    const chain = [...stack, template.key];
    return {
      diagnostics: [
        error(
          "cyclic-template",
          `circular template composition: ${chain.join(" -> ")}`,
        ),
      ],
      contexts: [context],
    };
  }

  const schema = structuredClone(template.facet.inputSchema) as Record<
    string,
    unknown
  >;
  const schemaValidation = schemaCompilationDiagnostic(template, inputPath);
  if (schemaValidation)
    return { diagnostics: [schemaValidation], contexts: [context] };
  const invalidMarkers = invalidTemplateMarkers(
    schema,
    template,
    [],
    inputPath,
  );
  if (invalidMarkers.length > 0)
    return { diagnostics: invalidMarkers, contexts: [context] };
  const contexts: ResolvedSchemaContext[] = [context];
  for (const slot of template.slots) {
    const slotPath = slot.slot.path ?? [slot.slot.property];
    const childSchemaPath = [
      ...schemaPath,
      ...schemaPathForInputPath(schema, slotPath),
    ];
    const expanded = expandResolvedTemplateSchema(
      slot.template,
      [...stack, template.key],
      [...inputPath, ...(slot.slot.dataPath ?? [slot.slot.property])],
      childSchemaPath,
    );
    contexts.push(...expanded.contexts);
    if (!expanded.schema) return { ...expanded, contexts };
    setSchemaPath(schema, slotPath, expanded.schema);
  }

  if (stack.length > 0) delete schema.$schema;
  return { schema, diagnostics: [], contexts };
}

function schemaCompilationDiagnostic(
  template: ResolvedTemplate,
  inputPath: readonly string[],
): Diagnostic | undefined {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  try {
    ajv.compile(template.facet.inputSchema);
    return undefined;
  } catch {
    return error(
      "invalid-input-schema",
      `template "${template.key}": inputSchema is invalid; expected a valid JSON Schema Draft 2020-12 object`,
      {
        path: `/${inputPath.map(escapeJsonPointerSegment).join("/")}`,
        source: String(template.origin.path),
        location: template.locations?.[""],
      },
    );
  }
}

function validTemplateMarker(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = parseResourceLocator(value);
    return parsed.kind === "local" || parsed.subpath !== undefined;
  } catch {
    return false;
  }
}

function invalidTemplateMarker(
  value: Record<string, unknown>,
  template: ResolvedTemplate,
  schemaPath: readonly string[],
  inputPath: readonly string[],
  dataPath: readonly string[],
): Diagnostic | undefined {
  if (!isCompositionMarker(value) || validTemplateMarker(value.template))
    return undefined;

  const fullInputPath = [...inputPath, ...dataPath];
  const pointer = fullInputPath.length
    ? `/${fullInputPath.map(escapeJsonPointerSegment).join("/")}`
    : "";
  const schemaPointer = `/${schemaPath.map(escapeJsonPointerSegment).join("/")}`;
  return error(
    "invalid-input-schema",
    `template "${template.key}": invalid template marker; expected a package locator or relative locator`,
    {
      path: pointer,
      source: String(template.origin.path),
      location: template.locations?.[schemaPointer] ?? template.locations?.[""],
    },
  );
}

function invalidTemplateMarkers(
  value: unknown,
  template: ResolvedTemplate,
  path: readonly string[],
  inputPath: readonly string[],
  dataPath: readonly string[] = [],
): Diagnostic[] {
  if (Array.isArray(value))
    return value.flatMap((child, index) =>
      invalidTemplateMarkers(
        child,
        template,
        [...path, String(index)],
        inputPath,
        dataPath,
      ),
    );
  if (!isRecord(value)) return [];

  const diagnostic =
    path.at(-1) === "properties"
      ? undefined
      : invalidTemplateMarker(value, template, path, inputPath, dataPath);
  if (diagnostic) return [diagnostic];
  return Object.entries(value).flatMap(([key, child]) =>
    invalidTemplateMarkers(
      child,
      template,
      [...path, key],
      inputPath,
      path.at(-1) === "properties" ? [...dataPath, key] : dataPath,
    ),
  );
}

type SelectionInputContext = Readonly<{
  readonly schema: unknown;
  readonly value: unknown;
  readonly path: readonly string[];
  readonly tupleItems: boolean;
}>;

function schemaNodeAtPath(
  schema: Record<string, unknown>,
  path: readonly string[],
): unknown {
  return jsonValueAtPath(schema, path, schemaObjectValue);
}

function schemaObjectValue(
  current: Record<string, unknown>,
  segment: string,
): unknown {
  if (
    isRecord(current.properties) &&
    Object.hasOwn(current.properties, segment)
  )
    return current.properties[segment];
  return Object.hasOwn(current, segment) ? current[segment] : undefined;
}

function inputContextsAtArray(
  context: SelectionInputContext,
  segment: string,
): SelectionInputContext[] {
  if (!/^\d+$/.test(segment)) return [];
  const child = (context.schema as unknown[])[Number(segment)];
  if (child === undefined) return [];
  return [
    {
      schema: child,
      value: context.value,
      path: context.tupleItems ? [...context.path, segment] : context.path,
      tupleItems: false,
    },
  ];
}

function inputContextsAtProperty(
  context: SelectionInputContext,
  segment: string,
): SelectionInputContext[] | undefined {
  const properties = (context.schema as Record<string, unknown>).properties;
  if (!isRecord(properties) || !Object.hasOwn(properties, segment))
    return undefined;
  const value =
    isRecord(context.value) && Object.hasOwn(context.value, segment)
      ? context.value[segment]
      : undefined;
  return [
    {
      schema: properties[segment],
      value,
      path: [...context.path, segment],
      tupleItems: false,
    },
  ];
}

function inputContextsAtSchemaMember(
  context: SelectionInputContext,
  segment: string,
): SelectionInputContext[] {
  const schema = context.schema as Record<string, unknown>;
  if (!Object.hasOwn(schema, segment)) return [];
  const child = schema[segment];
  if (segment !== "items") {
    return [
      {
        schema: child,
        value: context.value,
        path: context.path,
        tupleItems: false,
      },
    ];
  }
  if (Array.isArray(child))
    return [
      {
        schema: child,
        value: context.value,
        path: context.path,
        tupleItems: true,
      },
    ];
  if (Array.isArray(context.value))
    return context.value.map((value, index) => ({
      schema: child,
      value,
      path: [...context.path, String(index)],
      tupleItems: false,
    }));
  return [
    {
      schema: child,
      value: undefined,
      path: context.path,
      tupleItems: false,
    },
  ];
}

function inputContextsAtSegment(
  context: SelectionInputContext,
  segment: string,
): SelectionInputContext[] {
  if (Array.isArray(context.schema))
    return inputContextsAtArray(context, segment);
  if (!isRecord(context.schema)) return [];
  return (
    inputContextsAtProperty(context, segment) ??
    inputContextsAtSchemaMember(context, segment)
  );
}

function inputContextsAtSchemaPath(
  input: unknown,
  schema: Record<string, unknown>,
  path: readonly string[],
): SelectionInputContext[] {
  let contexts: SelectionInputContext[] = [
    { schema, value: input, path: [], tupleItems: false },
  ];

  for (const segment of path) {
    contexts = contexts.flatMap((context) =>
      inputContextsAtSegment(context, segment),
    );
  }

  return contexts;
}

type SchemaDataPathStep = Readonly<{
  readonly value: unknown;
  readonly includeSegment: boolean;
  readonly tupleItems: boolean;
}>;

function schemaDataPathStep(
  current: unknown,
  segment: string,
  tupleItems: boolean,
): SchemaDataPathStep | undefined {
  if (Array.isArray(current)) {
    if (!/^\d+$/.test(segment)) return undefined;
    return {
      value: current[Number(segment)],
      includeSegment: tupleItems,
      tupleItems: false,
    };
  }
  if (!isRecord(current)) return undefined;
  if (
    isRecord(current.properties) &&
    Object.hasOwn(current.properties, segment)
  ) {
    return {
      value: current.properties[segment],
      includeSegment: true,
      tupleItems: false,
    };
  }
  if (!Object.hasOwn(current, segment)) return undefined;
  const value = current[segment];
  return {
    value,
    includeSegment: false,
    tupleItems: segment === "items" && Array.isArray(value),
  };
}

function schemaDataPath(
  schema: Record<string, unknown>,
  path: readonly string[],
): string[] {
  let current: unknown = schema;
  let tupleItems = false;
  const dataPath: string[] = [];
  for (const segment of path) {
    const step = schemaDataPathStep(current, segment, tupleItems);
    if (!step) break;
    if (step.includeSegment) dataPath.push(segment);
    current = step.value;
    tupleItems = step.tupleItems;
  }
  return dataPath;
}

function compositionBranchPath(
  path: readonly string[],
): readonly string[] | undefined {
  let branch: readonly string[] | undefined;
  // Stryker disable next-line UpdateOperator -- exact mutant: index++ -> index--; this scan must advance toward termination.
  for (let index = 0; index + 1 < path.length; index++) {
    const keyword = path[index];
    if (
      (keyword === "oneOf" || keyword === "anyOf" || keyword === "allOf") &&
      /^\d+$/.test(path[index + 1] ?? "")
    )
      branch = path.slice(0, index + 2);
  }
  return branch;
}

function concreteValueAtPath(input: unknown, path: readonly string[]): unknown {
  return jsonValueAtPath(input, path);
}

function copyTemplateSelectionChildren(source: unknown, target: unknown): void {
  if (Array.isArray(source)) {
    if (!Array.isArray(target)) return;
    for (const [index, child] of source.entries())
      copyTemplateSelections(child, target[index]);
    return;
  }
  if (Array.isArray(target)) return;
  const sourceRecord = source as Record<string, unknown>;
  const targetRecord = target as Record<string, unknown>;
  for (const key of Object.keys(sourceRecord))
    if (Object.hasOwn(targetRecord, key))
      copyTemplateSelections(sourceRecord[key], targetRecord[key]);
}

function copyTemplateSelections(source: unknown, target: unknown): void {
  if (!isRecord(source) || !isRecord(target)) return;
  const selection = resourceTemplateSelection(source);
  if (selection) withResourceTemplateSelection(target, selection.templateId);
  copyTemplateSelectionChildren(source, target);
}

function resolvedSlotGroups(
  template: ResolvedTemplate,
): readonly (readonly ResolvedTemplate["slots"][number][])[] {
  const groups = new Map<string, ResolvedTemplate["slots"][number][]>();
  for (const resolvedSlot of template.slots) {
    const { slot } = resolvedSlot;
    const path = slot.dataPath ?? [slot.property];
    const key = JSON.stringify(path);
    const group = groups.get(key);
    if (group) group.push(resolvedSlot);
    else groups.set(key, [resolvedSlot]);
  }
  return [...groups.values()];
}

type InlineSelectionCandidate = Readonly<{
  readonly resolvedSlot: ResolvedTemplate["slots"][number];
  readonly branchPath: readonly string[];
  readonly branchDataPath: readonly string[];
  readonly matches: (value: unknown) => boolean;
}>;

type InlineSelectionCandidateTarget = InlineSelectionCandidate &
  Readonly<{ target: unknown }>;

function childSchemaForSlot(
  schema: Record<string, unknown>,
  resolvedSlot: ResolvedTemplate["slots"][number],
): Record<string, unknown> | undefined {
  const slot = resolvedSlot.slot;
  const childSchema = schemaNodeAtPath(schema, slot.path ?? [slot.property]);
  return isRecord(childSchema) ? childSchema : undefined;
}

function applyInlineTemplateSelectionsToChild(
  resolvedSlot: ResolvedTemplate["slots"][number],
  schema: Record<string, unknown>,
  input: unknown,
  stack: readonly string[],
): void {
  const childSchema = childSchemaForSlot(schema, resolvedSlot);
  if (!childSchema) return;
  applyInlineTemplateSelections(
    resolvedSlot.template,
    childSchema,
    input,
    stack,
  );
}

function recurseThroughSingleInlineSlot(
  resolvedSlot: ResolvedTemplate["slots"][number],
  schema: Record<string, unknown>,
  input: unknown,
  stack: readonly string[],
): void {
  const slot = resolvedSlot.slot;
  const childSchema = childSchemaForSlot(schema, resolvedSlot);
  if (!childSchema) return;
  const contexts = inputContextsAtSchemaPath(
    input,
    schema,
    slot.path ?? [slot.property],
  );
  for (const context of contexts) {
    if (context.value === undefined || context.value === null) continue;
    applyInlineTemplateSelections(
      resolvedSlot.template,
      childSchema,
      context.value,
      stack,
    );
  }
}

function inlineBranchCandidates(
  group: readonly ResolvedTemplate["slots"][number][],
  schema: Record<string, unknown>,
  ajv: Ajv2020,
): InlineSelectionCandidate[] {
  return group.flatMap((resolvedSlot) => {
    const branchPath = compositionBranchPath(resolvedSlot.slot.path ?? []);
    if (!branchPath) return [];
    const branchSchema = schemaNodeAtPath(schema, branchPath);
    if (branchSchema === undefined) return [];
    try {
      return [
        {
          resolvedSlot,
          branchPath,
          branchDataPath: schemaDataPath(schema, branchPath),
          matches: ajv.compile(branchSchema as never),
        },
      ];
    } catch {
      return [];
    }
  });
}

function inlineCandidateTarget(
  input: unknown,
  context: SelectionInputContext,
  candidate: InlineSelectionCandidate,
): unknown {
  const dataPath = candidate.resolvedSlot.slot.dataPath ?? [
    candidate.resolvedSlot.slot.property,
  ];
  if (!schemaPathStartsWith(dataPath, candidate.branchDataPath))
    return undefined;
  return concreteValueAtPath(input, [
    ...context.path,
    ...dataPath.slice(candidate.branchDataPath.length),
  ]);
}

function selectedInlineCandidate(
  candidates: readonly InlineSelectionCandidate[],
  input: unknown,
  context: SelectionInputContext,
): InlineSelectionCandidateTarget | undefined {
  const candidateTargets = candidates.map((candidate) => ({
    ...candidate,
    target: inlineCandidateTarget(input, context, candidate),
  }));
  const configured = candidateTargets.find(
    ({ resolvedSlot, target }) =>
      resourceTemplateSelection(target)?.templateId ===
      resolvedSlot.slot.templateId,
  );
  if (configured) return configured;
  return candidateTargets
    .filter(({ matches }) => matches(context.value))
    .sort((left, right) =>
      left.resolvedSlot.slot.templateId.localeCompare(
        right.resolvedSlot.slot.templateId,
      ),
    )[0];
}

function applySelectedInlineCandidate(
  selected: InlineSelectionCandidateTarget,
  schema: Record<string, unknown>,
  stack: readonly string[],
): void {
  if (selected.target === undefined || selected.target === null) return;
  withResourceTemplateSelection(
    selected.target,
    selected.resolvedSlot.slot.templateId,
  );
  applyInlineTemplateSelectionsToChild(
    selected.resolvedSlot,
    schema,
    selected.target,
    stack,
  );
}

function applyInlineBranchSelections(
  group: readonly ResolvedTemplate["slots"][number][],
  schema: Record<string, unknown>,
  input: unknown,
  ajv: Ajv2020,
  stack: readonly string[],
): void {
  const candidates = inlineBranchCandidates(group, schema, ajv);
  if (candidates.length < 2) return;
  const branchPath = candidates[0]?.branchPath;
  if (!branchPath) return;
  const contexts = inputContextsAtSchemaPath(input, schema, branchPath);
  for (const context of contexts) {
    const selected = selectedInlineCandidate(candidates, input, context);
    if (selected) applySelectedInlineCandidate(selected, schema, stack);
  }
}

/** Annotates only branches that have already passed semantic validation. */
function applyInlineTemplateSelections(
  template: ResolvedTemplate,
  schema: Record<string, unknown>,
  input: unknown,
  stack: readonly string[] = [],
): void {
  if (stack.includes(template.key) || stack.length >= MAX_REFERENCE_HOPS)
    return;

  const nextStack = [...stack, template.key];
  const ajv = new Ajv2020({ allErrors: false, strict: false });
  for (const group of resolvedSlotGroups(template)) {
    if (group.length < 2) {
      const resolvedSlot = group[0];
      if (!resolvedSlot) continue;
      recurseThroughSingleInlineSlot(resolvedSlot, schema, input, nextStack);
      continue;
    }
    applyInlineBranchSelections(group, schema, input, ajv, nextStack);
  }
}

function validateResolvedBindingInput(
  template: ResolvedTemplate,
  input: Record<string, unknown>,
  bindingId: string,
  root: "agents" | "skills",
  subject: "agent" | "skill",
  selectionTarget?: Record<string, unknown>,
): Diagnostic[] {
  const expanded = expandResolvedTemplateSchema(template);
  if (!expanded.schema) {
    return expanded.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      path: `${bindingPath(root, bindingId)}${diagnostic.path ?? ""}`,
      pointer: `${bindingPath(root, bindingId)}${diagnostic.path ?? ""}`,
    }));
  }
  const inputDiagnostics = validateInputSchema(
    expanded.schema,
    template.key,
    input,
    bindingId,
    root,
    subject,
    expanded.contexts,
  );
  if (inputDiagnostics.length === 0) {
    applyInlineTemplateSelections(template, expanded.schema, input);
    if (selectionTarget && selectionTarget !== input)
      copyTemplateSelections(input, selectionTarget);
  }
  return inputDiagnostics;
}

function resolvedValue(values: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(values, key) ? values[key] : undefined;
}

function missingValueDiagnostics(
  input: unknown,
  values: Record<string, unknown>,
  bindingId: string,
  templateId: string,
  root: "agents" | "skills",
  subject: "agent" | "skill",
  pathPrefix: (string | number)[] = [],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  walkValueReferences(input, (reference, segments) => {
    const path = bindingPath(root, bindingId, [...pathPrefix, ...segments]);
    if (!reference.key || !isValidValueKey(reference.key)) {
      diagnostics.push(
        error(
          "invalid-value-reference",
          `${subject} "${bindingId}" template "${templateId}": invalid values reference "{{${reference.expression}}}"; value names must match [A-Za-z_$][A-Za-z0-9_$-]*`,
          { path },
        ),
      );
    } else if (resolvedValue(values, reference.key) == null) {
      diagnostics.push(
        error(
          "missing-value",
          `${subject} "${bindingId}" template "${templateId}": missing required value "{{values.${reference.key}}}"`,
          { path },
        ),
      );
    }
  });
  return diagnostics;
}

type BindingSubject = "agent" | "skill";

function invalidDescriptionDiagnostic(
  subject: BindingSubject,
  bindingId: string,
  templateId: string,
  root: "agents" | "skills",
): Diagnostic {
  return error(
    `invalid-${subject}-description`,
    `${subject} "${bindingId}" template "${templateId}": description must be a non-empty string`,
    { path: bindingPath(root, bindingId, ["description"]) },
  );
}

function bindingDescriptionValidation(
  description: unknown,
  values: Record<string, unknown>,
  bindingId: string,
  templateId: string,
  root: "agents" | "skills",
  subject: BindingSubject,
): Diagnostic[] {
  if (typeof description !== "string") {
    return [invalidDescriptionDiagnostic(subject, bindingId, templateId, root)];
  }

  const descriptionValueDiagnostics = missingValueDiagnostics(
    description,
    values,
    bindingId,
    templateId,
    root,
    subject,
    ["description"],
  );
  if (descriptionValueDiagnostics.length > 0)
    return descriptionValueDiagnostics;

  let interpolatedDescription = description;
  try {
    interpolatedDescription = interpolateValues(description, values) as string;
  } catch {
    return [];
  }
  if (interpolatedDescription.length !== 0) return [];

  return [invalidDescriptionDiagnostic(subject, bindingId, templateId, root)];
}

function rootOrigin(
  resources: ResolvedResourceDocument,
): ResourceOrigin | undefined {
  return resources.graph.nodes[0]?.origin;
}

function originPath(origin: ResourceOrigin | undefined): string | undefined {
  return origin?.path as string | undefined;
}

function unknownSystemValueDiagnostics(
  resources: ResolvedResourceDocument,
): Diagnostic[] {
  const values = resources.document.values;
  if (!values) return [];

  const diagnostics: Diagnostic[] = [];
  for (const key of Object.keys(values).sort()) {
    const value = values[key];
    if (typeof value !== "string") continue;

    const candidate: Record<string, unknown> = {};
    Object.defineProperty(candidate, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
    try {
      resolveSystemValues(candidate);
    } catch (cause) {
      if (!(cause instanceof UnknownSystemVariableError)) throw cause;
      const path = `/values/${escapeJsonPointerSegment(key)}`;
      const origin = resources.provenance[path] ?? rootOrigin(resources);
      diagnostics.push(
        error("unknown-system-variable", `value "${key}": ${cause.message}`, {
          path,
          pointer: path,
          ...(origin ? { source: originPath(origin) } : {}),
        }),
      );
    }
  }
  return diagnostics;
}

function valueFailureDiagnostic(
  cause: unknown,
  subject: "agent" | "skill",
  bindingId: string,
  templateId: string,
  root: "agents" | "skills",
): Diagnostic | undefined {
  const path = bindingPath(root, bindingId);
  if (cause instanceof MissingValueError)
    return error(
      "missing-value",
      `${subject} "${bindingId}" template "${templateId}": ${cause.message}`,
      { path },
    );
  if (cause instanceof InvalidValueReferenceError)
    return error(
      "invalid-value-reference",
      `${subject} "${bindingId}" template "${templateId}": ${cause.message}`,
      { path },
    );
  if (cause instanceof NonStringValueError)
    return error(
      "non-string-value",
      `${subject} "${bindingId}" template "${templateId}": ${cause.message}`,
      { path },
    );
  return undefined;
}

function bindingValueDiagnostics(
  values: Record<string, unknown> | undefined,
  subject: "agent" | "skill",
  bindingId: string,
  templateId: string,
  root: "agents" | "skills",
): Diagnostic[] {
  if (!values) return [];

  const diagnostics: Diagnostic[] = [];
  for (const key of Object.keys(values).sort()) {
    const path = bindingPath(root, bindingId, ["values", key]);
    if (!isValidValueKey(key)) {
      diagnostics.push(
        error(
          "invalid-value-reference",
          `${subject} "${bindingId}" template "${templateId}": invalid binding value name ${JSON.stringify(key)}; value names must match [A-Za-z_$][A-Za-z0-9_$-]*`,
          { path },
        ),
      );
      continue;
    }
    if (typeof values[key] !== "string")
      diagnostics.push(
        error(
          "non-string-value",
          `${subject} "${bindingId}" template "${templateId}": binding value "${key}" must be a string (SPECIFICATION.md, Configuration Document)`,
          { path },
        ),
      );
  }
  return diagnostics;
}

function resolvedBindingValues(
  resources: ResolvedResourceDocument,
  binding: ResolvedResourceBinding,
  subject: "agent" | "skill",
  root: "agents" | "skills",
  templateId: string,
): Record<string, unknown> | Diagnostic[] {
  const rawDocument = resources.document as Record<string, unknown>;
  const valuesInput: Record<string, unknown> = {
    ...((rawDocument.values as Record<string, unknown> | undefined) ?? {}),
    ...((binding.values as Record<string, unknown> | undefined) ?? {}),
  };
  for (const pointer of resourceValueTombstones(binding.values) ?? []) {
    if (!pointer.startsWith("/") || pointer.slice(1).includes("/")) continue;
    delete valuesInput[unescapeJsonPointerSegment(pointer.slice(1))];
  }
  try {
    return resolveSystemValues(valuesInput);
  } catch (cause) {
    if (!(cause instanceof UnknownSystemVariableError)) throw cause;
    return [
      decorateResourceDiagnostic(
        error(
          "unknown-system-variable",
          `${subject} "${binding.id}" template "${templateId}": ${cause.message}`,
          { path: bindingPath(root, binding.id) },
        ),
        binding,
        binding.template,
        root,
      ),
    ];
  }
}

function interpolatedBindingInput(
  binding: ResolvedResourceBinding,
  subject: "agent" | "skill",
  bindingId: string,
  templateId: string,
  root: "agents" | "skills",
  values: Record<string, unknown>,
): { input: Record<string, unknown>; diagnostics: Diagnostic[] } {
  const input = binding.input as Record<string, unknown>;
  try {
    return {
      input: interpolateValues(binding.input, values) as Record<
        string,
        unknown
      >,
      diagnostics: [],
    };
  } catch (cause) {
    if (cause instanceof ValueReferenceCollisionError)
      return {
        input,
        diagnostics: [
          decorateResourceDiagnostic(
            error(
              "value-reference-collision",
              `${subject} "${bindingId}" template "${templateId}": ${cause.message}`,
              { path: bindingPath(root, bindingId, cause.path) },
            ),
            binding,
            binding.template,
            root,
          ),
        ],
      };
    const valueFailure = valueFailureDiagnostic(
      cause,
      subject,
      bindingId,
      templateId,
      root,
    );
    return {
      input,
      diagnostics: valueFailure
        ? [
            decorateResourceDiagnostic(
              valueFailure,
              binding,
              binding.template,
              root,
            ),
          ]
        : [],
    };
  }
}

type BindingValidationContext = Readonly<{
  readonly binding: ResolvedResourceBinding;
  readonly subject: "agent" | "skill";
  readonly root: "agents" | "skills";
  readonly templateId: string;
  readonly values: Record<string, unknown>;
}>;

function decorateBindingDiagnostics(
  diagnostics: readonly Diagnostic[],
  context: BindingValidationContext,
): Diagnostic[] {
  return diagnostics.map((diagnostic) =>
    decorateResourceDiagnostic(
      diagnostic,
      context.binding,
      context.binding.template,
      context.root,
    ),
  );
}

function bindingReferenceDiagnostics(
  context: BindingValidationContext,
): Diagnostic[] {
  return decorateBindingDiagnostics(
    [
      ...bindingDescriptionValidation(
        context.binding.description,
        context.values,
        context.binding.id,
        context.templateId,
        context.root,
        context.subject,
      ),
      ...missingValueDiagnostics(
        context.binding.input,
        context.values,
        context.binding.id,
        context.templateId,
        context.root,
        context.subject,
      ),
    ],
    context,
  );
}

function hasInputValueReferenceDiagnostics(
  diagnostics: readonly Diagnostic[],
): boolean {
  return diagnostics.some(
    ({ code }) =>
      code === "missing-value" || code === "invalid-value-reference",
  );
}

function validateBindingInput(
  context: BindingValidationContext,
  input: Record<string, unknown>,
  selectionTarget?: Record<string, unknown>,
): Diagnostic[] {
  return decorateBindingDiagnostics(
    validateResolvedBindingInput(
      context.binding.template,
      input,
      context.binding.id,
      context.root,
      context.subject,
      selectionTarget,
    ),
    context,
  );
}

function validateResolvedBinding(
  resources: ResolvedResourceDocument,
  root: "agents" | "skills",
  subject: "agent" | "skill",
  binding: ResolvedResourceBinding,
): Diagnostic[] {
  const templateId = binding.template.key;
  const valueContractDiagnostics = decorateBindingDiagnostics(
    bindingValueDiagnostics(
      binding.values as Record<string, unknown> | undefined,
      subject,
      binding.id,
      templateId,
      root,
    ),
    { binding, subject, root, templateId, values: {} },
  );
  if (valueContractDiagnostics.length > 0) return valueContractDiagnostics;

  const resolvedValues = resolvedBindingValues(
    resources,
    binding,
    subject,
    root,
    templateId,
  );
  if (Array.isArray(resolvedValues)) return resolvedValues;

  const context: BindingValidationContext = {
    binding,
    subject,
    root,
    templateId,
    values: resolvedValues,
  };
  const diagnostics = bindingReferenceDiagnostics(context);

  if (hasInputValueReferenceDiagnostics(diagnostics)) {
    diagnostics.push(
      ...validateBindingInput(
        context,
        binding.input as Record<string, unknown>,
      ).filter((diagnostic) => diagnostic.code !== "invalid-prompt-input"),
    );
    return diagnostics;
  }

  const interpolated = interpolatedBindingInput(
    binding,
    subject,
    binding.id,
    templateId,
    root,
    resolvedValues,
  );
  if (interpolated.diagnostics.length > 0)
    return [...diagnostics, ...interpolated.diagnostics];

  diagnostics.push(
    ...validateBindingInput(
      context,
      interpolated.input,
      binding.input as Record<string, unknown>,
    ),
  );
  return diagnostics;
}

/** Validates canonical resource output without rendering Markdown. */
export function validateResolvedDocument(
  resources: ResolvedResourceDocument,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = unknownSystemValueDiagnostics(resources);
  for (const id of Object.keys(resources.bindings.agents).sort()) {
    const binding = resources.bindings.agents[id];
    if (binding)
      diagnostics.push(
        ...validateResolvedBinding(resources, "agents", "agent", binding),
      );
  }
  for (const id of Object.keys(resources.bindings.skills).sort()) {
    const binding = resources.bindings.skills[id];
    if (binding)
      diagnostics.push(
        ...validateResolvedBinding(resources, "skills", "skill", binding),
      );
  }
  return sortDiagnostics(diagnostics);
}

export function resourceOriginForDocument(
  resources: ResolvedResourceDocument,
): ResourceOrigin | undefined {
  return rootOrigin(resources);
}
