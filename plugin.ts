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

const BUNDLED_SPECIALISTS_DIR = join(__dirname, "specialists")
const USER_SPECIALISTS_DIR = join(OPENCODE_CONFIG_DIR, "workflow", "specialists")

interface SpecialistEntry {
  name: string
  config: Record<string, unknown>
}

async function loadSpecialists(dir: string): Promise<SpecialistEntry[]> {
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".md"))
  } catch {
    return []
  }

  const entries: SpecialistEntry[] = []
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

      const bundled = await loadSpecialists(BUNDLED_SPECIALISTS_DIR)
      const user = await loadSpecialists(USER_SPECIALISTS_DIR)

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

      // Inject specialist roster into orchestrator prompt
      const orchestrator = cfg.agent["workflow"] as
        | { prompt?: string }
        | undefined
      if (orchestrator?.prompt && registered.length > 0) {
        const roster = registered
          .map((name) => `- ${name}`)
          .join("\n")
        orchestrator.prompt += `\n\n## Available specialists\n\n${roster}\n\nUse the task tool with subagent_type set to the specialist name.`
      }
    },
  }
}

export default plugin
