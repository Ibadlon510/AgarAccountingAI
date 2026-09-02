import { Router, type IRouter } from "express";
import { applyStripeSubscription, constructStripeEvent, retrieveSubscription, stripeClient } from "../lib/stripeBilling";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function subscriptionIdFromEvent(event: { type: string; data: { object: Record<string, unknown> } }) {
  const object = event.data.object;
  if (event.type.startsWith("customer.subscription")) return typeof object.id === "string" ? object.id : null;
  const subscription = object.subscription;
  if (typeof subscription === "string") return subscription;
  if (subscription && typeof subscription === "object" && "id" in subscription && typeof subscription.id === "string") {
    return subscription.id;
  }
  return null;
}

router.post("/billing/webhooks/stripe", async (req, res) => {
  const signature = req.headers["stripe-signature"];
  if (typeof signature !== "string") return res.status(400).json({ error: "Missing Stripe signature." });
  const raw = (req as typeof req & { rawBody?: Buffer }).rawBody;
  if (!raw) return res.status(400).json({ error: "Missing raw webhook body." });
  try {
    const event = await constructStripeEvent(raw, signature);
    if (
      event.type === "checkout.session.completed"
      || event.type === "customer.subscription.created"
      || event.type === "customer.subscription.updated"
      || event.type === "customer.subscription.deleted"
      || event.type === "invoice.paid"
      || event.type === "invoice.payment_failed"
    ) {
      const subscriptionId = subscriptionIdFromEvent(event);
      if (subscriptionId && stripeClient()) {
        await applyStripeSubscription(await retrieveSubscription(subscriptionId));
      }
    }
    res.json({ received: true });
  } catch (error) {
    logger.error({ err: error }, "Stripe webhook rejected");
    res.status(400).json({ error: "Stripe webhook could not be verified." });
  }
});

export default router;
