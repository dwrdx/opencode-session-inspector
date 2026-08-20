import { homedir } from "os"
import { isAbsolute, join } from "path"

export const DEFAULT_PORT = 8787

export interface DbConfig {
  readonly filename: string
  readonly dataDir: string
}

export function defaultDataDir(): string {
  return join(homedir(), ".local", "share", "opencode")
}

/**
 * Resolve the opencode database path. Mirrors `packages/core/src/database/database.ts`
 * for the common cases:
 *   --db flag                    (absolute or relative to the data directory)
 *   OPENCODE_DB env              (absolute, or relative to the data directory)
 *   default                      <dataDir>/opencode.db
 */
export function resolveDb(filenameOverride: string | undefined): DbConfig {
  const dataDir = defaultDataDir()
  const raw = filenameOverride ?? process.env["OPENCODE_DB"]
  if (raw) {
    if (raw === ":memory:") {
      throw new Error(`OPENCODE_DB=":memory:" is not supported by opencode-session-inspector`)
    }
    return { filename: isAbsolute(raw) ? raw : join(dataDir, raw), dataDir }
  }
  return { filename: join(dataDir, "opencode.db"), dataDir }
}