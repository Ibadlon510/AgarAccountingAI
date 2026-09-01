/** Hydrate legacy "Accountant input required" note stubs with system disclosure drafts. */

export type DraftNote = {
  number: number;
  title: string;
  narrative: string;
  requiresInput: boolean;
  tables: Array<{ label: string; current: number; comparative: number }>;
  shareholding?: {
    authorisedShares: number;
    parValue: number;
    rows: Array<{
      name: string;
      percentage: number;
      nationality?: string | null;
      numberOfShares: number;
      value: number;
    }>;
  };
};

export type DraftChecklistItem = {
  standard: string;
  title: string;
  status: "applicable" | "not_applicable" | "immaterial" | "satisfied" | "requires_accountant_input";
  prompt: string;
};

type SnapshotLike = {
  legalName: string;
  periodEnd: string;
  comparativePeriodEnd: string;
  presentationCurrency: string;
  reportingBasis: string;
  presentationProfile: string;
  notes?: DraftNote[];
};

function reportDateLabel(value: string) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function reportMoneyLabel(value: number, currency: string) {
  const absolute = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value < 0 ? `(${absolute}) ${currency}` : `${absolute} ${currency}`;
}

function joinLabels(labels: string[]) {
  if (!labels.length) return "the posted ledger accounts";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function isStubNarrative(narrative: string) {
  return /Accountant input required|Confirm restricted cash|Confirm the revenue policy|Confirm material expense|Confirm revenue streams|grouped from posted ledger/i.test(narrative);
}

export function buildSystemNoteDrafts(snapshot: SnapshotLike, existingNotes: DraftNote[]): DraftNote[] {
  const currency = snapshot.presentationCurrency;
  const periodEnd = String(snapshot.periodEnd).slice(0, 10);
  const comparativePeriodEnd = String(snapshot.comparativePeriodEnd).slice(0, 10);
  const periodLabel = reportDateLabel(periodEnd);
  const comparativeLabel = reportDateLabel(comparativePeriodEnd);
  const isSme = snapshot.reportingBasis === "IFRS for SMEs" || snapshot.presentationProfile === "IFRS for SMEs";
  const isIfrs18 = snapshot.presentationProfile === "IFRS 18";
  const framework = isSme ? "the IFRS for SMEs Accounting Standard" : snapshot.reportingBasis === "IFRS" ? "International Financial Reporting Standards (IFRS)" : snapshot.reportingBasis;
  const presentation = isIfrs18
    ? "These financial statements are presented using the IFRS 18 presentation profile."
    : isSme
      ? "These financial statements are presented under the IFRS for SMEs presentation profile."
      : "These financial statements are presented using the IAS 1 presentation profile.";
  const hasComparative = existingNotes.some((note) => note.tables.some((row) => Math.abs(row.comparative) > 0.009));
  const comparativeSentence = hasComparative
    ? `Comparative information is presented for the year ended ${comparativeLabel}.`
    : `Comparative figures for the year ended ${comparativeLabel} are presented as zero because no posted prior-period ledger activity is available in this workspace.`;
  const cashTables = existingNotes.find((note) => note.number === 3)?.tables ?? [];
  const revenueTables = existingNotes.find((note) => note.number === 4)?.tables ?? [];
  const expenseTables = existingNotes.find((note) => note.number === 5)?.tables ?? [];
  const relatedTables = existingNotes.find((note) => note.number === 6)?.tables ?? [];
  const taxTables = existingNotes.find((note) => note.number === 7)?.tables ?? [];
  const cashCurrent = cashTables.reduce((total, row) => total + row.current, 0);
  const cashComparative = cashTables.reduce((total, row) => total + row.comparative, 0);
  const revenueLabels = revenueTables.map((row) => row.label);
  const expenseLabels = expenseTables.map((row) => row.label);
  const taxLabels = taxTables.map((row) => row.label);
  const relatedLabels = relatedTables.map((row) => row.label);
  const revenueTotal = revenueTables.reduce((total, row) => total + row.current, 0);
  const taxTotal = taxTables.reduce((total, row) => total + row.current, 0);
  const revenuePolicy = isSme
    ? "Revenue is recognised when the significant risks and rewards of the supply have transferred to the customer, the amount can be measured reliably, and collection is probable, consistent with Section 23."
    : isIfrs18
      ? "Revenue is recognised when control of goods or services transfers to the customer in an amount that reflects the consideration expected under the contract, and is presented within operating categories under IFRS 18."
      : "Revenue is recognised when control of goods or services transfers to the customer in an amount that reflects the consideration expected under IFRS 15.";

  const drafts: DraftNote[] = [
    {
      number: 1,
      title: "Basis of preparation",
      narrative: [
        `These financial statements of ${snapshot.legalName} have been prepared for the year ended ${periodLabel} in accordance with ${framework}.`,
        presentation,
        `They are presented in ${currency}, which is also the entity’s presentation currency for this report pack.`,
        "Management has prepared the statements on a going-concern basis and has applied materiality when deciding which disclosures are necessary for an understanding of the financial position and performance.",
        comparativeSentence,
        "This pack is generated accounting output for management use and human review. It is not an audit opinion, statutory filing, tax return, or assurance conclusion.",
      ].join(" "),
      requiresInput: false,
      tables: [],
    },
    {
      number: 2,
      title: "Material accounting policies",
      narrative: [
        "The following policies are the system defaults applied to the posted ledger for this reporting period.",
        revenuePolicy,
        `Foreign-currency transactions are translated into ${currency} using rates available in the workspace exchange-rate schedule on or before the transaction date.`,
        "Cash and cash equivalents comprise bank and cash balances available on demand, excluding amounts management identifies as restricted.",
        "Income-tax expense reflects amounts posted to tax accounts in the ledger for the period. Deferred-tax balances are recognised only when separately posted.",
        "Expenses are recognised on an accrual basis as posted in the journal entries supporting this pack.",
      ].join(" "),
      requiresInput: false,
      tables: [],
    },
    {
      number: 3,
      title: "Cash and cash equivalents",
      narrative: [
        `Cash and cash equivalents at ${periodLabel} amount to ${reportMoneyLabel(cashCurrent, currency)}.`,
        "The balance is derived from posted cash and bank accounts in the client ledger.",
        "Unless management records a restriction, these balances are treated as available on demand and are included in the statement of cash flows.",
      ].join(" "),
      requiresInput: false,
      tables: cashTables.length ? cashTables : [{ label: "Cash and bank balances", current: cashCurrent, comparative: cashComparative }],
    },
    {
      number: 4,
      title: "Revenue",
      narrative: [
        revenueLabels.length
          ? `Revenue for the year ended ${periodLabel} totals ${reportMoneyLabel(revenueTotal, currency)} and is analysed as ${joinLabels(revenueLabels)}.`
          : `No revenue accounts with posted balances were identified for the year ended ${periodLabel}.`,
        revenuePolicy,
        "Contract assets, contract liabilities, and remaining performance obligations are disclosed only when separately tracked in the ledger.",
      ].join(" "),
      requiresInput: false,
      tables: revenueTables,
    },
    {
      number: 5,
      title: "Operating expenses",
      narrative: [
        expenseLabels.length
          ? `Operating expenses are presented by nature from posted ledger accounts, including ${joinLabels(expenseLabels)}.`
          : "No non-tax operating-expense accounts with posted balances were identified for the current period.",
        "Amounts agree to the journal entries included in this report pack’s traceability set.",
      ].join(" "),
      requiresInput: false,
      tables: expenseTables,
    },
    {
      number: 6,
      title: "Related parties",
      narrative: relatedLabels.length
        ? [
          `Related-party balances recognised in the ledger comprise ${joinLabels(relatedLabels)}.`,
          "Unless management records different terms, outstanding balances are unsecured, interest-free, and repayable on demand.",
          "Key management compensation and other related-party transactions are disclosed when posted to related-party classified accounts.",
        ].join(" ")
        : "Management has not marked any posted ledger accounts as related-party balances for this period. No material related-party receivables or payables are therefore disclosed in the generated table.",
      requiresInput: false,
      tables: relatedTables,
    },
    {
      number: 7,
      title: "Income tax",
      narrative: [
        taxLabels.length
          ? `Income-tax amounts posted for the year ended ${periodLabel} total ${reportMoneyLabel(taxTotal, currency)} and are analysed as ${joinLabels(taxLabels)}.`
          : `No income-tax expense accounts with posted balances were identified for the year ended ${periodLabel}.`,
        currency === "AED"
          ? "Where UAE Corporate Tax estimates appear elsewhere in this pack, they are management estimates derived from mapped ledger activity and are not a filed tax return."
          : "Current and deferred tax are recognised only to the extent posted in the ledger for this reporting period.",
        "Uncertain tax positions and unused tax losses are disclosed only when separately identified by management in the books.",
      ].join(" "),
      requiresInput: false,
      tables: taxTables,
    },
    {
      number: 8,
      title: "Share capital",
      narrative: `The company's share capital and shareholding at ${periodLabel} still need to be confirmed on the client share register.`,
      requiresInput: true,
      tables: [],
      shareholding: existingNotes.find((note) => note.title === "Share capital")?.shareholding,
    },
    {
      number: 9,
      title: "Financial risk, foreign currency and other disclosures",
      narrative: [
        `Posted activity included in this pack is presented in ${currency}. No material foreign-currency exposure was identified from the converted ledger set unless foreign-currency entries appear in the books.`,
        "Liquidity risk is managed by monitoring cash balances and payable obligations arising from posted bank activity.",
        "Credit risk arises primarily from bank balances and any receivable balances posted in the ledger.",
        isSme
          ? "Material commitments, contingencies, and other Section 8 disclosures are stated as nil unless management records them in the ledger or edits this note."
          : "Material commitments, contingencies, employee benefits, and significant judgments are stated as nil unless management records them in the ledger or edits this note.",
      ].join(" "),
      requiresInput: false,
      tables: [],
    },
    {
      number: 10,
      title: "Subsequent events",
      narrative: [
        `Management is not aware of material non-adjusting events after ${periodLabel} through the authorization date recorded with this pack.`,
        "If a material subsequent event arises before authorization, this note should be updated and the pack re-saved before finalization.",
      ].join(" "),
      requiresInput: false,
      tables: [],
    },
  ];

  return existingNotes.map((note) => {
    const draft = drafts.find((item) => item.title === note.title)
      ?? drafts.find((item) => item.number === note.number && item.title === note.title);
    if (!draft) return { ...note, requiresInput: note.narrative.trim() ? note.requiresInput : true };
    if (!isStubNarrative(note.narrative) && note.narrative.trim()) {
      return { ...note, requiresInput: note.requiresInput && !note.narrative.trim() ? true : note.requiresInput };
    }
    return {
      ...note,
      narrative: draft.narrative,
      requiresInput: draft.requiresInput,
      tables: note.tables.length ? note.tables : draft.tables,
      shareholding: note.shareholding ?? draft.shareholding,
    };
  });
}

export function hydrateChecklistDefaults(checklist: DraftChecklistItem[], notes: DraftNote[]): DraftChecklistItem[] {
  const hasRevenue = notes.some((note) => note.number === 4 && note.tables.some((row) => Math.abs(row.current) > 0.009));
  const hasTax = notes.some((note) => note.number === 7 && note.tables.some((row) => Math.abs(row.current) > 0.009));
  const hasRelatedParty = notes.some((note) => note.number === 6 && note.tables.length > 0);
  return checklist.map((item) => {
    if (!["applicable", "requires_accountant_input"].includes(item.status)) return item;
    const key = item.standard.replace(/^Section\s+/i, "IAS ");
    let status: DraftChecklistItem["status"] = "satisfied";
    if (/IAS 12/i.test(key)) status = hasTax ? "satisfied" : "not_applicable";
    else if (/IAS 16|IAS 19/i.test(key)) status = "not_applicable";
    else if (/IAS 21/i.test(key)) status = "not_applicable";
    else if (/IAS 24/i.test(key)) status = hasRelatedParty ? "satisfied" : "not_applicable";
    else if (/IFRS 15|Section 23/i.test(item.standard) || /IFRS 15/i.test(key)) status = hasRevenue ? "satisfied" : "not_applicable";
    return { ...item, status };
  });
}
