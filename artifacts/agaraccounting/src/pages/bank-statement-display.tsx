import { useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft, CircleAlert, FileText, LoaderCircle } from "lucide-react";
import {
  getGetStatementImportsQueryKey,
  getGetStatementLinesQueryKey,
  useGetStatementImports,
  useGetStatementLines,
  type StatementImport,
  type StatementImportAccountGroup,
  type StatementLine,
} from "@workspace/api-client-react";
import { useClientWorkspace } from "@/lib/workspace-context";
import { type BankStatementDisplayLine } from "@/lib/bank-statement-display";
import { BankStatementSheet, type BankStatementSheetSection } from "@/components/bank-statement-sheet";
import { registerHrefForImport } from "@/lib/bank-register";

function asDisplayLines(lines: Array<Pick<StatementLine, "id" | "date" | "description" | "amount" | "direction" | "currency">>): BankStatementDisplayLine[] {
  return lines.map((line) => ({
    id: line.id,
    date: line.date,
    description: line.description,
    amount: line.amount,
    direction: line.direction,
    currency: line.currency,
  }));
}

function sectionsFromImport(statementImport: StatementImport, loadedLines: StatementLine[] | undefined): BankStatementSheetSection[] {
  const preview = statementImport.preview;
  const groups = preview?.accountGroups?.filter((group) => group.lines.length > 0) ?? [];
  if (groups.length > 1) {
    return groups.map((group) => sectionFromGroup(group, preview?.detectedCurrency ?? statementImport.detectedCurrency, preview?.openingBalance));
  }
  if (groups.length === 1) {
    return [sectionFromGroup(groups[0], preview?.detectedCurrency ?? statementImport.detectedCurrency, preview?.openingBalance)];
  }
  const previewLines = preview?.lines?.length ? preview.lines : loadedLines ?? [];
  const first = previewLines[0];
  const account = preview?.bankAccount;
  return [{
    id: "statement",
    title: account?.name
      || (account?.accountNumberLast4 ? `Account ending ${account.accountNumberLast4}` : statementImport.fileName),
    bankName: account?.bankName ?? null,
    accountNumberLast4: account?.accountNumberLast4 ?? null,
    currency: first?.currency ?? preview?.detectedCurrency ?? statementImport.detectedCurrency ?? "AED",
    parsedOpening: preview?.openingBalance ?? null,
    lines: asDisplayLines(previewLines),
  }];
}

function sectionFromGroup(
  group: StatementImportAccountGroup,
  fallbackCurrency: string | null | undefined,
  fallbackOpening: number | null | undefined,
): BankStatementSheetSection {
  const identity = group.identity;
  return {
    id: group.id,
    title: identity.name
      || group.bankAccount?.name
      || (identity.accountNumberLast4 ? `Account ending ${identity.accountNumberLast4}` : "Bank account"),
    bankName: identity.bankName ?? group.bankAccount?.bankName ?? null,
    accountNumberLast4: identity.accountNumberLast4 ?? group.bankAccount?.accountNumberLast4 ?? null,
    currency: identity.currency || group.bankAccount?.currency || group.lines[0]?.currency || fallbackCurrency || "AED",
    parsedOpening: group.openingBalance ?? fallbackOpening ?? null,
    lines: asDisplayLines(group.lines),
  };
}

export default function BankStatementDisplayPage() {
  const [, params] = useRoute("/import-statement/:id");
  const importId = Number(params?.id);
  const { activeClient } = useClientWorkspace();
  const clientId = activeClient?.id ?? 0;
  const importsQuery = useGetStatementImports({ clientId }, {
    query: {
      queryKey: getGetStatementImportsQueryKey({ clientId }),
      enabled: Boolean(activeClient) && Number.isInteger(importId) && importId > 0,
    },
  });
  const statementImport = importsQuery.data?.find((item) => item.id === importId);
  const needsLoadedLines = Boolean(statementImport)
    && !(statementImport?.preview?.lines?.length)
    && (statementImport?.importedLineCount ?? 0) > 0;
  const linesQuery = useGetStatementLines({ clientId, statementImportId: importId }, {
    query: {
      queryKey: getGetStatementLinesQueryKey({ clientId, statementImportId: importId }),
      enabled: Boolean(activeClient) && needsLoadedLines,
    },
  });
  const sections = useMemo(
    () => (statementImport ? sectionsFromImport(statementImport, linesQuery.data) : []),
    [linesQuery.data, statementImport],
  );
  const [openingValues, setOpeningValues] = useState<Record<string, string>>({});
  const registerHref = registerHrefForImport(statementImport ?? {});

  if (!Number.isInteger(importId) || importId <= 0) {
    return (
      <div data-testid="bank-statement-missing">
        <p className="text-sm text-muted-foreground">This statement link is not valid.</p>
        <Link href="/import-statement" className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-primary">
          <ArrowLeft size={14} /> Back to import
        </Link>
      </div>
    );
  }

  const loading = importsQuery.isLoading || (needsLoadedLines && linesQuery.isLoading);
  const error = importsQuery.isError || (needsLoadedLines && linesQuery.isError);
  const empty = !loading && !error && (!statementImport || !sections.some((section) => section.lines.length));

  return (
    <div data-testid="bank-statement-display">
      <div className="bank-statement-toolbar mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[.19em] text-primary">Import / source document</div>
          <h1 className="mt-2 font-display text-[34px] leading-none tracking-tight text-foreground md:text-[42px]">
            Uploaded statement
          </h1>
          <p className="mt-3 max-w-2xl text-[13px] leading-5 text-muted-foreground">
            Transactions from {statementImport?.fileName ?? "this import"} only. The bank register combines every loaded file for the same currency and bank name.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/import-statement"
            data-testid="link-back-to-import-statement"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-xs font-semibold text-muted-foreground hover:bg-muted"
          >
            <ArrowLeft size={14} /> Back to import
          </Link>
          {statementImport?.outcome === "completed" ? (
            <Link
              href={registerHref}
              data-testid="link-open-bank-register-from-file"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-primary/30 px-4 text-xs font-semibold text-primary hover:bg-primary/5"
            >
              Open bank register
            </Link>
          ) : null}
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
          <LoaderCircle size={14} className="animate-spin" /> Loading statement…
        </div>
      ) : null}
      {error ? (
        <div className="flex flex-col items-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-14 text-center" data-testid="state-error">
          <CircleAlert className="mb-3 text-destructive" size={23} />
          <h3 className="text-sm font-semibold">We couldn&apos;t load this statement</h3>
          <button type="button" onClick={() => { void importsQuery.refetch(); void linesQuery.refetch(); }} className="mt-4 rounded-md bg-card px-3 py-2 text-xs font-semibold shadow-sm hover:bg-muted">
            Try again
          </button>
        </div>
      ) : null}
      {empty ? (
        <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-14 text-center" data-testid="bank-statement-empty">
          <FileText className="mx-auto text-primary" size={24} />
          <h2 className="mt-4 text-sm font-semibold">No transactions to display</h2>
          <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-muted-foreground">
            This import does not have a saved preview or loaded statement lines yet.
          </p>
        </div>
      ) : null}

      <div className="space-y-8">
        {sections.filter((section) => section.lines.length).map((section) => {
          const openingFound = section.parsedOpening != null;
          const openingValue = openingValues[section.id]
            ?? (openingFound ? String(section.parsedOpening) : "0");
          return (
            <BankStatementSheet
              key={section.id}
              clientName={activeClient?.name ?? "Client"}
              fileName={statementImport?.fileName ?? "Statement"}
              section={section}
              openingValue={openingValue}
              openingFound={openingFound}
              onOpeningChange={(value) => setOpeningValues((current) => ({ ...current, [section.id]: value }))}
            />
          );
        })}
      </div>
    </div>
  );
}
