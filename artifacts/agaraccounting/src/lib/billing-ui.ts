import type { BillingMe, CompanyBilling, FirmBilling } from "@workspace/api-client-react";

export function primaryFirmBilling(billing: BillingMe | undefined, firmId?: number) {
  if (!billing?.firms.length) return undefined;
  return billing.firms.find((firm) => firm.firmId === firmId) ?? billing.firms[0];
}

export function companyBillingFor(billing: BillingMe | undefined, clientId?: number) {
  if (!billing || clientId == null) return undefined;
  return billing.companies.find((company) => company.clientId === clientId);
}

export function firmHasFullAccess(firm: FirmBilling | undefined) {
  return Boolean(firm?.fullAccess);
}

export function formatAed(amount: number) {
  return `AED ${amount.toLocaleString("en-US")}`;
}

export function remainingIntro(introEndsAt: string, now = new Date()) {
  const end = new Date(introEndsAt).getTime();
  const ms = Math.max(0, end - now.getTime());
  const totalSeconds = Math.floor(ms / 1000);
  return {
    expired: ms <= 0,
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

export function firmStatusLabel(status: FirmBilling["status"]) {
  if (status === "trialing") return "Firm trial";
  if (status === "active") return "Firm Pro";
  if (status === "past_due") return "Payment past due";
  if (status === "lapsed_readonly") return "Read-only";
  return "Locked";
}

export function companyStatusLabel(company: CompanyBilling) {
  if (company.status === "trialing") return "Company trial";
  if (company.status === "pro") return company.isFirmMember ? "Company Pro · firm rate" : "Company Pro";
  if (company.status === "requires_pro") return "Upgrade required";
  return "Company Free";
}
