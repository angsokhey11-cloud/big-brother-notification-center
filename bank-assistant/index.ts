// BIG BROTHER Bank Assistant — isolated Telegram webhook.
// Inactive unless TELEGRAM_BANK_ASSISTANT_CHAT_ID, TELEGRAM_BANK_ASSISTANT_WEBHOOK_SECRET,
// TELEGRAM_BANK_ASSISTANT_ADMIN_IDS and existing TELEGRAM_BOT_TOKEN are configured.
// Never stores incoming messages, slips, conversations or match suggestions.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const val=(x:unknown)=>String(x??"").trim();
const norm=(x:unknown)=>val(x).normalize("NFKC").toLocaleLowerCase("en").replace(/[\u200b-\u200d\ufeff]/g,"").replace(/[.,\-_]+/g," ").replace(/\s+/g," ").trim();
const amount=(x:unknown)=>Number(val(x).replace(/,/g,""));
const escape=(x:unknown)=>val(x).replace(/[&<>]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]||c));
type Bank={identity_id:number,customer_id:string,bank_name:string,account_holder_name:string,account_number:string|null,alternative_names:string[],active:boolean};
type Customer={customer_id:string,customer_name:string};
type Invoice={invoice_id:string,invoice_no:string,currency:string,outstanding:number};
const allowed=(id:unknown)=>val(Deno.env.get("TELEGRAM_BANK_ASSISTANT_ADMIN_IDS")).split(",").map(s=>s.trim()).filter(Boolean).includes(val(id));
const target=()=>val(Deno.env.get("TELEGRAM_BANK_ASSISTANT_CHAT_ID"));
const token=()=>val(Deno.env.get("TELEGRAM_BOT_TOKEN"));
const db=()=>createClient(Deno.env.get("SUPABASE_URL")||"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",{auth:{persistSession:false}});
async function tg(method:string,body:Record<string,unknown>){const r=await fetch("https://api.telegram.org/bot"+token()+"/"+method,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});if(!r.ok)throw Error("Telegram request failed: "+r.status);return r.json();}
async function reply(m:any,html:string,extra:Record<string,unknown>={}){
 return tg("sendMessage",{chat_id:m.chat.id,message_thread_id:m.message_thread_id,reply_to_message_id:m.message_id,text:html.slice(0,3900),parse_mode:"HTML",disable_web_page_preview:true,...extra});
}
function parseNotice(raw:string){
 const t=raw.slice(0,4500);
 const grab=(patterns:RegExp[])=>{for(const p of patterns){const x=t.match(p);if(x?.[1])return x[1].trim();}return "";};
 const sender=grab([/(?:sender|from|payer|account holder|received from|ឈ្មោះអ្នកផ្ញើ)\s*[:：\-]\s*([^\n\r]+)/i,/(?:sent by|transfer from)\s+([^\n\r]+)/i]);
 const account=grab([/(?:sender account|from account|payer account|account no\.?|account number)\s*[:：\-]\s*([\d*Xx\- ]{4,28})/i]);
 const currency=/(?:\bKHR\b|៛|\briel\b)/i.test(t)?"KHR":/(?:\bUSD\b|\$|\bdollar\b)/i.test(t)?"USD":"";
 const amt=grab([/(?:amount|received|payment|transfer amount|ចំនួនទឹកប្រាក់)\s*[:：\-]?\s*(?:USD|KHR|US\$|\$|៛)?\s*([\d,]+(?:\.\d{1,4})?)/i,/(?:USD|US\$|\$|KHR|៛)\s*([\d,]+(?:\.\d{1,4})?)/i]);
 const tx=grab([/(?:transaction\s*(?:id|number|no\.?|ref(?:erence)?)|reference\s*(?:id|no\.?|number)|trx\s*id)\s*[:：#\-]?\s*([A-Z0-9\-]{5,80})/i]);
 const bank=grab([/(?:sender bank|from bank|source bank|bank)\s*[:：\-]\s*([^\n\r]+)/i]);
 return {sender,account:val(account).replace(/[\s-]+/g,""),currency,amount:amt?amount(amt):null,transactionId:tx,bank};
}
function combos(rows:Invoice[],sum:number,currency:string){
 const exact=rows.filter(x=>norm(x.currency)===norm(currency)&&Number(x.outstanding)>0.000001).slice(0,16);
 const found:Invoice[][]=[];const cents=(n:number)=>Math.round(n*(currency==="KHR"?1:100));
 const goal=cents(sum),v=exact.map(x=>cents(Number(x.outstanding)));
 function walk(at:number,total:number,used:Invoice[]){
  if(found.length>=3)return;
  if(total===goal&&used.length){found.push([...used]);return;}
  if(total>goal||at>=exact.length)return;
  walk(at+1,total+v[at],[...used,exact[at]]);
  walk(at+1,total,used);
 }
 walk(0,0,[]);return found;
}
async function report(m:any,notice:ReturnType<typeof parseNotice>){
 const client=db();
 if(!notice.sender&&!notice.account)return reply(m,"🔎 <b>Customer not identified.</b>\nThe notification does not show a recognizable sender name or account number.");
 const {data:bankRows,error:bankError}=await client.from("bb_customer_bank_identities").select("identity_id,customer_id,bank_name,account_holder_name,account_number,alternative_names,active").eq("active",true).limit(2000);
 if(bankError)throw bankError;
 const nSender=norm(notice.sender),nBank=norm(notice.bank),nAccount=val(notice.account).replace(/[\s-]+/g,"");
 const candidates=new Set<string>(),strength=new Map<string,string>();
 for(const b of (bankRows||[]) as Bank[]){
  if(nBank&&norm(b.bank_name)&&norm(b.bank_name)!==nBank)continue;
  const savedAccount=val(b.account_number).replace(/[\s-]+/g,"");
  const accountMatch=!!nAccount&&!!savedAccount&&nAccount===savedAccount&&!nAccount.includes("*");
  const nameMatch=!!nSender&&[b.account_holder_name,...(b.alternative_names||[])].some(name=>norm(name)===nSender);
  if(!accountMatch&&!nameMatch)continue;
  candidates.add(b.customer_id);
  strength.set(b.customer_id,accountMatch?"Account number match":"Sender name match");
 }
 if(!candidates.size)return reply(m,"🔎 <b>Customer not identified.</b>\nSender: "+escape(notice.sender||"Not provided")+"\nNo saved bank identity matched. An administrator can teach me using:\n<code>/bankadd CUSTOMER_ID | BANK | SENDER NAME | OPTIONAL ACCOUNT</code>");
 const ids=[...candidates].slice(0,8);
 const {data:people,error:peopleErr}=await client.from("customers").select("customer_id,customer_name").in("customer_id",ids);
 if(peopleErr)throw peopleErr;
 let head=ids.length>1?"⚠️ <b>Shared bank identity: multiple possible customers.</b>":"✅ <b>Possible customer identified.</b>";
 head+="\nSender: "+escape(notice.sender||"Not provided");
 if(notice.currency&&notice.amount!==null)head+="\nTransfer: "+escape(notice.currency)+" "+escape(notice.amount);
 if(notice.transactionId){
  const [pay,reg,dep]=await Promise.all([
    client.from("payments").select("payment_id").ilike("transaction_id",notice.transactionId).limit(1),
    client.from("bb_verified_bank_transactions").select("status").ilike("transaction_id",notice.transactionId).limit(1),
    client.from("company_deposits").select("deposit_id").ilike("collection_transaction_id",notice.transactionId).limit(1)
  ]);
  if(pay.data?.length||reg.data?.length||dep.data?.length)head+="\n⚠️ <b>Transaction ID already recorded or registered. Review before proceeding.</b>";
 }
 for(const c of (people||[]) as Customer[]){
  head+="\n\n👤 <b>"+escape(c.customer_name)+"</b> ("+escape(c.customer_id)+")\n"+escape(strength.get(c.customer_id)||"Bank identity match");
  const {data:open,error:openError}=await client.from("invoices").select("invoice_id,invoice_no,currency,outstanding").eq("customer_id",c.customer_id).gt("outstanding",0).order("invoice_date",{ascending:true}).limit(35);
  if(openError){head+="\nReceivables currently unavailable.";continue;}
  const rows=(open||[]) as Invoice[];
  if(!rows.length){head+="\nNo outstanding receivables; possibly a new invoice or another payment.";continue;}
  head+="\nOutstanding invoices: "+rows.length;
  if(notice.currency&&notice.amount!==null&&notice.amount>0){
   const matches=combos(rows,notice.amount,notice.currency);
   if(matches.length){head+="\n<b>Possible exact receivable combinations:</b>";
    for(const group of matches){head+="\n• "+group.map(x=>escape(x.invoice_no)+" ("+escape(x.currency)+" "+escape(x.outstanding)+")").join(" + ");}
   }else head+="\nNo exact same-currency receivable combination found; could be partial A/R, cross-currency payment, new invoice or another transaction.";
  }else head+="\nTransfer amount/currency not confirmed, so no amount matching performed.";
 }
 head+="\n\n<i>Identification and suggestions only. No payment or invoice was changed.</i>";
 return reply(m,head);
}
function addCmd(t:string){
 const content=t.replace(/^\/bankadd(?:@\w+)?\s*/i,"");
 const parts=content.split("|").map(x=>x.trim());
 if(parts.length<3||parts.slice(0,3).some(x=>!x))return null;
 return {customer:parts[0],bank:parts[1],holder:parts[2],account:parts[3]||""};
}
async function handle(m:any){
 const t=val(m.text||m.caption);
 if(/^\/bankhelp(?:@\w+)?$/i.test(t))return reply(m,"🏦 <b>BIG BROTHER Bank Assistant</b>\nForward bank notifications to this group to identify customers and inspect possible A/R matches.\nTo teach me an identity, reply with:\n<code>/bankadd CUSTOMER_ID | BANK | SENDER NAME | OPTIONAL ACCOUNT</code>\nAdmin confirmation is required. No conversations are stored.");
 if(/^\/bankadd(?:@\w+)?\b/i.test(t)){
  if(!allowed(m.from?.id))return reply(m,"Only authorized Telegram administrators may add bank identities.");
  const data=addCmd(t);
  if(!data)return reply(m,"Format: <code>/bankadd CUSTOMER_ID | BANK | SENDER NAME | OPTIONAL ACCOUNT</code>");
  const {data:c}=await db().from("customers").select("customer_id,customer_name").eq("customer_id",data.customer).eq("active",true).maybeSingle();
  if(!c)return reply(m,"Customer ID not found. Check the ID in Customer Editor.");
  // No pending conversation stored: confirmation details live only in this bot message.
  return reply(m,"🏦 <b>Confirm new bank identity</b>\nCustomer: "+escape(c.customer_name)+"\nCustomer ID: <code>"+escape(data.customer)+"</code>\nBank: <code>"+escape(data.bank)+"</code>\nAccount holder: <code>"+escape(data.holder)+"</code>\nAccount number: <code>"+escape(data.account||"—")+"</code>\nOnly confirm if you checked the sender identity.",{reply_markup:{inline_keyboard:[[{text:"✅ Confirm & save",callback_data:"bbbank:confirm"},{text:"Cancel",callback_data:"bbbank:cancel"}]]}});
 }
 // Only inspect forwarded messages or direct slips/text notifications posted inside our dedicated group.
 if(m.photo?.length&&!t)return reply(m,"I received a picture, but this version requires sender details in the message or caption. Please forward the bank notification text or add the visible sender name as a caption. I will not guess from an unreadable slip.");
 if(!t)return;
 if(!m.forward_origin&&!m.forward_date&&!/(?:received|transfer|transaction|sender|payer|payment|amount|\$|៛)/i.test(t))return;
 return report(m,parseNotice(t));
}
async function callback(cb:any){
 const m=cb.message,choice=val(cb.data),id=cb.id;
 if(!m||!allowed(cb.from?.id)){await tg("answerCallbackQuery",{callback_query_id:id,text:"Only approved administrators can save bank identities.",show_alert:true});return;}
 if(choice==="bbbank:cancel"){await tg("answerCallbackQuery",{callback_query_id:id,text:"Cancelled."});return;}
 if(choice!=="bbbank:confirm")return;
 const t=val(m.text);
 const field=(name:string)=>{const rx=new RegExp("^"+name+":\\s*(.+)$","mi");return val(t.match(rx)?.[1]);};
 const customer=field("Customer ID"),bank=field("Bank"),holder=field("Account holder"),account=field("Account number");
 if(!customer||!bank||!holder||account.length>90||bank.length>90||holder.length>140){await tg("answerCallbackQuery",{callback_query_id:id,text:"Unable to validate confirmation.",show_alert:true});return;}
 const client=db();
 const {data:existing}=await client.from("bb_customer_bank_identities").select("identity_id").eq("customer_id",customer).ilike("bank_name",bank).ilike("account_holder_name",holder).eq("active",true).limit(1);
 if(existing?.length){await tg("answerCallbackQuery",{callback_query_id:id,text:"This identity already exists."});return;}
 const {error}=await client.from("bb_customer_bank_identities").insert({customer_id:customer,bank_name:bank,account_holder_name:holder,account_number:account==="—"?null:account});
 if(error){await tg("answerCallbackQuery",{callback_query_id:id,text:"Could not save bank identity.",show_alert:true});return;}
 await tg("answerCallbackQuery",{callback_query_id:id,text:"Customer bank identity saved."});
 await tg("editMessageReplyMarkup",{chat_id:m.chat.id,message_id:m.message_id,reply_markup:{inline_keyboard:[]}});
 await reply(m,"✅ Bank identity saved. Future notifications can match this customer.");
}
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return new Response("Method not allowed",{status:405});
 const secret=val(Deno.env.get("TELEGRAM_BANK_ASSISTANT_WEBHOOK_SECRET"));
 if(!secret||!target()||!token()||!val(Deno.env.get("TELEGRAM_BANK_ASSISTANT_ADMIN_IDS")))return new Response("Bank Assistant is not configured",{status:503});
 if(val(req.headers.get("X-Telegram-Bot-Api-Secret-Token"))!==secret)return new Response("Unauthorized",{status:401});
 try{
  const u=await req.json(),m=u.message||u.edited_message;
  if(m&&val(m.chat?.id)===target())await handle(m);
  if(u.callback_query&&val(u.callback_query.message?.chat?.id)===target())await callback(u.callback_query);
  return Response.json({ok:true});
 }catch(e){console.error("Bank Assistant request failed", e instanceof Error?e.name:"error");return Response.json({ok:false},{status:500});}
});