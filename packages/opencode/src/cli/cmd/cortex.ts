import * as prompts from "@clack/prompts"
import path from "path"
import { cmd } from "./cmd"
import { Global } from "@/global"
import { loadSnowflakeCliProfiles } from "@/cli/snowflake-cli"
import { buildBaseUrl, writeCortexConfig } from "@/cli/snowflake-config"

function parseModels(input: string) {
  return input
    .split(/[\s,]+/)
    .map((model) => model.trim())
    .filter(Boolean)
}

async function selectConfigPath() {
  const projectPath = path.join(process.cwd(), "opencode_cortex.jsonc")
  const globalPath = path.join(Global.Path.config, "opencode_cortex.jsonc")
  const scope = await prompts.select({
    message: "Where should opencode_cortex.jsonc be created?",
    options: [
      { label: "Current project", value: projectPath, hint: projectPath },
      { label: "Global", value: globalPath, hint: globalPath },
    ],
  })
  if (prompts.isCancel(scope)) return undefined
  return scope as string
}

export const CortexInitCommand = cmd({
  command: "cortex-init",
  describe: "initialize Snowflake Cortex configuration",
  async handler() {
    prompts.intro("Snowflake Cortex setup")
    const profiles = await loadSnowflakeCliProfiles()
    let account = ""
    let token: string | undefined

    if (profiles.length) {
      const picked = await prompts.select({
        message: "Import settings from Snowflake CLI?",
        options: [
          ...profiles.map((profile) => ({
            label: `${profile.name}${profile.account ? ` (${profile.account})` : ""}`,
            value: profile.name,
            hint: profile.source,
          })),
          { label: "Manual setup", value: "manual" },
        ],
      })
      if (prompts.isCancel(picked)) return
      if (picked !== "manual") {
        const profile = profiles.find((p) => p.name === picked)
        if (profile?.account) account = profile.account
        if (profile?.token) token = profile.token
      }
    }

    if (!account) {
      const accountInput = await prompts.text({
        message: "Snowflake account identifier",
        placeholder: "xy12345.us-east-1",
      })
      if (prompts.isCancel(accountInput)) return
      account = String(accountInput)
    }

    const baseUrlInput = await prompts.text({
      message: "Snowflake Cortex base URL",
      initialValue: buildBaseUrl(account),
    })
    if (prompts.isCancel(baseUrlInput)) return
    const baseURL = String(baseUrlInput)

    const authChoice = await prompts.select({
      message: "How should we store your Snowflake PAT?",
      options: [
        ...(token ? [{ label: "Use token from Snowflake CLI config", value: "cli" }] : []),
        { label: "Use environment variable", value: "env" },
        { label: "Paste token now", value: "paste" },
      ],
    })
    if (prompts.isCancel(authChoice)) return
    if (authChoice === "cli") {
      // token already loaded
    } else if (authChoice === "env") {
      const envVar = await prompts.text({
        message: "Environment variable name",
        initialValue: "SNOWFLAKE_PAT",
      })
      if (prompts.isCancel(envVar)) return
      token = `{env:${envVar}}`
    } else {
      const pasted = await prompts.password({
        message: "Snowflake PAT",
      })
      if (prompts.isCancel(pasted)) return
      token = String(pasted)
    }

    const modelsInput = await prompts.text({
      message: "Snowflake Cortex models (comma or space separated)",
      initialValue: "claude-opus-4-5",
    })
    if (prompts.isCancel(modelsInput)) return
    const models = parseModels(String(modelsInput))

    const configPath = await selectConfigPath()
    if (!configPath) return

    await writeCortexConfig(configPath, {
      account,
      baseURL,
      apiKey: token,
      models,
    })

    prompts.outro(`Snowflake Cortex config written to ${configPath}`)
  },
})
