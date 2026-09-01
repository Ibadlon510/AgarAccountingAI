import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildSystemNoteDrafts } from '../src/lib/system-note-drafts';

test('uses the client legal name throughout financial statement presentation', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /\{pack\.snapshot\.legalName\}<\/h2>/);
  assert.doesNotMatch(source, /\{pack\.snapshot\.entityName\}<\/h2>/);

  const notes = buildSystemNoteDrafts({
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

  assert.match(notes[0]?.narrative ?? '', /Sample Accounting/);
  assert.doesNotMatch(notes[0]?.narrative ?? '', /Global Leisure/);
});

test('preserves every bank-account row when hydrating the cash note', () => {
  const cashRows = [
    { label: 'Wio Bank — AED •••• 8819', current: 120, comparative: 90 },
    { label: 'Wio Bank — USD •••• 8306', current: 80, comparative: 70 },
  ];
  const notes = buildSystemNoteDrafts({
    legalName: 'Sample Accounting',
    periodEnd: '2025-12-31',
    comparativePeriodEnd: '2024-12-31',
    presentationCurrency: 'AED',
    reportingBasis: 'IFRS',
    presentationProfile: 'IAS 1',
  }, [{
    number: 3,
    title: 'Cash and cash equivalents',
    narrative: 'Confirm restricted cash',
    requiresInput: true,
    tables: cashRows,
  }]);

  assert.deepEqual(notes[0]?.tables, cashRows);
  assert.match(notes[0]?.narrative ?? '', /200\.00 AED/);
});

test('prints a handwritten signature placeholder on each primary statement and the notes', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.match(source, /function ReportSignatureBlock\(/);
  assert.match(source, /data-testid="report-signature"/);
  assert.equal((source.match(/<ReportSignatureBlock \/>/g) ?? []).length, 3);
  assert.match(source, /function ReportEquityStatement\(/);
  assert.match(source, /data-testid="report-equity-statement"/);
  assert.match(source, /<ReportEquitySection /);
  assert.match(source, /id="report-statement-notes"[\s\S]*<ReportSignatureBlock \/>/);
  assert.match(css, /\.report-signature-line/);
});