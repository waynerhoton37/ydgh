# YDGH PayPal webhook setup

This is **not deployed** yet. The live checkout continues to work as before, but manual verification is required until the webhook is activated and tested.

## Cloudflare Worker
1. Create a Cloudflare Worker named `ydgh-paypal-webhooks` (free tier where available).
2. Paste `paypal-webhook-worker.js` as the Worker code.
3. Create a Cloudflare KV namespace and bind it to the Worker as `EVENTS`. KV tracks event IDs to reduce duplicate notifications.
4. Add **encrypted secrets** to Worker settings:
   - `PAYPAL_CLIENT_ID` — live PayPal REST app client ID
   - `PAYPAL_CLIENT_SECRET` — live PayPal REST app secret; **never put in GitHub, frontend JavaScript or chat**
   - `PAYPAL_WEBHOOK_ID` — generated after creating the webhook in PayPal
   - `FORMSPREE_ENDPOINT` — existing YDGH Formspree endpoint URL
   - Optional `PAYPAL_ENV` — `live` (default) or `sandbox`
5. Deploy the Worker and copy its HTTPS URL. Webhook path: `/paypal/webhook`.
6. In PayPal Developer Dashboard → My Apps & Credentials → **Live** REST app → Webhooks, add `https://YOUR-WORKER-URL/paypal/webhook`.
7. Subscribe to these event types: `BILLING.SUBSCRIPTION.ACTIVATED`, `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.SUSPENDED`, `BILLING.SUBSCRIPTION.EXPIRED`, `BILLING.SUBSCRIPTION.PAYMENT.FAILED`, `PAYMENT.SALE.COMPLETED`, `PAYMENT.SALE.DENIED`, `PAYMENT.SALE.REFUNDED`.
8. Copy the webhook ID into `PAYPAL_WEBHOOK_ID`, redeploy, and test with PayPal's webhook simulator and a real sandbox subscription using a **separate sandbox Worker configuration**.

## Critical operational rules
- PayPal's browser `onApprove` is **not proof of captured funds**. Do not register a domain or start work until PayPal confirms the payment in its merchant dashboard.
- The Worker validates PayPal signatures using PayPal's official verification endpoint before sending alerts.
- Webhook emails provide subscription/payment event alerts, **not a definitive paid-order database**. For production-scale automated fulfillment, build a server-side order ledger linking the intake form, verified subscription ID, and successful first payment.
- The existing Formspree intake is intentionally a **lead** even if no payment follows.
- Never assume a successful `BILLING.SUBSCRIPTION.ACTIVATED` event alone proves a payment was captured.
- Configure a mailbox and verify Formspree notifications before relying on email alerts.
- PayPal webhook event schemas can differ across subscription/payment products; test all relevant events before treating notifications as complete.
