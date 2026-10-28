/**
 * YDGH PayPal webhook receiver (Cloudflare Worker)
 * Secrets: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, FORMSPREE_ENDPOINT
 * Binding: EVENTS (KV namespace)
 * Optional: PAYPAL_ENV=sandbox (default live)
 */
const json = (value,status=200) => new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
async function paypalToken(env) {
 const base = env.PAYPAL_ENV==="sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
 const credentials=btoa(env.PAYPAL_CLIENT_ID+":"+env.PAYPAL_CLIENT_SECRET);
 const response=await fetch(base+"/v1/oauth2/token",{method:"POST",headers:{"Authorization":"Basic "+credentials,"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials"});
 if(!response.ok) throw new Error("PayPal OAuth failed");
 const data=await response.json();
 return {base,token:data.access_token};
}
async function notify(env, event, subscriptionId, status) {
 if(!env.FORMSPREE_ENDPOINT) return;
 const body=new FormData();
 body.set("source","YDGH VERIFIED PAYPAL WEBHOOK");
 body.set("paypalEvent",event.event_type);
 body.set("paypalEventID",event.id);
 body.set("paypalSubscriptionID",subscriptionId||"Not provided");
 body.set("verifiedStatus",status);
 body.set("paymentStatus","Verified PayPal webhook; check PayPal transaction dashboard for funds");
 const response=await fetch(env.FORMSPREE_ENDPOINT,{method:"POST",body,headers:{"Accept":"application/json"}});
 if(!response.ok) throw new Error("Notification delivery failed");
}
export default {
 async fetch(request,env) {
  if(request.method!=="POST" || new URL(request.url).pathname!=="/paypal/webhook") return json({error:"Not found"},404);
  if(!env.PAYPAL_CLIENT_ID||!env.PAYPAL_CLIENT_SECRET||!env.PAYPAL_WEBHOOK_ID||!env.EVENTS) return json({error:"Webhook not configured"},503);
  const raw=await request.text();
  if(raw.length>250000) return json({error:"Payload too large"},413);
  let event;try{event=JSON.parse(raw)}catch{return json({error:"Invalid JSON"},400)}
  const headers=request.headers;
  const transmissionId=headers.get("paypal-transmission-id"),transmissionTime=headers.get("paypal-transmission-time"),transmissionSig=headers.get("paypal-transmission-sig"),certUrl=headers.get("paypal-cert-url"),authAlgo=headers.get("paypal-auth-algo");
  if(!transmissionId||!transmissionTime||!transmissionSig||!certUrl||!authAlgo||!event.id) return json({error:"Missing signature fields"},400);
  try {
   const {base,token}=await paypalToken(env);
   const verify=await fetch(base+"/v1/notifications/verify-webhook-signature",{
    method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
    body:JSON.stringify({auth_algo:authAlgo,cert_url:certUrl,transmission_id:transmissionId,transmission_sig:transmissionSig,transmission_time:transmissionTime,webhook_id:env.PAYPAL_WEBHOOK_ID,webhook_event:event})
   });
   if(!verify.ok) return json({error:"Signature verification unavailable"},503);
   const verified=await verify.json();
   if(verified.verification_status!=="SUCCESS") return json({error:"Invalid PayPal signature"},401);
   const key="paypal-event:"+event.id;
   if(await env.EVENTS.get(key)) return json({ok:true,duplicate:true});
   const subscriptionId=event.resource?.billing_agreement_id||event.resource?.id||event.resource?.supplementary_data?.related_ids?.subscription_id||"";
   const interesting=["BILLING.SUBSCRIPTION.ACTIVATED","BILLING.SUBSCRIPTION.CANCELLED","BILLING.SUBSCRIPTION.SUSPENDED","BILLING.SUBSCRIPTION.EXPIRED","BILLING.SUBSCRIPTION.PAYMENT.FAILED","PAYMENT.SALE.COMPLETED","PAYMENT.SALE.DENIED","PAYMENT.SALE.REFUNDED"];
   if(interesting.includes(event.event_type)){
    await notify(env,event,subscriptionId,event.event_type);
   }
   await env.EVENTS.put(key,JSON.stringify({type:event.event_type,subscriptionId,receivedAt:new Date().toISOString()}),{expirationTtl:60*60*24*90});
   return json({ok:true});
  } catch(err) {console.error("PayPal webhook processing failed",err.message);return json({error:"Processing failed"},503)}
 }
};
