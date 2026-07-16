import { readdir, readFile } from "node:fs/promises"
import { dirname, join, basename } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import matter from "gray-matter"
import type { Plugin } from "@opencode-ai/plugin"

const __dirname = dirname(fileURLToPath(import.meta.url))

const OPENCODE_CONFIG_DIR =
  process.env.OPENCODE_CONFIG_DIR ??
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "opencode")

const BUNDLED_AGENTS_DIR = join(__dirname, "agents")
const USER_AGENTS_DIR = join(OPENCODE_CONFIG_DIR, "atlas", "agents")

interface AgentEntry {
  name: string
  config: Record<string, unknown>
}

async function loadAgents(dir: string): Promise<AgentEntry[]> {
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".md"))
  } catch {
    return []
  }

  const entries: AgentEntry[] = []
  for (const file of files) {
    const raw = await readFile(join(dir, file), "utf8")
    const { data, content } = matter(raw)
    entries.push({
      name: basename(file, ".md"),
      config: {
        description: data.description,
        mode: data.mode ?? "subagent",
        model: data.model,
        permission: data.permission,
        temperature: data.temperature,
        steps: data.steps,
        hidden: data.hidden,
        prompt: content.trim(),
      },
    })
  }
  return entries
}

function isNonEmpty(val: unknown): boolean {
  if (val === undefined || val === null) return false
  if (typeof val === "string") return val.length > 0
  return true
}

function cleanConfig(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (isNonEmpty(v)) out[k] = v
  }
  return out
}

const plugin: Plugin = async (_input, options) => {
  const model = (options as { model?: string } | undefined)?.model

  return {
    config: async (cfg) => {
      cfg.agent ??= {}

      const bundled = await loadAgents(BUNDLED_AGENTS_DIR)
      const user = await loadAgents(USER_AGENTS_DIR)

      // Precedence: existing config > user files > bundled defaults
      const registered: string[] = []

      for (const entry of [...bundled, ...user]) {
        if (Object.hasOwn(cfg.agent, entry.name)) continue

        const agentConfig = cleanConfig(entry.config)
        if (model && !agentConfig.model) {
          agentConfig.model = model
        }

        cfg.agent[entry.name] = agentConfig
        registered.push(entry.name)
      }

      // Inject agent roster into orchestrator prompt
      const orchestrator = cfg.agent["atlas"] as
        | { prompt?: string }
        | undefined
      if (orchestrator?.prompt && registered.length > 0) {
        const roster = registered
          .map((name) => `- ${name}`)
          .join("\n")
        orchestrator.prompt += `\n\n## Available agents\n\n${roster}\n\nUse the task tool with subagent_type set to the agent name.`
      }
    },
  }
}

export default plugin
