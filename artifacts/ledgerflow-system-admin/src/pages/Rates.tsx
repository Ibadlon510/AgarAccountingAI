import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useGetSystemRates, 
  useCreateSystemRate, 
  useUpdateSystemRate, 
  useDeleteSystemRate,
  useImportSystemRates,
  useParseSystemRates,
  getGetSystemRatesQueryKey,
  getGetSystemRateDashboardQueryKey
} from "@workspace/api-client-react";
import type { ExchangeRateInput, ExchangeRateParseResult, SystemRate } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Upload, Trash2, Edit2, Search } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

const rateSchema = z.object({
  sourceCurrency: z.string().min(3).max(3).toUpperCase(),
  functionalCurrency: z.string().min(3).max(3).toUpperCase(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  rate: z.coerce.number().positive(),
  source: z.string().optional(),
  note: z.string().optional(),
});

type RateFormValues = z.infer<typeof rateSchema>;
const DEFAULT_FUNCTIONAL_CURRENCY = "AED";

function csvHeaderKey(value: string) {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[^a-z]/g, "");
}

function readCsvRecords(content: string) {
  const normalized = content.replace(/^\uFEFF/, "");
  const delimiterSample = normalized.split(/\r?\n/).slice(0, 12).join("\n");
  const delimiter = [",", ";", "\t"].reduce((best, candidate) => {
    const count = [...delimiterSample].filter((character) => character === candidate).length;
    return count > best.count ? { value: candidate, count } : best;
  }, { value: ",", count: -1 }).value;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    const next = normalized[index + 1];
    if (character === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function deterministicSystemRates(content: string, defaultFunctionalCurrency: string): ExchangeRateInput[] {
  const rows = readCsvRecords(content);
  const headerIndex = rows.findIndex((row) => row.some((cell) => [
    "effectivedate", "date", "asof", "valuedate", "ratedate",
    "sourcecurrency", "fromcurrency", "functionalcurrency", "tocurrency", "rate",
    "exchangerate", "closingrate",
  ].includes(csvHeaderKey(cell))));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map(csvHeaderKey);
  const valueAt = (cells: string[], names: string[]) => {
    const index = headers.findIndex((header) => names.includes(header));
    return index < 0 ? "" : (cells[index] ?? "").trim();
  };
  return rows.slice(headerIndex + 1).map((cells) => ({
    effectiveDate: valueAt(cells, ["effectivedate", "date", "asof", "valuedate", "ratedate"]),
    sourceCurrency: valueAt(cells, ["sourcecurrency", "fromcurrency", "basecurrency", "currencyfrom"]).toUpperCase(),
    functionalCurrency: (
      valueAt(cells, ["functionalcurrency", "tocurrency", "targetcurrency", "quotecurrency"])
      || defaultFunctionalCurrency
    ).toUpperCase(),
    rate: Number(valueAt(cells, ["rate", "exchangerate", "closingrate", "midrate"]).replaceAll(",", "")),
    source: valueAt(cells, ["ratesource", "provider", "publisher", "source"]) || "Imported CSV",
    note: valueAt(cells, ["note", "memo", "comment"]) || null,
  })).filter((rate) => /^\d{4}-\d{2}-\d{2}$/.test(rate.effectiveDate)
    && /^[A-Z]{3}$/.test(rate.sourceCurrency)
    && /^[A-Z]{3}$/.test(rate.functionalCurrency)
    && Number.isFinite(rate.rate)
    && rate.rate > 0);
}

function mostCommonFunctionalCurrency(rates: SystemRate[]) {
  const counts = new Map<string, number>();
  for (const rate of rates) {
    counts.set(rate.functionalCurrency, (counts.get(rate.functionalCurrency) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "";
}

async function fileAsBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunkSize = 0x6000;
  let base64 = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    base64 += btoa(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
  }
  return base64;
}

export default function Rates() {
  const { data: rates, isLoading } = useGetSystemRates();
  const [searchTerm, setSearchTerm] = useState("");

  const filteredRates = rates?.filter(r => 
    r.sourceCurrency.toLowerCase().includes(searchTerm.toLowerCase()) || 
    r.functionalCurrency.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="p-8 max-w-7xl mx-auto w-full space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">System Rates</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage global fallback exchange rates available to all tenants.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ImportRatesDialog defaultFunctionalCurrency={mostCommonFunctionalCurrency(rates ?? []) || DEFAULT_FUNCTIONAL_CURRENCY} />
          <RateDialog mode="create" />
        </div>
      </div>

      <Card>
        <div className="p-4 border-b border-border/50 flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Filter by currency..." 
              className="pl-9 bg-muted/50"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="text-sm text-muted-foreground font-mono">
            {filteredRates.length} {filteredRates.length === 1 ? 'record' : 'records'}
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pair</TableHead>
              <TableHead>Effective Date</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Note</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  Loading rates...
                </TableCell>
              </TableRow>
            ) : filteredRates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No rates found.
                </TableCell>
              </TableRow>
            ) : (
              filteredRates.map((rate) => (
                <TableRow key={rate.id}>
                  <TableCell className="font-mono font-medium">
                    {rate.sourceCurrency} <span className="text-muted-foreground mx-1">→</span> {rate.functionalCurrency}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {rate.effectiveDate}
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium text-primary">
                    {rate.rate.toFixed(6)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {rate.source || "Manual"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={rate.note || ""}>
                    {rate.note || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <RateDialog mode="edit" rate={rate} />
                      <DeleteRateDialog rate={rate} />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function RateDialog({ mode, rate }: { mode: "create" | "edit", rate?: SystemRate }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const createMutation = useCreateSystemRate();
  const updateMutation = useUpdateSystemRate();

  const form = useForm<RateFormValues>({
    resolver: zodResolver(rateSchema),
    defaultValues: {
      sourceCurrency: rate?.sourceCurrency || "",
      functionalCurrency: rate?.functionalCurrency || DEFAULT_FUNCTIONAL_CURRENCY,
      effectiveDate: rate?.effectiveDate || format(new Date(), "yyyy-MM-dd"),
      rate: rate?.rate || 0,
      source: rate?.source || "System Admin",
      note: rate?.note || "",
    }
  });

  // Update form if rate changes
  useEffect(() => {
    if (rate && open) {
      form.reset({
        sourceCurrency: rate.sourceCurrency,
        functionalCurrency: rate.functionalCurrency,
        effectiveDate: rate.effectiveDate,
        rate: rate.rate,
        source: rate.source || "System Admin",
        note: rate.note || "",
      });
    } else if (!rate && open) {
      form.reset({
        sourceCurrency: "",
        functionalCurrency: DEFAULT_FUNCTIONAL_CURRENCY,
        effectiveDate: format(new Date(), "yyyy-MM-dd"),
        rate: 0,
        source: "System Admin",
        note: "",
      });
    }
  }, [rate, open, form]);

  const onSubmit = (data: RateFormValues) => {
    if (mode === "create") {
      createMutation.mutate({ data }, {
        onSuccess: () => {
          toast({ title: "Rate created successfully" });
          queryClient.invalidateQueries({ queryKey: getGetSystemRatesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetSystemRateDashboardQueryKey() });
          setOpen(false);
          form.reset();
        },
        onError: (err: any) => {
          toast({ title: "Failed to create rate", description: err.message || "Unknown error", variant: "destructive" });
        }
      });
    } else if (mode === "edit" && rate) {
      updateMutation.mutate({ id: rate.id, data }, {
        onSuccess: () => {
          toast({ title: "Rate updated successfully" });
          queryClient.invalidateQueries({ queryKey: getGetSystemRatesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetSystemRateDashboardQueryKey() });
          setOpen(false);
        },
        onError: (err: any) => {
          toast({ title: "Failed to update rate", description: err.message || "Unknown error", variant: "destructive" });
        }
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {mode === "create" ? (
          <Button size="sm"><Plus className="h-4 w-4 mr-2" /> Add Rate</Button>
        ) : (
          <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground">
            <Edit2 className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add System Rate" : "Edit System Rate"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="sourceCurrency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Source Currency</FormLabel>
                    <FormControl>
                      <Input placeholder="EUR" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="functionalCurrency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Functional Currency</FormLabel>
                    <FormControl>
                      <Input placeholder={DEFAULT_FUNCTIONAL_CURRENCY} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="effectiveDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Effective Date</FormLabel>
                    <FormControl>
                      <Input placeholder="YYYY-MM-DD" type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="rate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rate</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.000001" placeholder="1.000" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            
            <FormField
              control={form.control}
              name="source"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Source</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Central Bank API" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Note (Optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="Reason for manual entry..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <DialogFooter className="pt-4">
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : "Save Rate"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteRateDialog({ rate }: { rate: SystemRate }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const deleteMutation = useDeleteSystemRate();

  const onDelete = () => {
    deleteMutation.mutate({ id: rate.id }, {
      onSuccess: () => {
        toast({ title: "Rate deleted" });
        queryClient.invalidateQueries({ queryKey: getGetSystemRatesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSystemRateDashboardQueryKey() });
        setOpen(false);
      },
      onError: (err: any) => {
        toast({ title: "Failed to delete rate", description: err.message || "Unknown error", variant: "destructive" });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete System Rate</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete the rate for {rate.sourceCurrency} → {rate.functionalCurrency} on {rate.effectiveDate}?
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="pt-4">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="destructive" onClick={onDelete} disabled={deleteMutation.isPending}>
            {deleteMutation.isPending ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportRatesDialog({ defaultFunctionalCurrency }: { defaultFunctionalCurrency: string }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ExchangeRateParseResult | null>(null);
  const [functionalCurrency, setFunctionalCurrency] = useState(defaultFunctionalCurrency);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const importMutation = useImportSystemRates();
  const parseMutation = useParseSystemRates();

  useEffect(() => {
    if (!open) setFunctionalCurrency(defaultFunctionalCurrency);
  }, [defaultFunctionalCurrency, open]);

  const refreshRates = () => {
    queryClient.invalidateQueries({ queryKey: getGetSystemRatesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetSystemRateDashboardQueryKey() });
  };

  const importParsedRates = async (rates: ExchangeRateInput[]) => {
    try {
      const result = await importMutation.mutateAsync({ data: { rates } });
      refreshRates();
      setPreview(null);
      setOpen(false);
      toast({
        title: "Import successful",
        description: `Imported ${result.importedCount} rates and updated ${result.updatedCount}.`,
      });
    } catch (error) {
      toast({
        title: "Import failed",
        description: error instanceof Error ? error.message : "The system-rate import was rejected.",
        variant: "destructive",
      });
    }
  };

  const importRateFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const normalizedFunctionalCurrency = functionalCurrency.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(normalizedFunctionalCurrency)) {
        throw new Error("Enter the three-letter functional currency represented by rates that omit a target currency.");
      }
      const lowerName = file.name.toLowerCase();
      const isWorkbook = lowerName.endsWith(".xlsx")
        || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      if (isWorkbook) {
        if (file.size > 15 * 1024 * 1024) {
          throw new Error("This Excel workbook is too large. Choose a file smaller than 15 MB.");
        }
        const parsedPreview = await parseMutation.mutateAsync({
          data: {
            fileBase64: await fileAsBase64(file),
            fileName: file.name,
            functionalCurrency: normalizedFunctionalCurrency,
          },
        });
        setPreview(parsedPreview);
        return;
      }
      const rates = deterministicSystemRates(await file.text(), normalizedFunctionalCurrency);
      if (!rates.length) {
        throw new Error("No safe exchange-rate rows were found. Include date, source currency, functional currency, and rate columns.");
      }
      await importParsedRates(rates);
    } catch (error) {
      toast({
        title: "Import file could not be read",
        description: error instanceof Error ? error.message : "Choose a valid CSV or Excel exchange-rate file.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setPreview(null);
      }}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="mr-2 h-4 w-4" />
          Import CSV or Excel
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{preview ? "Review system exchange rates" : "Import system exchange rates"}</DialogTitle>
          <DialogDescription>
            {preview
              ? "Confirm the detected Excel rows before they are added to the global fallback schedule."
              : "Set the target currency used when the file omits it, then choose the same CSV or Excel schedule accepted by firm imports."}
          </DialogDescription>
        </DialogHeader>
        {!preview && <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <label htmlFor="system-rate-functional-currency" className="text-sm font-medium">
              Functional currency fallback
            </label>
            <Input
              id="system-rate-functional-currency"
              data-testid="input-system-exchange-rate-functional-currency"
              value={functionalCurrency}
              onChange={(event) => setFunctionalCurrency(event.target.value.toUpperCase().slice(0, 3))}
              placeholder="AED"
              maxLength={3}
              className="max-w-32 font-mono uppercase"
            />
            <p className="text-xs text-muted-foreground">
              Used only for rows without an explicit functional or target currency column.
            </p>
          </div>
          <label className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground">
            <Upload className="mr-2 h-4 w-4" />
            {parseMutation.isPending ? "Detecting layout…" : importMutation.isPending ? "Importing…" : "Choose CSV or Excel file"}
            <input
              data-testid="input-system-exchange-rate-import"
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={parseMutation.isPending || importMutation.isPending}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                void importRateFile(file);
              }}
            />
          </label>
        </div>}
        {preview && <div data-testid="card-system-exchange-rate-import-preview" className="space-y-4 pt-4">
          <div className="rounded-md border border-primary/25 bg-primary/5 px-4 py-3 text-sm">
            <strong>{preview.rates.length} valid rate{preview.rates.length === 1 ? "" : "s"} detected.</strong>
            <span className="ml-2 text-muted-foreground">Nothing is imported until you confirm.</span>
          </div>
          {preview.warnings.length > 0 && <div className="rounded-md border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-xs text-muted-foreground">
            {preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
          </div>}
          <div className="max-h-80 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Pair</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rates.slice(0, 50).map((rate, index) => (
                  <TableRow key={`${rate.sourceCurrency}-${rate.functionalCurrency}-${rate.effectiveDate}-${index}`}>
                    <TableCell className="font-mono text-xs">{rate.effectiveDate}</TableCell>
                    <TableCell className="font-medium">{rate.sourceCurrency} / {rate.functionalCurrency}</TableCell>
                    <TableCell className="text-right font-mono">{rate.rate}</TableCell>
                    <TableCell>{rate.source ?? "Imported workbook"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {preview.rates.length > 50 && <p className="text-xs text-muted-foreground">Showing the first 50 of {preview.rates.length} rates.</p>}
        </div>}
        <DialogFooter className="pt-4">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          {preview && <Button
            data-testid="button-confirm-system-exchange-rate-import"
            onClick={() => preview && void importParsedRates(preview.rates)}
            disabled={importMutation.isPending || !preview?.rates.length}
          >
            {importMutation.isPending ? "Importing…" : `Confirm ${preview?.rates.length ?? 0} rates`}
          </Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
