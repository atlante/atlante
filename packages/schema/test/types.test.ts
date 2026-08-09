import type {
  AgentBinding,
  AgentBindingOverlay,
  AtlanteDocument,
  AtlanteDocumentOverlay,
  SkillBinding,
} from "../src/index.js";

const overlayWithInstance: AgentBindingOverlay = {
  $instance: "./resources/agent",
  description: "An authored agent binding.",
  prompt: {
    template: "atlante/prompt-slot",
  },
};

const overlayWithTemplate: AgentBindingOverlay = {
  $template: "./resources/agent",
  sections: [{ template: "atlante/section", content: "Review changes." }],
};

const overlayWithoutSelector: AgentBindingOverlay = {
  description: "Use the default template.",
  content: {
    template: "ordinary-template-data",
  },
};

// @ts-expect-error A raw binding cannot select both an instance and a template.
const overlayWithBothSelectors: AgentBindingOverlay = {
  $instance: "./resources/agent",
  $template: "./resources/agent-template",
};

const overlayWithTopLevelTemplate: AgentBindingOverlay = {
  // @ts-expect-error `template` is only valid inside template-owned fields.
  template: "atlante/agent",
};

const canonicalAgent: AgentBinding = {
  description: "A resolved agent binding.",
  sections: [{ template: "atlante/section" }],
};

const canonicalSkill: SkillBinding = {
  description: "A resolved skill binding.",
  content: { template: "ordinary-template-data" },
};

const canonicalWithInstance: AgentBinding = {
  description: "A resolved agent binding.",
  // @ts-expect-error A canonical binding cannot retain a source selector.
  $instance: "./resources/agent",
};

const canonicalWithTopLevelTemplate: SkillBinding = {
  description: "A resolved skill binding.",
  // @ts-expect-error A canonical binding cannot have a direct binding-level template.
  template: "atlante/skill",
};

const canonicalDocumentWithTopLevelTemplate: AtlanteDocument = {
  $schema: "https://atlante.sh/schema/v0.1/schema.json",
  agents: {
    reviewer: {
      description: "A resolved agent binding.",
      // @ts-expect-error Canonical document bindings cannot have a direct template.
      template: "atlante/agent",
    },
  },
};

const overlayDocument: AtlanteDocumentOverlay = {
  $schema: "https://atlante.sh/schema/v0.1/schema.json",
  extends: "atlante/starter",
  agents: {
    reviewer: overlayWithInstance,
  },
  skills: {
    testing: null,
  },
};

const canonicalDocument: AtlanteDocument = {
  $schema: "https://atlante.sh/schema/v0.1/schema.json",
  agents: {
    reviewer: canonicalAgent,
  },
  skills: {
    testing: canonicalSkill,
  },
};

void overlayWithoutSelector;
void overlayWithTemplate;
void overlayWithBothSelectors;
void overlayWithTopLevelTemplate;
void overlayDocument;
void canonicalWithInstance;
void canonicalWithTopLevelTemplate;
void canonicalDocumentWithTopLevelTemplate;
void canonicalDocument;
