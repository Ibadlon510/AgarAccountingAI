import { Link } from "wouter";
import { useGetBillingMe } from "@workspace/api-client-react";
import { FirmSubscribeWall } from "@/components/billing";
import { primaryFirmBilling } from "@/lib/billing-ui";
import { showsFirmNavigation } from "@/lib/firm-landing";
import { useOrgContext } from "@/lib/workspace-context";

export default function FirmSubscribePage() {
  const orgContext = useOrgContext();
  const billingQuery = useGetBillingMe();
  const firm = primaryFirmBilling(billingQuery.data, orgContext?.firms[0]?.firmId);
  if (!showsFirmNavigation(orgContext?.mode, true) && orgContext?.mode !== "firm" && orgContext?.mode !== "both") {
    return <Link href="/user-portal">Return to overview</Link>;
  }
  return <FirmSubscribeWall persistent={firm?.status === "locked"} firm={firm} billing={billingQuery.data} />;
}
