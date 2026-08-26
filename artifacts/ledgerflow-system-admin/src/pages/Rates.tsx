import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useGetSystemRates, 
  useCreateSystemRate, 
  useUpdateSystemRate, 
  useDeleteSystemRate,
  useImportSystemRates,
  getGetSystemRatesQueryKey,
  getGetSystemRateDashboardQueryKey
} from "@workspace/api-client-react";
import type { SystemRate } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
          <ImportRatesDialog />
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
      functionalCurrency: rate?.functionalCurrency || "",
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
        functionalCurrency: "",
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
                      <Input placeholder="USD" {...field} />
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

function ImportRatesDialog() {
  const [open, setOpen] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const importMutation = useImportSystemRates();

  const handleImport = () => {
    try {
      const parsed = JSON.parse(jsonText);
      const rates = Array.isArray(parsed) ? parsed : [parsed];
      
      // Basic validation
      const isValid = rates.every(r => r.sourceCurrency && r.functionalCurrency && r.effectiveDate && r.rate);
      if (!isValid) {
        throw new Error("Invalid JSON format. Expected array of rates with sourceCurrency, functionalCurrency, effectiveDate, and rate.");
      }

      importMutation.mutate({ data: { rates } }, {
        onSuccess: (res) => {
          toast({ 
            title: "Import Successful", 
            description: `Imported ${res.importedCount} rates, updated ${res.updatedCount}.` 
          });
          queryClient.invalidateQueries({ queryKey: getGetSystemRatesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetSystemRateDashboardQueryKey() });
          setOpen(false);
          setJsonText("");
        },
        onError: (err: any) => {
          toast({ title: "Import Failed", description: err.message || "Server rejected import", variant: "destructive" });
        }
      });
    } catch (e: any) {
      toast({ title: "Parsing Error", description: e.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Upload className="h-4 w-4 mr-2" /> Import</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import System Rates</DialogTitle>
          <DialogDescription>
            Paste JSON array of rates to import in bulk.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <Label>JSON Payload</Label>
          <textarea
            className="w-full h-64 font-mono text-sm p-4 rounded-md border border-input bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder={`[\n  {\n    "sourceCurrency": "EUR",\n    "functionalCurrency": "USD",\n    "effectiveDate": "2024-01-01",\n    "rate": 1.09,\n    "source": "ECB"\n  }\n]`}
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
          />
        </div>
        <DialogFooter className="pt-4">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleImport} disabled={importMutation.isPending || !jsonText.trim()}>
            {importMutation.isPending ? "Importing..." : "Run Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
