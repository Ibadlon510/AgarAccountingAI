import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildSystemNoteDrafts } from '../src/lib/system-note-drafts';

test('uses the selected client display name throughout financial statement presentation', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /\{pack\.snapshot\.entityName\}<\/h2>/);
  assert.doesNotMatch(source, /\{pack\.snapshot\.legalName\}<\/h2>/);

  const notes = buildSystemNoteDrafts({
    entityName: 'Global Leisure',
    legalName: 'Sample Accounting',
    periodEnd: '2025-12-31',
    comparativePeriodEnd: '2024-12-31',
    presentationCurrency: 'AED',
    reportingBasis: 'IFRS',
    presentationProfile: 'IAS 1',
    notes: [],
  }, [{
    number: 1,
    title: 'Basis of preparation',
    narrative: 'Accountant input required',
    requiresInput: true,
    tables: [],
  }]);

  assert.match(notes[0]?.narrative ?? '', /Global Leisure/);
  assert.doesNotMatch(notes[0]?.narrative ?? '', /Sample Accounting/);
});