import { db, systemRateAdminBootstrapStateTable, systemRateAdminsTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const userId = process.argv[2]?.trim();

if (!userId) {
  throw new Error("Usage: pnpm --filter @workspace/api-server grant:system-rate-admin -- <clerk-user-id>");
}

const [user] = await db.select({ id: usersTable.id }).from(usersTable)
  .where(eq(usersTable.id, userId))
  .limit(1);

if (!user) {
  throw new Error("The user must sign in once before the system-rate administrator entitlement can be granted.");
}

await db.transaction(async (tx) => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('agaraccounting-system-rate-admin-grant')::bigint)`);
  await tx.insert(systemRateAdminBootstrapStateTable).values({
    id: 1,
    closedByUserId: userId,
    reason: "explicit_grant",
  }).onConflictDoNothing({
    target: systemRateAdminBootstrapStateTable.id,
  });
  await tx.insert(systemRateAdminsTable).values({
    userId,
    status: "active",
  }).onConflictDoUpdate({
    target: systemRateAdminsTable.userId,
    set: {
      status: "active",
      revokedAt: null,
    },
  });
});

console.log(`Granted the system-rate administrator entitlement to ${userId}.`);