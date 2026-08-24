import { pool } from "@workspace/db";

const testDatabaseNamePattern = /(^|[_-])test(?:[_-]|$)/i;

function testDatabaseTarget() {
  const source = process.env.DATABASE_URL;
  if (!source) throw new Error("DATABASE_URL is required to provision the LedgerFlow integration test database.");

  const sourceUrl = new URL(source);
  const sourceDatabaseName = decodeURIComponent(sourceUrl.pathname).replace(/^\/+/, "");
  if (!sourceDatabaseName) throw new Error("DATABASE_URL must include a database name.");

  const testDatabaseName = testDatabaseNamePattern.test(sourceDatabaseName)
    ? sourceDatabaseName
    : `${sourceDatabaseName.replace(/[^a-z0-9_]/gi, "_")}_test`;
  if (!testDatabaseNamePattern.test(testDatabaseName)) {
    throw new Error("The LedgerFlow integration test database name must contain 'test'.");
  }

  sourceUrl.pathname = `/${encodeURIComponent(testDatabaseName)}`;
  return { sourceDatabaseName, testDatabaseName, testDatabaseUrl: sourceUrl.toString() };
}

function quotedIdentifier(value: string) {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

const target = testDatabaseTarget();

try {
  if (target.testDatabaseName !== target.sourceDatabaseName) {
    const existing = await pool.query("select 1 from pg_database where datname = $1", [target.testDatabaseName]);
    if (existing.rowCount === 0) {
      await pool.query(`create database ${quotedIdentifier(target.testDatabaseName)}`);
    }
  }
  process.stdout.write(target.testDatabaseUrl);
} finally {
  await pool.end();
}