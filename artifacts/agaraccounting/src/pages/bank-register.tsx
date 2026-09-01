import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, CircleAlert, FileText, Landmark, LoaderCircle } from "lucide-react";
import {
  getGetBankAccountsQueryKey,
  getGetStatementImportsQueryKey,
  getGetStatementLinesQueryKey,
  getGetStatementLinesSummaryQueryKey,
  getStatementLines,
  useGetBankAccounts,
  useGetStatementImports,
  useGetStatementLinesSummary,
  useReconcileStatementLineBankAccounts,
} from "@workspace/api-client-react";
import { useClientWorkspace } from "@/lib/workspace-context";
import { BankStatementSheet } from "@/components/bank-statement-sheet";
import {
  accountsForRegister,
  groupBankRegistersFromSummary,
  openingBalanceForRegister,
  registerTitle,
  uniqueAccountNumberLast4,
} from "@/lib/bank-register";

const shortDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const REGISTER_PAGE_SIZE = 200;

export function BankRegisterIndexPage() {
  const { activeClient } = useClientWorkspace();
  const clientId = activeClient?.id ?? 0;
  const enabled = Boolean(activeClient);
  const accountsQuery = useGetBankAccounts({ clientId }, {
    query: { queryKey: getGetBankAccountsQueryKey({ clientId }), enabled },
  });
  const summaryQuery = useGetStatementLinesSummary({ clientId }, {
    query: { queryKey: getGetStatementLinesSummaryQueryKey({ clientId }), enabled },
  });
  const groups = useMemo(
    () => groupBankRegistersFromSummary(accountsQuery.data ?? [], summaryQuery.data?.bankAccounts ?? []),
    [accountsQuery.data, summaryQuery.data],
  );
  const unassignedCount = summaryQuery.data?.unassignedCount ?? 0;
  const loading = accountsQuery.isLoading || summaryQuery.isLoading;
  const error = accountsQuery.isError || summaryQuery.isError;
  const queryClient = useQueryClient();
  const reconcile = useReconcileStatementLineBankAccounts({
    mutation: {
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["/api/agaraccounting/statement-lines"] }),
          queryClient.invalidateQueries({ queryKey: ["/api/agaraccounting/statement-lines/summary"] }),
        ]);
      },
    },
  });

  return (
    <div data-testid="bank-register-index">
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[.19em] text-primary">Bank register</div>
          <h1 className="mt-2 font-display text-[34px] leading-none tracking-tight text-foreground md:text-[42px]">
            Bank registers
          </h1>
          <p className="mt-3 max-w-2xl text-[13px] leading-5 text-muted-foreground">
            One running-balance register for each currency and bank name created on this client. Later uploads join the same register instead of opening a new statement.
          </p>
        </div>
        <Link
          href="/import-statement"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-xs font-semibold text-muted-foreground hover:bg-muted"
        >
          Import statements
        </Link>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle size={14} className="animate-spin" /> Loading registers…
        </div>
      ) : null}
      {error ? (
        <div className="flex flex-col items-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-14 text-center" data-testid="state-error">
          <CircleAlert className="mb-3 text-destructive" size={23} />
          <h3 className="text-sm font-semibold">We couldn&apos;t load bank registers</h3>
          <button type="button" onClick={() => { void accountsQuery.refetch(); void summaryQuery.refetch(); }} className="mt-4 rounded-md bg-card px-3 py-2 text-xs font-semibold shadow-sm hover:bg-muted">
            Try again
          </button>
        </div>
      ) : null}
      {!loading && !error && !groups.length && !unassignedCount ? (
        <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-14 text-center" data-testid="bank-register-empty">
          <Landmark className="mx-auto text-primary" size={24} />
          <h2 className="mt-4 text-sm font-semibold">No bank registers yet</h2>
          <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-muted-foreground">
            Load a statement and confirm its currency and bank name. That created account becomes the register for every later file with the same identity.
          </p>
          <Link href="/import-statement" className="mt-4 inline-flex text-xs font-semibold text-primary underline">Import a statement</Link>
        </div>
      ) : null}
      {groups.length ? (
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          {groups.map((group) => {
            const last4 = uniqueAccountNumberLast4(group.accounts);
            return (
              <Link
                key={group.key}
                href={`/bank-register/${group.canonicalAccount.id}`}
                data-testid={`link-bank-register-${group.canonicalAccount.id}`}
                className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-muted/40"
              >
                <div>
                  <div className="text-sm font-semibold">{registerTitle(group.canonicalAccount)}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {group.bankName || "Bank not identified"} · {group.currency}
                    {last4 ? ` · ending ${last4}` : ""}
                    {` · ${group.lineCount} transaction${group.lineCount === 1 ? "" : "s"}`}
                    {group.sourceLabels.length ? ` · ${group.sourceLabels.length} statement file${group.sourceLabels.length === 1 ? "" : "s"}` : ""}
                  </div>
                  {group.dateFrom && group.dateTo ? (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {shortDate(group.dateFrom)} to {shortDate(group.dateTo)}
                    </div>
                  ) : null}
                </div>
                <span className="rounded-full bg-secondary px-2.5 py-1 font-mono text-[10px] text-primary">{group.currency}</span>
              </Link>
            );
          })}
        </div>
      ) : null}
      {unassignedCount ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-card/50 p-4">
          <div>
            <div className="text-sm font-semibold">Unassigned transactions</div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {unassignedCount} loaded line{unassignedCount === 1 ? "" : "s"} are not in a register. Matching links only currencies that have one clear bank account.
            </p>
            <Link href="/statement-lines" data-testid="link-unassigned-register-lines" className="mt-2 inline-flex text-[11px] font-semibold text-primary underline">
              Review statement lines
            </Link>
          </div>
          <button
            type="button"
            data-testid="button-reconcile-bank-register-lines"
            disabled={reconcile.isPending}
            onClick={() => reconcile.mutate({ data: { clientId } })}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
          >
            {reconcile.isPending ? <LoaderCircle size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            Link matching transactions
          </button>
          {reconcile.isSuccess ? (
            <p className="w-full text-[11px] text-primary" role="status">
              Linked {reconcile.data.linkedCount} transaction{reconcile.data.linkedCount === 1 ? "" : "s"}.
              {reconcile.data.remainingUnassignedCount ? ` ${reconcile.data.remainingUnassignedCount} still need manual review.` : ""}
            </p>
          ) : null}
          {reconcile.isError ? (
            <p className="w-full text-[11px] text-destructive" role="alert">Transactions could not be linked. Try again.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function BankRegisterDetailPage() {
  const [, params] = useRoute("/bank-register/:id");
  const accountId = Number(params?.id);
  const { activeClient } = useClientWorkspace();
  const clientId = activeClient?.id ?? 0;
  const enabled = Boolean(activeClient) && Number.isInteger(accountId) && accountId > 0;
  const accountsQuery = useGetBankAccounts({ clientId }, {
    query: { queryKey: getGetBankAccountsQueryKey({ clientId }), enabled },
  });
  const importsQuery = useGetStatementImports({ clientId }, {
    query: { queryKey: getGetStatementImportsQueryKey({ clientId }), enabled },
  });
  const registerAccounts = useMemo(
    () => accountsForRegister(accountsQuery.data ?? [], accountId),
    [accountId, accountsQuery.data],
  );
  const canonical = registerAccounts.find((account) => account.id === accountId) ?? registerAccounts[0];
  const registerLast4 = uniqueAccountNumberLast4(registerAccounts);
  const registerAccountIds = useMemo(() => registerAccounts.map((account) => account.id), [registerAccounts]);
  const lineAccountIds = registerAccountIds.length ? registerAccountIds : [accountId];
  const bankAccountIds = lineAccountIds.join(",");
  const summaryQuery = useGetStatementLinesSummary({ clientId, bankAccountIds }, {
    query: {
      queryKey: [...getGetStatementLinesSummaryQueryKey({ clientId, bankAccountIds }), "register"],
      enabled,
    },
  });
  const linesQuery = useInfiniteQuery({
    queryKey: [...getGetStatementLinesQueryKey({ clientId, bankAccountId: lineAccountIds[0] }), "register", lineAccountIds],
    enabled,
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) => getStatementLines({
      clientId,
      bankAccountIds,
      sort: "date",
      sortDirection: "asc",
      limit: REGISTER_PAGE_SIZE,
      offset: pageParam,
    }, { signal }),
    getNextPageParam: (lastPage, pages) => lastPage.length === REGISTER_PAGE_SIZE
      ? pages.reduce((count, page) => count + page.length, 0)
      : undefined,
  });
  const lines = linesQuery.data?.pages.flat() ?? [];
  const totalCount = summaryQuery.data?.totalCount ?? 0;
  const opening = useMemo(
    () => openingBalanceForRegister(importsQuery.data ?? [], registerAccounts),
    [importsQuery.data, registerAccounts],
  );
  const [openingValue, setOpeningValue] = useState<string | null>(null);
  useEffect(() => {
    setOpeningValue(null);
  }, [accountId]);
  const sourceNote = useMemo(() => {
    const files = [...new Set(lines.flatMap((line) => {
      const imported = line.source.match(/^Imported:\s*(.+)$/i)?.[1]?.trim();
      return imported ? [imported] : [];
    }))];
    if (!files.length) return null;
    return files.length === 1
      ? `Loaded from ${files[0]}`
      : `${files.length} statement files combined`;
  }, [lines]);

  if (!Number.isInteger(accountId) || accountId <= 0) {
    return (
      <div data-testid="bank-register-missing">
        <p className="text-sm text-muted-foreground">This bank register link is not valid.</p>
        <Link href="/bank-register" className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-primary">
          <ArrowLeft size={14} /> Back to registers
        </Link>
      </div>
    );
  }

  const loading = accountsQuery.isLoading || linesQuery.isLoading || importsQuery.isLoading || summaryQuery.isLoading;
  const error = accountsQuery.isError || linesQuery.isError || importsQuery.isError || summaryQuery.isError;
  const missingAccount = !loading && !error && !canonical;
  const openingFound = opening.value != null;
  const resolvedOpening = openingValue ?? (openingFound ? String(opening.value) : "0");

  return (
    <div data-testid="bank-register-display">
      <div className="bank-statement-toolbar mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[.19em] text-primary">Bank register</div>
          <h1 className="mt-2 font-display text-[34px] leading-none tracking-tight text-foreground md:text-[42px]">
            {canonical ? registerTitle(canonical) : "Bank register"}
          </h1>
          <p className="mt-3 max-w-2xl text-[13px] leading-5 text-muted-foreground">
            All loaded transactions for {canonical?.bankName || "this bank"} · {canonical?.currency ?? "currency"}, regardless of how many statement files were uploaded.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/bank-register"
            data-testid="link-back-to-bank-registers"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-xs font-semibold text-muted-foreground hover:bg-muted"
          >
            <ArrowLeft size={14} /> All registers
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground"
          >
            <FileText size={14} /> Print
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle size={14} className="animate-spin" /> Loading register…
        </div>
      ) : null}
      {error ? (
        <div className="flex flex-col items-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-14 text-center" data-testid="state-error">
          <CircleAlert className="mb-3 text-destructive" size={23} />
          <h3 className="text-sm font-semibold">We couldn&apos;t load this register</h3>
          <button type="button" onClick={() => { void accountsQuery.refetch(); void linesQuery.refetch(); void importsQuery.refetch(); void summaryQuery.refetch(); }} className="mt-4 rounded-md bg-card px-3 py-2 text-xs font-semibold shadow-sm hover:bg-muted">
            Try again
          </button>
        </div>
      ) : null}
      {missingAccount ? (
        <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-14 text-center" data-testid="bank-register-empty">
          <Landmark className="mx-auto text-primary" size={24} />
          <h2 className="mt-4 text-sm font-semibold">This bank account is not in the current client</h2>
          <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-muted-foreground">
            Switch workspace or import a statement that creates this bank name and currency.
          </p>
        </div>
      ) : null}
      {!loading && !error && canonical && !lines.length ? (
        <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-14 text-center" data-testid="bank-register-no-lines">
          <FileText className="mx-auto text-primary" size={24} />
          <h2 className="mt-4 text-sm font-semibold">No transactions in this register</h2>
          <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-muted-foreground">
            Import another statement for {canonical.bankName || canonical.name} · {canonical.currency} to add rows here.
          </p>
          <Link href="/import-statement" className="mt-4 inline-flex text-xs font-semibold text-primary underline">Import a statement</Link>
        </div>
      ) : null}

      {canonical && lines.length ? (
        <>
          <BankStatementSheet
            clientName={activeClient?.name ?? "Client"}
            fileName={`${canonical.bankName || canonical.name} ${canonical.currency}`}
            section={{
              id: String(canonical.id),
              title: registerTitle(canonical),
              bankName: canonical.bankName ?? null,
              accountNumberLast4: registerLast4,
              currency: canonical.currency,
              parsedOpening: opening.value,
              lines,
              sourceNote,
              kind: "register",
              openingSource: opening.fileName,
            }}
            openingValue={resolvedOpening}
            openingFound={openingFound}
            onOpeningChange={setOpeningValue}
          />
          {lines.length < totalCount ? (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-[11px] text-muted-foreground print:hidden">
              <span>Showing {lines.length} of {totalCount} transactions</span>
              <button
                type="button"
                data-testid="button-load-more-register-lines"
                disabled={linesQuery.isFetchingNextPage}
                onClick={() => void linesQuery.fetchNextPage()}
                className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
              >
                {linesQuery.isFetchingNextPage ? "Loading…" : "Load more"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
