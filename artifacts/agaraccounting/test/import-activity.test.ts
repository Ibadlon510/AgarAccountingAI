import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  advanceImportActivitySequence,
  getImportActivitySequenceKey,
  importActivityCopy,
  resetImportActivitySequence,
  type ImportActivityStage,
} from '../src/lib/import-activity';

const stages: ImportActivityStage[] = ['uploading', 'analyzing', 'confirming'];

test('provides a distinct, finite progress sequence for every import stage', () => {
  for (const stage of stages) {
    const messages = importActivityCopy[stage].messages;
    assert.ok(messages.length >= 5);
    assert.equal(new Set(messages).size, messages.length);

    let sequence = { identity: `${stage}:statement.pdf`, index: 0 };
    const seen = [messages[sequence.index]];
    for (let step = 1; step < messages.length + 2; step += 1) {
      sequence = advanceImportActivitySequence(sequence, messages.length);
      seen.push(messages[sequence.index]);
    }

    assert.deepEqual(seen.slice(0, messages.length), messages);
    assert.equal(sequence.index, messages.length - 1);
    assert.equal(seen.at(-1), messages.at(-1));
  }
});

test('resets only when the stage or active document changes', () => {
  const firstKey = getImportActivitySequenceKey('analyzing', '0');
  const sameActivity = { identity: firstKey, index: 3 };

  assert.deepEqual(resetImportActivitySequence(sameActivity, firstKey), sameActivity);
  assert.deepEqual(
    resetImportActivitySequence(sameActivity, getImportActivitySequenceKey('confirming', '0')),
    { identity: 'confirming:0', index: 0 },
  );
  assert.deepEqual(
    resetImportActivitySequence(sameActivity, getImportActivitySequenceKey('analyzing', '1')),
    { identity: 'analyzing:1', index: 0 },
  );
});

test('a sequence with no messages stays safely at its initial index', () => {
  assert.deepEqual(
    advanceImportActivitySequence({ identity: 'uploading:0', index: 2 }, 0),
    { identity: 'uploading:0', index: 0 },
  );
});