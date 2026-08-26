import app from "./app";
import { logger } from "./lib/logger";
import { ensureLedgerflowIntegrity } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start() {
  // This must finish before the listener is created: duplicate audit rows rely
  // on the completed-only import hash index.
  await ensureLedgerflowIntegrity();
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

void start().catch((err) => {
  logger.error({ err }, "Could not install AgarAccounting AI integrity protections");
  process.exit(1);
});
