import fs from "fs/promises"
import path from "path"
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser"

export type SnowflakeConfigInput = {
  account?: string
  baseURL?: string
  apiKey?: string
  models: string[]
}

const SCHEMA_URL = "https://opencode.ai/config.json"

export function buildBaseUrl(account?: string) {
  if (!account) return undefined
  return `https://${account}.snowflakecomputing.com/api/v2/cortex/v1`
}

function patchJsonc(input: string, patch: unknown, path: string[] = []): string {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    const edits = modify(input, path, patch, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
      },
    })
    return applyEdits(input, edits)
  }

  return Object.entries(patch).reduce((result, [key, value]) => {
    if (value === undefined) return result
    return patchJsonc(result, value, [...path, key])
  }, input)
}

function normalizeModels(models: string[]) {
  return models.map((m) => m.trim()).filter(Boolean)
}

function buildModels(models: string[]) {
  return normalizeModels(models).reduce<Record<string, any>>((acc, modelId) => {
    acc[modelId] = {
      name: modelId,
      tool_call: true,
      attachment: true,
    }
    return acc
  }, {})
}

export async function writeCortexConfig(filePath: string, input: SnowflakeConfigInput) {
  const exists = await fs
    .access(filePath)
    .then(() => true)
    .catch(() => false)

  let text = exists ? await fs.readFile(filePath, "utf8") : `{\n  "$schema": "${SCHEMA_URL}"\n}\n`
  const models = normalizeModels(input.models)
  const modelId = models[0] ?? "claude-opus-4-6"

  const providerConfig = {
    npm: "@ai-sdk/openai-compatible",
    name: "Snowflake Cortex",
    options: {
      baseURL: input.baseURL ?? buildBaseUrl(input.account),
      apiKey: input.apiKey,
      headers: {
        "X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN",
      },
      snowflakeCortex: true,
    },
    models: buildModels(models.length ? models : [modelId]),
  }

  const patch = {
    $schema: SCHEMA_URL,
    provider: {
      "snowflake-cortex": providerConfig,
    },
    model: `snowflake-cortex/${modelId}`,
  }

  try {
    parseJsonc(text, [], { allowTrailingComma: true })
  } catch {
    // If parse fails, reset to a minimal schema-only file
    text = `{\n  "$schema": "${SCHEMA_URL}"\n}\n`
  }

  const updated = patchJsonc(text, patch)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, updated, "utf8")
}
