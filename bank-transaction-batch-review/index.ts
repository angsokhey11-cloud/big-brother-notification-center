import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.49.10";
const service=()=>createClient(Deno.env.get("SUPABASE_URL")||"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",{auth:{persistSession:false}});
const utf8=new TextEncoder();
const text=(x:unknown)=>String(x??"").trim();
const cors={"access-control-allow-origin":"https://angsokhey11-cloud.github.io","access-control-allow-methods":"POST,OPTIONS","access-control-allow-headers":"content-type","cache-control":"no-store","vary":"Origin"};
const reply=(obj:unknown,status=200)=>Response.json(obj,{status,headers:cors});
async function hmac(key:Uint8Array|string,data:string){
 const k=await crypto.subtle.importKey("raw",typeof key==="string"?utf8.encode(key):key,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 return new Uint8Array(await crypto.subtle.sign("HMAC",k,utf8.encode(data)));
}
async function reviewer(init:string):Promise<string>{
 const bot=Deno.env.get("TELEGRAM_BOT_TOKEN")||"";
 if(!bot||!init||init.length>10000)throw Error("Reopen this review from your private Telegram bot chat.");
 const p=new URLSearchParams(init),received=text(p.get("hash"));
 if(!/^[a-f0-9]{64}$/i.test(received))throw Error("Telegram review signature unavailable.");
 p.delete("hash");
 const message=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+"="+v).join("\n");
 const secret=await hmac("WebAppData",bot),actual=await hmac(secret,message);
 const expected=[...actual].map(b=>b.toString(16).padStart(2,"0")).join("");
 if(expected.length!==received.length)throw Error("Invalid Telegram session");
 let difference=0;for(let i=0;i<expected.length;i++)difference|=expected.charCodeAt(i)^received.toLowerCase().charCodeAt(i);
 if(difference)throw Error("Invalid Telegram session");
 const authTime=Number(p.get("auth_date")),now=Math.floor(Date.now()/1000);
 if(!Number.isSafeInteger(authTime)||authTime>now+120||authTime<now-3600)throw Error("Telegram session expired. Close and reopen from bot.");
 let info:any;try{info=JSON.parse(text(p.get("user")));}catch{throw Error("Telegram user unavailable");}
 const id=text(info?.id);
 if(!/^[0-9]{5,20}$/.test(id)||info?.is_bot===true)throw Error("Authorized private reviewer required");
 return id;
}

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function telegramPrivate(user:string,content:string){
 const token=Deno.env.get("TELEGRAM_BOT_TOKEN")||"";
 await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{method:"POST",headers:{"content-type":"application/json"},
 body:JSON.stringify({chat_id:user,text:content.slice(0,3800)})});
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return reply({error:"POST required"},405);
 try{
  const body=await req.json().catch(()=>({}));
  const reviewerId=await reviewer(text(body.init_data));
  const jwt=text(body.session_jwt);
  if(!jwt||jwt.length>8000)return reply({error:"Sign in using BIG BROTHER admin credentials to review."},401);
  const client=service();
  const {data:auth,error:authError}=await client.auth.getUser(jwt);
  const user=auth?.user;
  if(authError||!user?.id)return reply({error:"Admin login has expired."},401);
  const {data:admin,error:adminError}=await client.from("app_users").select("role,active").eq("user_id",user.id).eq("active",true).maybeSingle();
  if(adminError||!admin||text(admin.role).toLowerCase()!=="admin")return reply({error:"Active BIG BROTHER administrator access required."},403);
  const {data:tgAdmin}=await client.from("bb_telegram_assistant_admins").select("telegram_user_id").eq("telegram_user_id",reviewerId).maybeSingle();
  if(!tgAdmin)return reply({error:"Authorized Telegram reviewer required."},403);
  const batchId=text(body.batch_id);
  if(!uuid.test(batchId))return reply({error:"Invalid private review batch."},400);
  const {data:batch,error:batchError}=await client.from("bb_bank_transaction_review_batches").select("*")
   .eq("batch_id",batchId).eq("reviewer_telegram_user_id",reviewerId)
   .gt("expires_at",new Date().toISOString()).maybeSingle();
  if(batchError||!batch)return reply({error:"Review batch missing or expired."},404);
  const {data:route,error:routeError}=await client.from("bb_bank_review_personal_routes").select("reviewer_telegram_user_id")
   .eq("source_chat_id",batch.source_chat_id).eq("source_thread_id",batch.source_thread_id)
   .eq("reviewer_telegram_user_id",reviewerId).eq("active",true).maybeSingle();
  if(routeError||!route)return reply({error:"The personal reviewer mapping has changed. Ask admin to verify."},403);
  const action=text(body.action);
  const getEntries=async()=>{
   const {data,error}=await client.from("bb_bank_new_invoice_review_drafts")
    .select("draft_id,source_message_id,sender_name,transaction_id,amount,currency,bank_channel,received_date,status,review_decision,review_payload,registered_transaction_id")
    .eq("review_batch_id",batchId).eq("reviewer_telegram_user_id",reviewerId)
    .order("created_at").order("source_message_id").limit(100);
   if(error)throw error;
   return data||[];
  };
  if(action==="load"){
   return reply({ok:true,batch:{batch_id:batch.batch_id,status:batch.status,expires_at:batch.expires_at},items:await getEntries()});
  }
  if(action==="cancel"){
    // Cancel only a pending review. The protected DB function atomically marks
    // these bank notice candidates discarded, never updating Bank Register.
    if(batch.status==="cancelled")return reply({ok:true,cancelled:true,already_cancelled:true,discarded:0});
    if(batch.status!=="reviewing")return reply({
     error:"Cannot cancel after Confirm & Register has started. Check Bank Register; no bank entries were removed."
    },409);
    const {data:out,error:cancelError}=await client.rpc("bb_bank_cancel_transaction_review",{
     p_batch_id:batchId,p_reviewer:reviewerId
    });
    if(cancelError)return reply({error:cancelError.message||"Unable to cancel pending review."},409);
    if(!out?.ok||!out?.cancelled)return reply({error:"Review cancellation was not confirmed."},409);
    if(!out?.already_cancelled){
     await telegramPrivate(reviewerId,"🚫 BIG BROTHER — BANK REVIEW CANCELLED\n\n"+
      Number(out.discarded||0)+" pending bank notices discarded from review.\n"+
      "No bank transactions were registered or removed. Existing Bank Register and payments are unchanged.\n\n"+
      "Forward new bank notices to the mapped group/topic, then send /reviewtransaction to start a fresh review.").catch(()=>{});
    }
    return reply(out);
   }
   if(action==="save"){
   if(batch.status!=="reviewing")return reply({error:"Review choices are locked after final approval begins."},409);
   const draftId=text(body.draft_id),decision=text(body.decision);
   if(!uuid.test(draftId)||!["ignore","new_invoice"].includes(decision))return reply({error:"Invalid review selection."},400);
   let payload:null|Record<string,unknown>=null;
   if(decision==="new_invoice"){
    const p=body.details||{},customer=text(p.customer_id),tid=text(p.transaction_id).toUpperCase(),
     payer=Number(p.payer_identity_id),a=Number(p.amount),cur=text(p.currency).toUpperCase(),
     inv=text(p.invoice_currency).toUpperCase(),rate=Number(p.exchange_rate),date=text(p.received_date);
    if(!customer||customer.length>150||!tid||tid.length>160||!Number.isSafeInteger(payer)||payer<1||
     !Number.isFinite(a)||a<=0||!["USD","KHR"].includes(cur)||!["USD","KHR"].includes(inv)||
     !Number.isFinite(rate)||rate<=0||(cur!==inv&&rate<=1)||
     !/^\d{4}-\d{2}-\d{2}$/.test(date)||date>new Date(Date.now()+7*3600000).toISOString().slice(0,10))
      return reply({error:"Verify customer, payer, transaction, currency, amount, date and exchange rate."},400);
    const {data:payerRow}=await client.from("bb_customer_bank_identities").select("identity_id")
     .eq("identity_id",payer).eq("customer_id",customer).eq("active",true).maybeSingle();
    if(!payerRow)return reply({error:"Selected payer does not belong to this customer. Save or choose a bank payer first."},409);
    payload={customer_id:customer,transaction_id:tid,payer_identity_id:payer,amount:a,currency:cur,
      invoice_currency:inv,exchange_rate:rate,received_date:date,bank_name:text(p.bank_name).slice(0,120)};
   }
   const {data:changed,error}=await client.from("bb_bank_new_invoice_review_drafts")
    .update({review_decision:decision,review_payload:payload,reviewed_by_admin_user_id:user.id,reviewed_at:new Date().toISOString(),updated_at:new Date().toISOString()})
    .eq("draft_id",draftId).eq("review_batch_id",batchId).eq("reviewer_telegram_user_id",reviewerId)
    .eq("status","reviewing").select("draft_id");
   if(error||!changed?.length)return reply({error:"Transaction is no longer available for editing."},409);
   return reply({ok:true,saved:true});
  }
  if(action==="approve"){
   if(batch.status==="processing")return reply({ok:true,processing:true});
   if(batch.status!=="reviewing")return reply({error:"Review is not available for approval."},409);
   const entries=await getEntries();
   if(!entries.length||entries.some(x=>!["ignore","new_invoice"].includes(x.review_decision)||
     (x.review_decision==="new_invoice"&&!x.review_payload)))
     return reply({error:"Every transaction must be reviewed as New Invoice or Leave Alone."},409);
   const {data:result,error}=await client.from("bb_bank_transaction_review_batches")
    .update({status:"processing",updated_at:new Date().toISOString()})
    .eq("batch_id",batchId).eq("status","reviewing").select("batch_id");
   if(error||!result?.length)return reply({error:"Review already changed. Reload it."},409);
   return reply({ok:true,processing:true});
  }
  if(action==="record"){
   if(batch.status!=="processing")return reply({error:"Final approval is not running."},409);
   const did=text(body.draft_id);
   const {data:item,error:itemError}=await client.from("bb_bank_new_invoice_review_drafts").select("*")
    .eq("draft_id",did).eq("review_batch_id",batchId).eq("reviewer_telegram_user_id",reviewerId).maybeSingle();
   if(itemError||!item||item.review_decision!=="new_invoice")return reply({error:"New Invoice review selection required."},409);
   if(item.status==="registered")return reply({ok:true,registered:true,already:true});
   const p=item.review_payload||{},tid=text(p.transaction_id);
   if(!tid)return reply({error:"Missing reviewed transaction ID."},409);
   const {data:registered,error:registerError}=await client.from("bb_verified_bank_transactions")
    .select("transaction_id,customer_id,amount,currency,invoice_currency,approved_exchange_rate,payer_identity_id,created_by,status,received_date")
    .eq("transaction_id",tid).eq("customer_id",p.customer_id).eq("payer_identity_id",p.payer_identity_id)
    .eq("created_by",user.id).maybeSingle();
   if(registerError||!registered||registered.status!=="AVAILABLE"||
      Math.abs(Number(registered.amount)-Number(p.amount))>0.00001||
      registered.currency!==p.currency||(registered.invoice_currency||registered.currency)!==p.invoice_currency||
      Math.abs(Number(registered.approved_exchange_rate)-Number(p.exchange_rate))>0.000001||
      registered.received_date!==p.received_date)
    return reply({error:"The protected Bank Register entry was not found with exactly these reviewed details."},409);
   const {error:changeError}=await client.from("bb_bank_new_invoice_review_drafts").update({
     status:"registered",registered_transaction_id:tid,updated_at:new Date().toISOString()
   }).eq("draft_id",did).eq("status","reviewing").eq("review_batch_id",batchId);
   if(changeError)throw changeError;
   return reply({ok:true,registered:true});
  }
  if(action==="finish"){
   if(batch.status==="completed")return reply({ok:true,completed:true,already:true});
   if(batch.status!=="processing")return reply({error:"Final review approval is not active."},409);
   const entries=await getEntries();
   if(!entries.length||entries.some(x=>x.review_decision==="new_invoice"&&x.status!=="registered")
    ||entries.some(x=>!["ignore","new_invoice"].includes(x.review_decision)))
    return reply({error:"Some new-invoice payments remain unregistered. Resume the review; don't repeat completed entries."},409);
   const {error:ignoreError}=await client.from("bb_bank_new_invoice_review_drafts")
    .update({status:"discarded",updated_at:new Date().toISOString()})
    .eq("review_batch_id",batchId).eq("review_decision","ignore").eq("status","reviewing");
   if(ignoreError)throw ignoreError;
   const {error:completeError}=await client.from("bb_bank_transaction_review_batches")
    .update({status:"completed",updated_at:new Date().toISOString()})
    .eq("batch_id",batchId).eq("status","processing");
   if(completeError)throw completeError;
   const approved=entries.filter(x=>x.review_decision==="new_invoice").length;
   await telegramPrivate(reviewerId,"✅ BIG BROTHER — BANK REVIEW COMPLETED\n\nReviewed: "+entries.length+
    "\nNew Invoice Bank Register: "+approved+"\nLeft alone (A/R/other): "+(entries.length-approved)+
    "\n\nRegistered items are AVAILABLE for Invoice Generator. No A/R collection or invoice payment was created.").catch(()=>{});
   return reply({ok:true,completed:true,total:entries.length,registered:approved,ignored:entries.length-approved});
  }
  return reply({error:"Unsupported batch review action."},400);
 }catch(e){
  console.error("Bank batch review error",e instanceof Error?e.name:"unknown");
  return reply({error:e instanceof Error?e.message:"Bank review unavailable"},400);
 }
});