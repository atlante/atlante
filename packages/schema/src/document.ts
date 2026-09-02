import { z } from "zod";
import type { ValuesMap, ValuesMapOverlay } from "./values.js";
import {
  safeRecord,
  valuesMapOverlaySchema,
  valuesMapSchema,
} from "./values.js";

export const SCHEMA_URI = "https://atlante.sh/schema/v0.1/schema.json";

/** Host materialization targets admitted by document schema v0.1. */
export const hostTargetSchema = z.literal("opencode");

export type HostTarget = z.infer<typeof hostTargetSchema>;

/**
 * Authored host selection: at least one target, no duplicates. The canonical
 * document defaults to the OpenCode host when the field is absent.
 */
export const hostsSchema = z
  .array(hostTargetSchema)
  .min(1)
  .refine(
    (hosts) => new Set(hosts).size === hosts.length,
    "hosts must not contain duplicate entries",
  );

export type Hosts = z.infer<typeof hostsSchema>;

/** Authored locators are structurally strings; resource grammar is semantic. */
export const rawResourceLocatorSchema = z.string().min(1);

export type RawResourceLocator = z.infer<typeof rawResourceLocatorSchema>;
export type AuthoredResourceLocator = RawResourceLocator;

const authoredExtendsArraySchema = z
  .tuple([rawResourceLocatorSchema])
  .rest(rawResourceLocatorSchema);

/** Authored preset inheritance is one locator or an ordered non-empty list. */
export const authoredExtendsSchema = z.union([
  rawResourceLocatorSchema,
  authoredExtendsArraySchema,
]);

export type AuthoredExtends = z.infer<typeof authoredExtendsSchema>;

/** Binding metadata shared by every resolved template-backed binding. */
export const bindingDescriptionSchema = z.object({
  description: z.string().min(1),
});

type ObjectSchemaValidation = (
  source: Record<string, unknown>,
  addIssue: (issue: {
    code: "custom";
    message: string;
    path: (string | number)[];
  }) => void,
) => void;

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function bindingSchema<Output>(
  baseSchema: z.ZodTypeAny,
  reservedKeys: ReadonlySet<string>,
  validateObject?: ObjectSchemaValidation,
) {
  return z
    .unknown()
    .superRefine((input, context) => {
      if (!isObject(input)) {
        context.addIssue({ code: "custom", message: "expected an object" });
        return;
      }
      const result = baseSchema.safeParse(input);
      if (!result.success) {
        for (const issue of result.error.issues)
          context.addIssue({
            code: "custom",
            message: issue.message,
            path: issue.path.map(String),
          });
        return;
      }
      validateObject?.(input, (issue) => context.addIssue(issue));
    })
    .transform((input) => {
      const parsed = baseSchema.parse(input) as Record<string, unknown>;
      const source = input as Record<string, unknown>;
      const output: Record<string, unknown> = {};
      for (const key of Object.keys(source)) {
        const value = reservedKeys.has(key) ? parsed[key] : source[key];
        Object.defineProperty(output, key, {
          configurable: true,
          enumerable: true,
          value,
          writable: true,
        });
      }
      return output as Output;
    });
}

function rejectReservedKeys(
  keys: ReadonlySet<string>,
  message: string,
): ObjectSchemaValidation {
  return (source, addIssue) => {
    for (const key of keys) {
      if (Object.hasOwn(source, key))
        addIssue({ code: "custom", message, path: [key] });
    }
  };
}

function validateSourceObject(
  source: Record<string, unknown>,
  addIssue: Parameters<ObjectSchemaValidation>[1],
): void {
  if (Object.hasOwn(source, "$instance") && Object.hasOwn(source, "$template"))
    addIssue({
      code: "custom",
      message: "$instance and $template are mutually exclusive",
      path: ["$template"],
    });
  if (Object.hasOwn(source, "template"))
    addIssue({
      code: "custom",
      message: "template is reserved; use $template or $instance",
      path: ["template"],
    });
}

const rawSourceObjectBaseSchema = z.looseObject({
  $instance: rawResourceLocatorSchema.optional(),
  $template: rawResourceLocatorSchema.optional(),
  description: z.union([z.string().min(1), z.null()]).optional(),
  values: valuesMapOverlaySchema.optional(),
});

type TemplateOwnedFields = {
  [key: string]: unknown;
  template?: never;
};

type RawBindingFields = TemplateOwnedFields & {
  description?: string | null;
  values?: ValuesMapOverlay;
};

type RawBindingWithoutSelector = RawBindingFields & {
  $instance?: never;
  $template?: never;
};

type RawBindingWithInstance = RawBindingFields & {
  $instance: RawResourceLocator;
  $template?: never;
};

type RawBindingWithTemplate = RawBindingFields & {
  $instance?: never;
  $template: RawResourceLocator;
};

/** Authored binding source object, with at most one source selector. */
export type RawBinding =
  | RawBindingWithoutSelector
  | RawBindingWithInstance
  | RawBindingWithTemplate;

export type AuthoredBinding = RawBinding;

/** Authored source object: selector metadata plus a template-owned overlay. */
export const resourceSourceObjectSchema = bindingSchema<RawBinding>(
  rawSourceObjectBaseSchema,
  new Set(["$instance", "$template", "description", "values"]),
  validateSourceObject,
);

export type ResourceSourceObject = RawBinding;
export type RawResourceSourceObject = RawBinding;

/** Authored source shorthand or an object with a local overlay. */
export const resourceSourceSchema = z.union([
  rawResourceLocatorSchema,
  resourceSourceObjectSchema,
]);

export type ResourceSource = RawResourceLocator | RawBinding;
export type RawResourceSource = ResourceSource;

/** A resolved binding cannot retain source selectors or the legacy selector. */
const canonicalBindingValidation = rejectReservedKeys(
  new Set(["$instance", "$template", "template"]),
  "binding source selectors are not part of the canonical document",
);

/**
 * An agent binding leaves prompt fields open: the selected template owns their
 * names and semantics. Unknown-field rejection happens at semantic validation.
 */
const canonicalBindingBaseSchema = z.looseObject({
  ...bindingDescriptionSchema.shape,
  values: valuesMapSchema.optional(),
});

type CanonicalBinding = TemplateOwnedFields & {
  $instance?: never;
  $template?: never;
  description: string;
  values?: ValuesMap;
};

export const agentBindingSchema = bindingSchema<CanonicalBinding>(
  canonicalBindingBaseSchema,
  new Set(["description", "values"]),
  canonicalBindingValidation,
);

export const skillBindingSchema = bindingSchema<CanonicalBinding>(
  canonicalBindingBaseSchema,
  new Set(["description", "values"]),
  canonicalBindingValidation,
);

export type AgentBinding = CanonicalBinding;
export type SkillBinding = CanonicalBinding;

/** Raw source objects used by agent and skill maps before resource resolution. */
export const agentBindingOverlaySchema = resourceSourceObjectSchema;
export const skillBindingOverlaySchema = resourceSourceObjectSchema;

export type AgentBindingOverlay = z.infer<typeof agentBindingOverlaySchema>;
export type SkillBindingOverlay = z.infer<typeof skillBindingOverlaySchema>;

const agentsOverlaySchema = safeRecord(
  z.string().min(1),
  z.union([resourceSourceSchema, z.null()]),
);
const skillsOverlaySchema = safeRecord(
  z.string().min(1),
  z.union([resourceSourceSchema, z.null()]),
);

export type AgentsOverlay = z.infer<typeof agentsOverlaySchema>;
export type SkillsOverlay = z.infer<typeof skillsOverlaySchema>;

/** Authored document overlay, before resource and tombstone resolution. */
export const atlanteDocumentOverlaySchema = z.strictObject({
  $schema: z.literal(SCHEMA_URI),
  extends: authoredExtendsSchema.optional(),
  hosts: hostsSchema.optional(),
  values: valuesMapOverlaySchema.optional(),
  agents: agentsOverlaySchema.optional(),
  skills: skillsOverlaySchema.optional(),
});

export type AtlanteDocumentOverlay = z.infer<
  typeof atlanteDocumentOverlaySchema
>;

/** Canonical document after expansion: no extends, selectors, or tombstones. */
export const atlanteDocumentSchema = z.strictObject({
  $schema: z.literal(SCHEMA_URI),
  hosts: hostsSchema.default(["opencode"]),
  values: valuesMapSchema.optional(),
  agents: safeRecord(z.string().min(1), agentBindingSchema).default({}),
  skills: safeRecord(z.string().min(1), skillBindingSchema).default({}),
});

type AtlanteDocumentOutput = z.infer<typeof atlanteDocumentSchema>;

export type AtlanteDocument = Omit<
  AtlanteDocumentOutput,
  "agents" | "skills"
> & {
  agents?: AtlanteDocumentOutput["agents"];
  skills?: AtlanteDocumentOutput["skills"];
};
