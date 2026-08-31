import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const artifactFile = (path: string) => new URL(`../${path}`, import.meta.url);

test("assistant card wires applied assign_contacts and confirmable unpost/merge", async () => {
  const source = await readFile(artifactFile("src/components/assistant-fab.tsx"), "utf8");
  assert.match(source, /assign_contacts/);
  assert.match(source, /assign-contacts-result-/);
  assert.match(source, /Applied to draft records/);
  assert.match(source, /rec\.contactName/);
  assert.match(source, /rec\.lineCount/);
  assert.match(source, /isAppliedResult/);
  assert.match(source, /invalidateAccountantQueries/);
  assert.match(source, /getGetContactsQueryKey/);
  assert.match(source, /getGetStatementLinesQueryKey/);
  assert.match(source, /getGetJournalEntriesQueryKey/);
  assert.match(source, /bulk_unpost_entries/);
  assert.match(source, /button-confirm-bulk-unposting-/);
  assert.match(source, /merge_contacts/);
  assert.match(source, /button-confirm-merge-contacts-/);
  assert.doesNotMatch(source, /requiresConfirmation && \(rec\.type === 'recode_lines' \|\| rec\.type === 'create_bank_account' \|\| isBulkAction\) && !rec\.type\.includes\('assign'/);
});
