export type StatementImportQueueStatus =
  | 'queued'
  | 'analyzing'
  | 'ready'
  | 'loaded'
  | 'failed'
  | 'skipped';

export type StatementImportQueueItem<TFile, TResult = unknown> = {
  file: TFile;
  status: StatementImportQueueStatus;
  message?: string;
  result?: TResult;
};

type StatementFileIdentity = {
  name: string;
  size: number;
  lastModified: number;
};

export const getStatementFileIdentity = (file: StatementFileIdentity) =>
  `${file.name}:${file.size}:${file.lastModified}`;

export function appendUniqueStatementFiles<TFile extends StatementFileIdentity, TResult>(
  queue: StatementImportQueueItem<TFile, TResult>[],
  files: TFile[],
) {
  const identities = new Set(
    queue.map((item) => getStatementFileIdentity(item.file)),
  );
  const additions = files
    .filter((file) => {
      const identity = getStatementFileIdentity(file);
      if (identities.has(identity)) return false;
      identities.add(identity);
      return true;
    })
    .map((file) => ({
      file,
      status: 'queued' as const,
    }));

  return [...queue, ...additions];
}

export function findNextStatementQueueIndex<TFile, TResult>(
  queue: StatementImportQueueItem<TFile, TResult>[],
  afterIndex = -1,
  includeFailed = false,
) {
  return queue.findIndex((item, index) =>
    index > afterIndex
    && (item.status === 'queued' || (includeFailed && item.status === 'failed')),
  );
}