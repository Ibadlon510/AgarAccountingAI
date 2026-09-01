export function normalizeBankName(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function bankRegisterKey(
  bankName: string | null | undefined,
  currency: string,
  fallbackAccountId?: number,
) {
  const bank = normalizeBankName(bankName);
  const code = currency.trim().toUpperCase();
  if (!bank) return fallbackAccountId != null ? `account:${fallbackAccountId}` : `currency:${code || "unknown"}`;
  return `${bank}|${code}`;
}

export function registerKeyForAccount(account: {
  id: number;
  bankName?: string | null;
  currency: string;
}) {
  return bankRegisterKey(account.bankName, account.currency, account.id);
}

export function accountsForRegister<T extends { id: number; bankName?: string | null; currency: string }>(
  accounts: T[],
  accountId: number,
): T[] {
  const current = accounts.find((account) => account.id === accountId);
  if (!current) return [];
  const key = registerKeyForAccount(current);
  return accounts.filter((account) => registerKeyForAccount(account) === key);
}

export type BankRegisterAccount = {
  id: number;
  name: string;
  bankName?: string | null;
  accountNumberLast4?: string | null;
  currency: string;
};

export type BankRegisterLine = {
  id: number;
  date: string;
  description: string;
  amount: number;
  direction: string;
  currency: string;
  bankAccountId?: number | null;
  source?: string;
};

export type BankRegisterGroup<TAccount extends BankRegisterAccount = BankRegisterAccount, TLine extends BankRegisterLine = BankRegisterLine> = {
  key: string;
  canonicalAccount: TAccount;
  accounts: TAccount[];
  bankName: string | null;
  currency: string;
  lines: TLine[];
  sourceLabels: string[];
};

function sourceLabel(line: BankRegisterLine) {
  const source = line.source?.trim() ?? "";
  const imported = source.match(/^Imported:\s*(.+)$/i)?.[1]?.trim();
  return imported || source || null;
}

export function groupBankRegisters<TAccount extends BankRegisterAccount, TLine extends BankRegisterLine>(
  accounts: TAccount[],
  lines: TLine[],
): BankRegisterGroup<TAccount, TLine>[] {
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const groups = new Map<string, BankRegisterGroup<TAccount, TLine>>();

  const ensureGroup = (account: TAccount) => {
    const key = registerKeyForAccount(account);
    const current = groups.get(key);
    if (current) {
      if (!current.accounts.some((item) => item.id === account.id)) current.accounts.push(account);
      return current;
    }
    const created: BankRegisterGroup<TAccount, TLine> = {
      key,
      canonicalAccount: account,
      accounts: [account],
      bankName: account.bankName?.trim() || null,
      currency: account.currency,
      lines: [],
      sourceLabels: [],
    };
    groups.set(key, created);
    return created;
  };

  for (const account of accounts) ensureGroup(account);

  for (const line of lines) {
    const account = line.bankAccountId == null ? undefined : accountsById.get(line.bankAccountId);
    if (!account) continue;
    const group = ensureGroup(account);
    group.lines.push(line);
    const label = sourceLabel(line);
    if (label && !group.sourceLabels.includes(label)) group.sourceLabels.push(label);
  }

  return [...groups.values()].sort((left, right) => {
    const bankCompare = (left.bankName ?? left.canonicalAccount.name).localeCompare(right.bankName ?? right.canonicalAccount.name);
    if (bankCompare !== 0) return bankCompare;
    return left.currency.localeCompare(right.currency);
  });
}

type RegisterImport = {
  outcome?: string;
  bankAccountId?: number | null;
  fileName: string;
  preview?: {
    openingBalance?: number | null;
    lines?: Array<{ date: string }>;
    bankAccount?: { id: number } | null;
    accountGroups?: Array<{
      openingBalance?: number | null;
      bankAccount?: { id: number } | null;
      identity?: { bankName?: string | null; currency?: string };
      lines?: Array<{ date: string }>;
    }>;
  } | null;
};

function importMatchesRegister(statementImport: RegisterImport, accountIds: Set<number>, key: string) {
  if (statementImport.outcome && statementImport.outcome !== "completed") return false;
  if (statementImport.bankAccountId != null && accountIds.has(statementImport.bankAccountId)) return true;
  if (statementImport.preview?.bankAccount?.id != null && accountIds.has(statementImport.preview.bankAccount.id)) return true;
  return (statementImport.preview?.accountGroups ?? []).some((group) => {
    if (group.bankAccount?.id != null && accountIds.has(group.bankAccount.id)) return true;
    if (!group.identity) return false;
    return bankRegisterKey(group.identity.bankName, group.identity.currency ?? "") === key;
  });
}

function openingFromImport(statementImport: RegisterImport, accountIds: Set<number>, key: string) {
  const matchingGroup = (statementImport.preview?.accountGroups ?? []).find((group) => {
    if (group.bankAccount?.id != null && accountIds.has(group.bankAccount.id)) return true;
    if (!group.identity) return false;
    return bankRegisterKey(group.identity.bankName, group.identity.currency ?? "") === key;
  });
  if (matchingGroup?.openingBalance != null) return matchingGroup.openingBalance;
  if (statementImport.bankAccountId != null && accountIds.has(statementImport.bankAccountId)) {
    return statementImport.preview?.openingBalance ?? null;
  }
  if (statementImport.preview?.bankAccount?.id != null && accountIds.has(statementImport.preview.bankAccount.id)) {
    return statementImport.preview.openingBalance ?? null;
  }
  return matchingGroup?.openingBalance ?? null;
}

function earliestDateFromImport(statementImport: RegisterImport, accountIds: Set<number>, key: string) {
  const matchingGroup = (statementImport.preview?.accountGroups ?? []).find((group) => {
    if (group.bankAccount?.id != null && accountIds.has(group.bankAccount.id)) return true;
    if (!group.identity) return false;
    return bankRegisterKey(group.identity.bankName, group.identity.currency ?? "") === key;
  });
  const scopedLines = matchingGroup
    ? matchingGroup.lines ?? []
    : statementImport.preview?.lines ?? [];
  const dates = scopedLines.map((line) => line.date.slice(0, 10)).filter(Boolean).sort();
  return dates[0] ?? null;
}

export function openingBalanceForRegister(
  imports: RegisterImport[],
  accounts: Array<{ id: number; bankName?: string | null; currency: string }>,
): { value: number | null; fileName: string | null } {
  if (!accounts.length) return { value: null, fileName: null };
  const accountIds = new Set(accounts.map((account) => account.id));
  const key = registerKeyForAccount(accounts[0]);
  const ranked = imports
    .filter((statementImport) => importMatchesRegister(statementImport, accountIds, key))
    .map((statementImport) => ({
      statementImport,
      opening: openingFromImport(statementImport, accountIds, key),
      from: earliestDateFromImport(statementImport, accountIds, key) ?? "9999-12-31",
    }))
    .sort((left, right) => left.from.localeCompare(right.from) || left.statementImport.fileName.localeCompare(right.statementImport.fileName));
  const earliest = ranked[0];
  if (!earliest) return { value: null, fileName: null };
  return { value: earliest.opening, fileName: earliest.statementImport.fileName };
}

export function uniqueAccountNumberLast4(accounts: Array<{ accountNumberLast4?: string | null }>) {
  const last4 = [...new Set(accounts.flatMap((account) => account.accountNumberLast4 ? [account.accountNumberLast4] : []))];
  return last4.length === 1 ? last4[0] : null;
}

export function groupBankRegistersFromSummary<TAccount extends BankRegisterAccount>(
  accounts: TAccount[],
  rollups: Array<{
    bankAccountId: number;
    lineCount: number;
    dateFrom: string | null;
    dateTo: string | null;
    sourceLabels: string[];
  }>,
) {
  const byAccount = new Map(rollups.map((item) => [item.bankAccountId, item]));
  return groupBankRegisters(accounts, []).map((group) => {
    const matched = group.accounts.flatMap((account) => {
      const rollup = byAccount.get(account.id);
      return rollup ? [rollup] : [];
    });
    const dates = matched.flatMap((item) => [item.dateFrom, item.dateTo]).filter((value): value is string => Boolean(value)).sort();
    return {
      ...group,
      lineCount: matched.reduce((sum, item) => sum + item.lineCount, 0),
      dateFrom: dates[0] ?? null,
      dateTo: dates[dates.length - 1] ?? null,
      sourceLabels: [...new Set(matched.flatMap((item) => item.sourceLabels))],
    };
  });
}

export function unassignedStatementLines<TLine extends BankRegisterLine>(lines: TLine[]) {
  return lines.filter((line) => line.bankAccountId == null);
}

export function registerHrefForImport(statementImport: {
  bankAccountId?: number | null;
  bankAccount?: { id: number } | null;
  preview?: {
    bankAccount?: { id: number } | null;
    accountGroups?: Array<{ bankAccount?: { id: number } | null }>;
  } | null;
}) {
  if (statementImport.bankAccountId != null) return `/bank-register/${statementImport.bankAccountId}`;
  if (statementImport.bankAccount?.id != null) return `/bank-register/${statementImport.bankAccount.id}`;
  const previewAccountId = statementImport.preview?.bankAccount?.id;
  if (previewAccountId != null) return `/bank-register/${previewAccountId}`;
  const grouped = [...new Set((statementImport.preview?.accountGroups ?? [])
    .flatMap((group) => group.bankAccount?.id == null ? [] : [group.bankAccount.id]))];
  if (grouped.length === 1) return `/bank-register/${grouped[0]}`;
  return "/bank-register";
}

export function registerTitle(account: { name: string; bankName?: string | null; accountNumberLast4?: string | null }) {
  return account.bankName?.trim()
    || account.name
    || (account.accountNumberLast4 ? `Account ending ${account.accountNumberLast4}` : "Bank register");
}
