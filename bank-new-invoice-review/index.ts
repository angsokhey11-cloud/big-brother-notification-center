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
async function telegramPrivate(chat:string,message:string){
 const token=Deno.env.get("TELEGRAM_BOT_TOKEN")||"";
 await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{method:"POST",headers:{"content-type":"application/json"},
 body:JSON.stringify({chat_id:chat,text:message})});
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return reply({error:"POST required"},405);
 try{
  const body=await req.json().catch(()=>({}));
  const reviewerId=await reviewer(text(body.init_data));
  const jwt=text(body.session_jwt);
  if(!jwt||jwt.length>8000) return reply({error:"Sign in using your BIG BROTHER administrator account to continue."},401);
  const client=service();
  const {data:auth,error:authError}=await client.auth.getUser(jwt);
  const appUser=auth?.user;
  if(authError||!appUser?.id)return reply({error:"Administrator session expired. Sign in again."},401);
  const {data:admin,error:adminError}=await client.from("app_users").select("user_id,role,active")
    .eq("user_id",appUser.id).eq("active",true).maybeSingle();
  if(adminError||!admin||text(admin.role).toLowerCase()!=="admin")return reply({error:"A BIG BROTHER administrator login is required."},403);
  const {data:telegramAdmin}=await client.from("bb_telegram_assistant_admins")
    .select("telegram_user_id").eq("telegram_user_id",reviewerId).maybeSingle();
  if(!telegramAdmin)return reply({error:"Telegram bank reviewer access not configured."},403);
  const id=text(body.draft_id);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
   return reply({error:"Invalid private bank review link."},400);
  const {data:draft,error:draftError}=await client.from("bb_bank_new_invoice_review_drafts").select("*")
   .eq("draft_id",id).eq("reviewer_telegram_user_id",reviewerId)
   .gt("expires_at",new Date().toISOString()).maybeSingle();
  if(draftError||!draft)return reply({error:"Bank review not found or expired."},404);
  const action=text(body.action);
  if(action==="load"){
   if(draft.status==="discarded")return reply({error:"This bank notice was ignored."},409);
   if(draft.status==="registered")return reply({ok:true,registered:true,transaction_id:draft.registered_transaction_id});
   const {data:matching,error:matchErr}=await client.rpc("bb_bank_identity_customer_ids_by_name",{p_name:draft.sender_name||""});
   if(matchErr)throw matchErr;
   return reply({ok:true,draft:{
    draft_id:draft.draft_id,amount:draft.amount,currency:draft.currency,
    sender_name:draft.sender_name,transaction_id:draft.transaction_id,
    bank_channel:draft.bank_channel,received_date:draft.received_date,
    source_chat_id:draft.source_chat_id,status:draft.status
   },suggested_customer_ids:(matching||[]).map((x:any)=>x.customer_id)});
  }
  if(action==="discard"){
   if(draft.status!=="reviewing")return reply({error:"This review is no longer pending."},409);
   const {error}=await client.from("bb_bank_new_invoice_review_drafts")
      .update({status:"discarded",updated_at:new Date().toISOString()})
      .eq("draft_id",id).eq("status","reviewing").eq("reviewer_telegram_user_id",reviewerId);
   if(error)throw error;
   return reply({ok:true,discarded:true});
  }
  if(action==="complete"){
   if(draft.status==="registered")return reply({ok:true,registered:true,already:true,transaction_id:draft.registered_transaction_id});
   if(draft.status!=="reviewing")return reply({error:"This review is not active."},409);
   const tid=text(body.transaction_id).toUpperCase(),customer=text(body.customer_id),payer=Number(body.payer_identity_id);
   if(!tid||tid.length>160||!customer||!Number.isSafeInteger(payer)||payer<=0)return reply({error:"Invalid transaction confirmation."},400);
   const {data:registered,error:registeredError}=await client.from("bb_verified_bank_transactions")
      .select("transaction_id,customer_id,amount,currency,status,created_by,payer_identity_id")
      .eq("transaction_id",tid).eq("customer_id",customer).eq("payer_identity_id",payer)
      .eq("created_by",appUser.id).maybeSingle();
   if(registeredError||!registered||registered.status!=="AVAILABLE")return reply({error:"Bank Register entry not found. Confirm through the protected Bank Register first."},409);
   // After the protected existing RPC succeeds, this is informational audit only.
   const {error}=await client.from("bb_bank_new_invoice_review_drafts").update({
     status:"registered",registered_transaction_id:tid,updated_at:new Date().toISOString()
   }).eq("draft_id",id).eq("status","reviewing").eq("reviewer_telegram_user_id",reviewerId);
   if(error)throw error;
   await telegramPrivate(reviewerId,"✅ NEW INVOICE BANK REGISTERED\nTransaction: "+tid+
     "\nCustomer: "+customer+"\nAmount: "+registered.amount+" "+registered.currency+
     "\nStatus: AVAILABLE — Invoice Generator only.\nNo A/R collection or payment was created.").catch(()=>{});
   return reply({ok:true,registered:true,transaction_id:tid});
  }
  return reply({error:"Unknown bank review operation"},400);
 }catch(error){
  console.error("Private new-invoice bank review error",error instanceof Error?error.name:"unknown");
  return reply({error:error instanceof Error?error.message:"Bank review unavailable"},400);
 }
});