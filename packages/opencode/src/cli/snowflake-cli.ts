import fs from "fs/promises"
import os from "os"
import path from "path"

export type SnowflakeCliProfile = {
  name: string
  source: string
  account?: string
  token?: string
}

const CLI_CONFIG_PATHS = [
  path.join(os.homedir(), ".snowflake", "config"),
  path.join(os.homedir(), ".config", "snowflake", "config"),
  path.join(os.homedir(), ".snowsql", "config"),
]

type IniSection = Record<string, string>

function parseIni(text: string): Record<string, IniSection> {
  const sections: Record<string, IniSection> = {}
  let current = "default"
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#") || line.startsWith(";")) continue
    if (line.startsWith("[") && line.endsWith("]")) {
      current = line.slice(1, -1).trim() || "default"
      sections[current] ||= {}
      continue
    }
    const idx = line.indexOf("=")
    if (idx === -1) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    sections[current] ||= {}
    sections[current][key] = value
  }
  return sections
}

function deriveAccountFromHost(host?: string) {
  if (!host) return undefined
  const normalized = host.replace(/^https?:\/\//, "").toLowerCase()
  const base = normalized.split("/")[0]
  if (!base.endsWith(".snowflakecomputing.com")) return undefined
  return base.replace(".snowflakecomputing.com", "")
}

function normalizeProfileName(section: string) {
  if (section.startsWith("connections.")) return section.slice("connections.".length)
  if (section === "connections") return "default"
  return section
}

function extractAccount(section: IniSection) {
  return (
    section["account"] ||
    section["accountname"] ||
    section["account_name"] ||
    section["account_identifier"] ||
    deriveAccountFromHost(section["host"])
  )
}

function extractToken(section: IniSection) {
  return section["token"] || section["pat"]
}

export async function loadSnowflakeCliProfiles(): Promise<SnowflakeCliProfile[]> {
  const profiles: SnowflakeCliProfile[] = []
  for (const filepath of CLI_CONFIG_PATHS) {
    try {
      const text = await fs.readFile(filepath, "utf8")
      const sections = parseIni(text)
      for (const [sectionName, section] of Object.entries(sections)) {
        const name = normalizeProfileName(sectionName)
        profiles.push({
          name,
          source: filepath,
          account: extractAccount(section),
          token: extractToken(section),
        })
      }
    } catch {
      // ignore missing or unreadable configs
    }
  }
  return profiles
}
