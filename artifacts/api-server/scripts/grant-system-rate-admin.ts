import { db, systemRateAdminsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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

await db.insert(systemRateAdminsTable).values({
  userId,
  status: "active",
}).onConflictDoUpdate({
  target: systemRateAdminsTable.userId,
  set: {
    status: "active",
    revokedAt: null,
  },
});

console.log(`Granted the system-rate administrator entitlement to ${userId}.`);