import { useClaimInitialSystemAdminAccess, useGetSystemRateDashboard } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertCircle, Building2, Link2, Coins, LoaderCircle, ShieldCheck } from "lucide-react";
import { format } from "date-fns";

export default function Dashboard() {
  const { data: dashboard, isLoading, error, refetch } = useGetSystemRateDashboard();
  const claimMutation = useClaimInitialSystemAdminAccess();

  const claimInitialAccess = async () => {
    try {
      await claimMutation.mutateAsync();
      await refetch();
    } catch {
      // The mutation state renders the server-approved failure message below.
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4 text-muted-foreground animate-pulse">
          <Activity className="h-8 w-8" />
          <p className="font-mono text-sm">Loading System Data...</p>
        </div>
      </div>
    );
  }

  if (error || !dashboard) {
    const denied = (error as { status?: number } | null)?.status === 403;
    return (
      <div className="p-8">
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="flex flex-col items-center justify-center p-12 text-destructive">
            <AlertCircle className="h-10 w-10 mb-4" />
            <h2 className="text-xl font-semibold mb-2">{denied ? "System administrator access required" : "Failed to load dashboard"}</h2>
            <p className="max-w-xl text-center text-sm opacity-80">{denied ? "Your account is signed in but has not been granted the separate system-rate administrator entitlement." : "The system-rate service is unavailable. Try again shortly."}</p>
            {denied && <>
              <div className="mt-6 max-w-lg rounded-md border border-destructive/20 bg-background/70 px-4 py-3 text-center text-xs leading-5 text-foreground">
                If this is the first Production account, you can claim the initial administrator entitlement once. The claim permanently closes after any administrator record is created.
              </div>
              <Button data-testid="button-claim-initial-system-admin" className="mt-4 gap-2" onClick={claimInitialAccess} disabled={claimMutation.isPending}>
                {claimMutation.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                {claimMutation.isPending ? "Claiming secure access…" : "Claim initial administrator access"}
              </Button>
              {claimMutation.isError && <p data-testid="status-claim-initial-system-admin-error" className="mt-3 max-w-lg text-center text-xs text-destructive">
                {(claimMutation.error as { status?: number }).status === 409
                  ? "Initial access is already closed. An active administrator must grant access explicitly."
                  : "The entitlement could not be claimed. Try again shortly."}
              </p>}
            </>}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto w-full space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Overview of global exchange-rate health and system fallback usage.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Available Pairs</CardTitle>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard.availablePairs.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Global rate pairs configured</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Using Fallback</CardTitle>
            <Link2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard.workspacesUsingFallback}</div>
            <p className="text-xs text-muted-foreground mt-1">Workspaces relying on system rates</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Fallback Disabled</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard.workspacesWithFallbackDisabled}</div>
            <p className="text-xs text-muted-foreground mt-1">Workspaces managing own rates</p>
          </CardContent>
        </Card>

        <Card className={dashboard.missingOrStaleCoverage.length > 0 ? "border-destructive/50" : ""}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Coverage Gaps</CardTitle>
            <AlertCircle className={`h-4 w-4 ${dashboard.missingOrStaleCoverage.length > 0 ? "text-destructive" : "text-muted-foreground"}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${dashboard.missingOrStaleCoverage.length > 0 ? "text-destructive" : ""}`}>
              {dashboard.missingOrStaleCoverage.length}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Missing or stale pairs</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Coverage Gaps</CardTitle>
            <CardDescription>Pairs missing or stale across workspaces.</CardDescription>
          </CardHeader>
          <CardContent>
            {dashboard.missingOrStaleCoverage.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">
                No coverage gaps detected. System is healthy.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pair</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Workspaces</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.missingOrStaleCoverage.map((gap, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">
                        {gap.sourceCurrency}/{gap.functionalCurrency}
                      </TableCell>
                      <TableCell>
                        <Badge variant={gap.kind === 'missing' ? 'destructive' : 'secondary'}>
                          {gap.kind}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{gap.workspaces}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Recent Changes</CardTitle>
            <CardDescription>Latest system rate updates and imports.</CardDescription>
          </CardHeader>
          <CardContent>
            {dashboard.recentChanges.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">
                No recent changes recorded.
              </div>
            ) : (
              <div className="space-y-4">
                {dashboard.recentChanges.map((change) => (
                  <div key={change.id} className="flex flex-col gap-1 border-b border-border/50 pb-3 last:border-0 last:pb-0">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wider">{change.action}</Badge>
                      <span className="text-xs text-muted-foreground font-mono">
                        {format(new Date(change.createdAt), 'MMM d, HH:mm')}
                      </span>
                    </div>
                    <p className="text-sm mt-1">{change.summary}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
