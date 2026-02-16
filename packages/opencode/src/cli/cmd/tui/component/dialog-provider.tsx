import { createMemo, createSignal, onMount, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { map, pipe, sortBy } from "remeda"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "../context/sdk"
import { DialogPrompt } from "../ui/dialog-prompt"
import { Link } from "../ui/link"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import type { ProviderAuthAuthorization } from "@opencode-ai/sdk/v2"
import { DialogModel } from "./dialog-model"
import { useKeyboard } from "@opentui/solid"
import { Clipboard } from "@tui/util/clipboard"
import { useToast } from "../ui/toast"
import path from "path"
import { Global } from "@/global"
import { loadSnowflakeCliProfiles } from "@/cli/snowflake-cli"
import { buildBaseUrl, writeCortexConfig } from "@/cli/snowflake-config"

const PROVIDER_PRIORITY: Record<string, number> = {
  opencode: 0,
  anthropic: 1,
  "github-copilot": 2,
  openai: 3,
  google: 4,
}

function parseModels(input: string) {
  return input
    .split(/[\s,]+/)
    .map((model) => model.trim())
    .filter(Boolean)
}

async function selectDialog<T>(
  dialog: ReturnType<typeof useDialog>,
  title: string,
  options: { title: string; value: T; description?: string; footer?: string }[],
) {
  return new Promise<T | null>((resolve) => {
    dialog.replace(
      () => <DialogSelect title={title} options={options} onSelect={(option) => resolve(option.value)} />,
      () => resolve(null),
    )
  })
}

async function runSnowflakeSetup(dialog: ReturnType<typeof useDialog>, sdk: ReturnType<typeof useSDK>, sync: ReturnType<typeof useSync>, toast: ReturnType<typeof useToast>) {
  const profiles = await loadSnowflakeCliProfiles()
  let account = ""
  let token: string | undefined

  if (profiles.length) {
    const picked = await selectDialog(
      dialog,
      "Import Snowflake CLI settings?",
      [
        ...profiles.map((profile) => ({
          title: `${profile.name}${profile.account ? ` (${profile.account})` : ""}`,
          value: profile.name,
          footer: profile.source,
        })),
        { title: "Manual setup", value: "manual" },
      ],
    )
    if (picked == null) return false
    if (picked !== "manual") {
      const profile = profiles.find((p) => p.name === picked)
      if (profile?.account) account = profile.account
      if (profile?.token) token = profile.token
    }
  }

  if (!account) {
    const accountInput = await DialogPrompt.show(dialog, "Snowflake account identifier", {
      placeholder: "xy12345.us-east-1",
    })
    if (!accountInput) return false
    account = accountInput
  }

  const baseURL = await DialogPrompt.show(dialog, "Snowflake Cortex base URL", {
    value: buildBaseUrl(account),
  })
  if (!baseURL) return false

  const authChoice = await selectDialog(dialog, "How should we store your Snowflake PAT?", [
    ...(token ? [{ title: "Use token from Snowflake CLI config", value: "cli" as const }] : []),
    { title: "Use environment variable", value: "env" as const },
    { title: "Paste token now", value: "paste" as const },
  ])
  if (!authChoice) return false
  if (authChoice === "env") {
    const envVar = await DialogPrompt.show(dialog, "Environment variable name", {
      value: "SNOWFLAKE_PAT",
    })
    if (!envVar) return false
    token = `{env:${envVar}}`
  } else if (authChoice === "paste") {
    const pasted = await DialogPrompt.show(dialog, "Snowflake PAT", {
      placeholder: "paste token here",
    })
    if (!pasted) return false
    token = pasted
  }

  const modelsInput = await DialogPrompt.show(dialog, "Snowflake Cortex models", {
    value: "claude-opus-4-5",
    placeholder: "comma or space separated",
  })
  if (!modelsInput) return false
  const models = parseModels(modelsInput)

  const projectPath = path.join(process.cwd(), "opencode_cortex.jsonc")
  const globalPath = path.join(Global.Path.config, "opencode_cortex.jsonc")
  const configPath = await selectDialog(dialog, "Where should we write opencode_cortex.jsonc?", [
    { title: "Current project", value: projectPath, description: projectPath },
    { title: "Global", value: globalPath, description: globalPath },
  ])
  if (!configPath) return false

  await writeCortexConfig(configPath, {
    account,
    baseURL,
    apiKey: token,
    models,
  })

  await sdk.client.instance.dispose()
  await sync.bootstrap()
  toast.show({ message: `Saved Snowflake config to ${configPath}`, variant: "success" })
  return true
}

export function createDialogProviderOptions() {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()
  const options = createMemo(() => {
    return pipe(
      sync.data.provider_next.all,
      sortBy((x) => PROVIDER_PRIORITY[x.id] ?? 99),
      map((provider) => ({
        title: provider.name,
        value: provider.id,
        description: {
          opencode: "(Recommended)",
          anthropic: "(Claude Max or API key)",
          openai: "(ChatGPT Plus/Pro or API key)",
        }[provider.id],
        category: provider.id in PROVIDER_PRIORITY ? "Popular" : "Other",
        async onSelect() {
          if (provider.id === "snowflake-cortex") {
            const done = await runSnowflakeSetup(dialog, sdk, sync, toast)
            if (done) {
              dialog.replace(() => <DialogModel providerID={provider.id} />)
            }
            return
          }
          const methods = sync.data.provider_auth[provider.id] ?? [
            {
              type: "api",
              label: "API key",
            },
          ]
          let index: number | null = 0
          if (methods.length > 1) {
            index = await new Promise<number | null>((resolve) => {
              dialog.replace(
                () => (
                  <DialogSelect
                    title="Select auth method"
                    options={methods.map((x, index) => ({
                      title: x.label,
                      value: index,
                    }))}
                    onSelect={(option) => resolve(option.value)}
                  />
                ),
                () => resolve(null),
              )
            })
          }
          if (index == null) return
          const method = methods[index]
          if (method.type === "oauth") {
            const result = await sdk.client.provider.oauth.authorize({
              providerID: provider.id,
              method: index,
            })
            if (result.data?.method === "code") {
              dialog.replace(() => (
                <CodeMethod providerID={provider.id} title={method.label} index={index} authorization={result.data!} />
              ))
            }
            if (result.data?.method === "auto") {
              dialog.replace(() => (
                <AutoMethod providerID={provider.id} title={method.label} index={index} authorization={result.data!} />
              ))
            }
          }
          if (method.type === "api") {
            return dialog.replace(() => <ApiMethod providerID={provider.id} title={method.label} />)
          }
        },
      })),
    )
  })
  return options
}

export function DialogProvider() {
  const options = createDialogProviderOptions()
  return <DialogSelect title="Connect a provider" options={options()} />
}

interface AutoMethodProps {
  index: number
  providerID: string
  title: string
  authorization: ProviderAuthAuthorization
}
function AutoMethod(props: AutoMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()

  useKeyboard((evt) => {
    if (evt.name === "c" && !evt.ctrl && !evt.meta) {
      const code = props.authorization.instructions.match(/[A-Z0-9]{4}-[A-Z0-9]{4,5}/)?.[0] ?? props.authorization.url
      Clipboard.copy(code)
        .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
        .catch(toast.error)
    }
  })

  onMount(async () => {
    const result = await sdk.client.provider.oauth.callback({
      providerID: props.providerID,
      method: props.index,
    })
    if (result.error) {
      dialog.clear()
      return
    }
    await sdk.client.instance.dispose()
    await sync.bootstrap()
    dialog.replace(() => <DialogModel providerID={props.providerID} />)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box gap={1}>
        <Link href={props.authorization.url} fg={theme.primary} />
        <text fg={theme.textMuted}>{props.authorization.instructions}</text>
      </box>
      <text fg={theme.textMuted}>Waiting for authorization...</text>
      <text fg={theme.text}>
        c <span style={{ fg: theme.textMuted }}>copy</span>
      </text>
    </box>
  )
}

interface CodeMethodProps {
  index: number
  title: string
  providerID: string
  authorization: ProviderAuthAuthorization
}
function CodeMethod(props: CodeMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const [error, setError] = createSignal(false)

  return (
    <DialogPrompt
      title={props.title}
      placeholder="Authorization code"
      onConfirm={async (value) => {
        const { error } = await sdk.client.provider.oauth.callback({
          providerID: props.providerID,
          method: props.index,
          code: value,
        })
        if (!error) {
          await sdk.client.instance.dispose()
          await sync.bootstrap()
          dialog.replace(() => <DialogModel providerID={props.providerID} />)
          return
        }
        setError(true)
      }}
      description={() => (
        <box gap={1}>
          <text fg={theme.textMuted}>{props.authorization.instructions}</text>
          <Link href={props.authorization.url} fg={theme.primary} />
          <Show when={error()}>
            <text fg={theme.error}>Invalid code</text>
          </Show>
        </box>
      )}
    />
  )
}

interface ApiMethodProps {
  providerID: string
  title: string
}
function ApiMethod(props: ApiMethodProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title={props.title}
      placeholder="API key"
      description={
        props.providerID === "opencode" ? (
          <box gap={1}>
            <text fg={theme.textMuted}>
              OpenCode Zen gives you access to all the best coding models at the cheapest prices with a single API key.
            </text>
            <text fg={theme.text}>
              Go to <span style={{ fg: theme.primary }}>https://opencode.ai/zen</span> to get a key
            </text>
          </box>
        ) : undefined
      }
      onConfirm={async (value) => {
        if (!value) return
        await sdk.client.auth.set({
          providerID: props.providerID,
          auth: {
            type: "api",
            key: value,
          },
        })
        await sdk.client.instance.dispose()
        await sync.bootstrap()
        dialog.replace(() => <DialogModel providerID={props.providerID} />)
      }}
    />
  )
}
