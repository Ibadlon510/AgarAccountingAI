import type { PoolClient } from "pg";

export const LEGACY_TABLE_RENAMES: ReadonlyArray<readonly [string, string]>;

export function upgradeLedgerflowSchema(
  client: PoolClient,
  options?: { schema?: string },
): Promise<{ renamedTables: number }>;