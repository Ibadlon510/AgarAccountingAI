import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  getGetAgarAccountingUsageQueryKey,
  getGetOrganizationContextQueryKey,
  useGetAgarAccountingUsage,
  useInviteFirmMember,
  useNominateFirmEngagementMember,
  useRevokeFirmEngagement,
} from "@workspace/api-client-react";
import type { FirmEngagement, FirmMembership, OrganizationInvitation } from "@workspace/api-client-react";
import { notify } from "@/lib/notify";

export function FirmMembersSection({ firmId, members, invitations }: { firmId: number; members: FirmMembership[]; invitations: OrganizationInvitation[] }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const invite = useInviteFirmMember();
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const invited = email;
    invite.mutate({ id: firmId, data: { email, role: "accountant" } }, {
      onSuccess: () => {
        setEmail("");
        queryClient.invalidateQueries({ queryKey: getGetOrganizationContextQueryKey() });
        notify.success("Firm member invited", { description: `Invitation sent to ${invited}.` });
      },
    });
  };
  const firmInvitations = invitations.filter((invitation) => invitation.firmId === firmId && invitation.kind === "firm_member");
  return (
    <section className="rounded-lg border border-card-border bg-card p-5 md:p-6">
      <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Firm Access</div>
      <h2 className="mt-2 text-base font-semibold">Firm Members</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">Manage accountants and bookkeepers in your firm.</p>
      <form onSubmit={submit} className="mt-5 flex items-end gap-3">
        <label className="flex-1 text-xs font-medium">Email address<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" placeholder="colleague@firm.com" /></label>
        <button disabled={invite.isPending} className="h-10 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-50">Invite member</button>
      </form>
      <div className="mt-5 divide-y rounded-md border border-border">
        {members.map((member) => (
          <div key={member.userId} className="flex items-center justify-between p-3 text-xs">
            <div><strong>{member.name}</strong> · {member.email}</div>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">{member.role}</div>
          </div>
        ))}
        {firmInvitations.map((invitation) => (
          <div key={invitation.id} className="flex items-center justify-between bg-muted/50 p-3 text-xs">
            <div><strong>{invitation.email}</strong> · Invited</div>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">{invitation.status}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function FirmEngagementsSection({ engagements }: { engagements: FirmEngagement[] }) {
  const queryClient = useQueryClient();
  const nominate = useNominateFirmEngagementMember();
  const revoke = useRevokeFirmEngagement();
  return (
    <section className="rounded-lg border border-card-border bg-card p-5 md:p-6">
      <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Client relationships</div>
      <h2 className="mt-2 text-base font-semibold">Firm Engagements</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">Companies that have hired your firm for bookkeeping.</p>
      {engagements.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">No active engagements.</p>
      ) : (
        <div className="mt-5 space-y-4">
          {engagements.map((engagement) => (
            <div key={engagement.id} className="rounded-md border border-border p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold">{engagement.companyName}</h3>
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-[.1em] text-muted-foreground">{engagement.status} engagement</div>
                </div>
                {engagement.canManageCompany && (
                  <button onClick={() => { if (confirm("Revoke engagement?")) revoke.mutate({ id: engagement.id }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetOrganizationContextQueryKey() }); notify.success(`${engagement.companyName} engagement revoked`); } }); }} className="text-[11px] font-semibold text-destructive hover:underline">Revoke</button>
                )}
              </div>
              <div className="mt-4 border-t border-border pt-4">
                <h4 className="text-xs font-semibold">Assigned team</h4>
                <div className="mt-2 space-y-2">
                  {engagement.members.map((member) => (
                    <div key={member.userId} className="flex items-center justify-between text-[11px]">
                      <span>{member.name} ({member.email}) - {member.role}</span>
                      <span className="font-mono text-[9px] uppercase text-muted-foreground">{member.status}</span>
                    </div>
                  ))}
                </div>
                {engagement.canManageFirm && engagement.status === "active" && (
                  <form className="mt-3 flex gap-2" onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const nominatedEmail = form.get("email") as string;
                    nominate.mutate({ id: engagement.id, data: { email: nominatedEmail, role: "bookkeeper" } }, {
                      onSuccess: () => {
                        (event.target as HTMLFormElement).reset();
                        queryClient.invalidateQueries({ queryKey: getGetOrganizationContextQueryKey() });
                        notify.success("Member nominated", { description: `${nominatedEmail} is awaiting company approval.` });
                      },
                    });
                  }}>
                    <input name="email" required type="email" placeholder="Assign firm member by email" className="h-8 flex-1 rounded border border-input bg-background px-2 text-xs" />
                    <button className="h-8 rounded bg-secondary px-3 text-xs font-semibold text-secondary-foreground hover:bg-secondary/80">Nominate</button>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function FirmUsageStrip() {
  const usageQuery = useGetAgarAccountingUsage({
    query: { queryKey: getGetAgarAccountingUsageQueryKey(), staleTime: 5 * 60 * 1000 },
  });
  const usage = usageQuery.data;
  return (
    <section className="rounded-lg border border-card-border bg-card p-5 md:p-6" data-testid="section-firm-usage-strip">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Resource allocation</div>
          <h2 className="mt-2 text-base font-semibold">Usage & limits</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {usage ? `${usage.plan} plan · ${usage.clientWorkspaces.used} client workspaces` : "Loading usage for this account."}
          </p>
        </div>
        <Link href="/firm-settings#usage-limits" className="rounded-md border border-border px-3 py-2 text-[11px] font-semibold hover:bg-muted">Open full usage</Link>
      </div>
    </section>
  );
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
