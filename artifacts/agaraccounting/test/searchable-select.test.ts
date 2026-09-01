import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('expanded statement lines use searchable contact and chart-of-accounts pickers', async () => {
  const [app, picker] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/searchable-select.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(picker, /function SearchableSelect\(/);
  assert.match(picker, /PopoverPrimitive\.Portal/);
  assert.match(picker, /searchPlaceholder/);
  assert.match(picker, /role="combobox"/);
  assert.match(picker, /max-h-64 overflow-y-auto/);
  assert.match(picker, /z-\[200\]/);

  assert.match(app, /import \{ SearchableSelect \} from '@\/components\/searchable-select'/);
  assert.match(app, /testId=\{`select-contact-\$\{line\.id\}`\}/);
  assert.match(app, /searchPlaceholder="Search contacts…"/);
  assert.match(app, /testId=\{`select-account-suggestion-\$\{line\.id\}`\}/);
  assert.match(app, /searchPlaceholder="Search accounts…"/);
  assert.doesNotMatch(app, /data-testid=\{`select-contact-\$\{line\.id\}`\}/);
  assert.doesNotMatch(app, /data-testid=\{`select-account-suggestion-\$\{line\.id\}`\}/);
});
