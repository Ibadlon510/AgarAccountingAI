import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendUniqueStatementFiles,
  findNextStatementQueueIndex,
  type StatementImportQueueItem,
} from '../src/lib/statement-import-queue';

type TestFile = {
  name: string;
  size: number;
  lastModified: number;
};

const file = (name: string, lastModified: number): TestFile => ({
  name,
  size: 1024,
  lastModified,
});

test('keeps multiple statement files in the order they were selected', () => {
  const queue = appendUniqueStatementFiles([], [
    file('january.pdf', 1),
    file('february.csv', 2),
    file('march.xlsx', 3),
  ]);

  assert.deepEqual(queue.map((item) => item.file.name), [
    'january.pdf',
    'february.csv',
    'march.xlsx',
  ]);
  assert.deepEqual(queue.map((item) => item.status), [
    'queued',
    'queued',
    'queued',
  ]);
});

test('does not queue the same browser-selected file twice', () => {
  const january = file('january.pdf', 1);
  const queue = appendUniqueStatementFiles(
    appendUniqueStatementFiles([], [january]),
    [january, file('february.pdf', 2)],
  );

  assert.deepEqual(queue.map((item) => item.file.name), [
    'january.pdf',
    'february.pdf',
  ]);
});

test('advances only to a later queued document after review', () => {
  const queue: StatementImportQueueItem<TestFile>[] = [
    { file: file('january.pdf', 1), status: 'loaded' },
    { file: file('february.pdf', 2), status: 'ready' },
    { file: file('march.pdf', 3), status: 'queued' },
  ];

  assert.equal(findNextStatementQueueIndex(queue, 1), 2);
  assert.equal(findNextStatementQueueIndex(queue, 2), -1);
});

test('keeps failures retryable without jumping ahead automatically', () => {
  const queue: StatementImportQueueItem<TestFile>[] = [
    { file: file('january.pdf', 1), status: 'failed' },
    { file: file('february.pdf', 2), status: 'queued' },
  ];

  assert.equal(findNextStatementQueueIndex(queue), 1);
  assert.equal(findNextStatementQueueIndex(queue, -1, true), 0);
});