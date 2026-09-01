import {
  buildBankStatementRows,
  statementPeriod,
  type BankStatementDisplayLine,
} from "@/lib/bank-statement-display";

const money = (value: number, currency = "AED") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);

const shortDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

function parseOpeningInput(value: string, fallback: number) {
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

export type BankStatementSheetSection = {
  id: string;
  title: string;
  bankName: string | null;
  accountNumberLast4: string | null;
  currency: string;
  parsedOpening: number | null;
  lines: BankStatementDisplayLine[];
  sourceNote?: string | null;
  kind?: "file" | "register";
  openingSource?: string | null;
};

export function BankStatementSheet({
  clientName,
  fileName,
  section,
  openingValue,
  onOpeningChange,
  openingFound,
}: {
  clientName: string;
  fileName: string;
  section: BankStatementSheetSection;
  openingValue: string;
  onOpeningChange: (value: string) => void;
  openingFound: boolean;
}) {
  const opening = parseOpeningInput(openingValue, section.parsedOpening ?? 0);
  const rows = buildBankStatementRows(section.lines, opening);
  const period = statementPeriod(section.lines);

  return (
    <article className="bank-statement-sheet" data-testid={`bank-statement-sheet-${section.id}`}>
      <header className="bank-statement-cover">
        <div className="font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">{section.kind === "register" ? "Bank register" : "Account statement"}</div>
        <h2 className="mt-6 font-display text-4xl leading-none">{clientName}</h2>
        <p className="mt-4 text-sm font-semibold">{section.title}</p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {[section.bankName, section.accountNumberLast4 ? `••••${section.accountNumberLast4}` : null, section.currency]
            .filter(Boolean)
            .join(" · ") || fileName}
        </p>
        {section.sourceNote ? <p className="mt-1 text-[12px] text-muted-foreground">{section.sourceNote}</p> : null}
        {period ? (
          <p className="mt-5 text-[12px]">
            Statement period {shortDate(period.from)} to {shortDate(period.to)}
          </p>
        ) : (
          <p className="mt-5 text-[12px] text-muted-foreground">No dated transactions on this register.</p>
        )}
        <div className="bank-statement-opening-control mt-6 print:hidden">
          <label className="text-[11px] font-semibold">
            Opening balance
            <input
              data-testid={`input-statement-opening-${section.id}`}
              type="text"
              inputMode="decimal"
              value={openingValue}
              onChange={(event) => onOpeningChange(event.target.value)}
              className="mt-1 block h-9 w-full max-w-[14rem] rounded-md border border-input bg-background px-3 font-mono text-xs outline-none focus:border-primary"
            />
          </label>
          {!openingFound ? (
            <p className="mt-2 max-w-md text-[11px] leading-5 text-muted-foreground">
              Opening balance was not found on the earliest source document. Running balances start at 0 until you enter the figure from the paper statement.
            </p>
          ) : section.openingSource ? (
            <p className="mt-2 max-w-md text-[11px] leading-5 text-muted-foreground">
              Opening taken from {section.openingSource}. Later statement files continue this running balance.
            </p>
          ) : null}
        </div>
      </header>
      <div className="overflow-x-auto px-[42px] pb-10 max-sm:px-[18px]">
        <table className="bank-statement-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th className="text-right">Money out</th>
              <th className="text-right">Money in</th>
              <th className="text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.kind}-${row.lineId ?? index}`} data-kind={row.kind}>
                <td className="font-mono">{row.date ? shortDate(row.date) : ""}</td>
                <td>{row.description}</td>
                <td className="text-right font-mono tabular-nums">
                  {row.moneyOut == null ? "" : money(row.moneyOut, section.currency)}
                </td>
                <td className="text-right font-mono tabular-nums">
                  {row.moneyIn == null ? "" : money(row.moneyIn, section.currency)}
                </td>
                <td className="text-right font-mono tabular-nums">{money(row.balance, section.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
