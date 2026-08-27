export type ImportActivityStage = 'uploading' | 'analyzing' | 'confirming';

export type ImportActivityCopy = {
  title: string;
  messages: string[];
  step: string;
};

export const IMPORT_ACTIVITY_MESSAGE_DELAY_MS = 3200;

export const importActivityCopy: Record<ImportActivityStage, ImportActivityCopy> = {
  uploading: {
    title: 'Securing the source document',
    step: 'Stage 1 of 3',
    messages: [
      'Preparing a private copy of the original statement.',
      'Keeping the source file attached so every row can be traced back.',
      'Checking that the upload is complete before analysis starts.',
      'Preserving the original evidence exactly as received.',
      'The source is safe; the upload is taking a little longer than expected.',
    ],
  },
  analyzing: {
    title: 'Giving the statement a careful first pass',
    step: 'Stage 2 of 3',
    messages: [
      'Looking for the statement header, columns, and reporting period.',
      'Reading dates, descriptions, and money movements from the bank layout.',
      'Normalizing each row without changing the source amounts.',
      'Checking currency and debit or credit direction before review.',
      'The statement is taking a little longer; finishing the careful checks.',
    ],
  },
  confirming: {
    title: 'Loading your confirmed lines',
    step: 'Stage 3 of 3',
    messages: [
      'Applying only the rows and currency you approved.',
      'Linking each loaded line back to its original statement.',
      'Keeping the confirmed lines together in this client’s review queue.',
      'Refreshing the review handoff so nothing approved is missed.',
      'Your confirmed lines are taking a little longer; finishing the handoff.',
    ],
  },
};

export type ImportActivitySequenceState = {
  identity: string;
  index: number;
};

export function resetImportActivitySequence(
  state: ImportActivitySequenceState,
  identity: string,
): ImportActivitySequenceState {
  return state.identity === identity ? state : { identity, index: 0 };
}

export function advanceImportActivitySequence(
  state: ImportActivitySequenceState,
  messageCount: number,
): ImportActivitySequenceState {
  if (messageCount <= 0) return { ...state, index: 0 };
  return {
    ...state,
    index: Math.min(state.index + 1, messageCount - 1),
  };
}

export function getImportActivitySequenceKey(
  stage: ImportActivityStage,
  documentKey: string,
) {
  return `${stage}:${documentKey}`;
}