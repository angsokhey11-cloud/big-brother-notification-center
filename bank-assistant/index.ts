// BIG BROTHER: inbound Telegram dispatcher. Topic routing and webhook authentication are configured in Supabase.
// Temporarily queues eligible bank-forward messages only to preserve FIFO processing, then deletes each queue item after handling.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const val=(x:unknown)=>String(x??"").trim();
const norm=(x:unknown)=>val(x).normalize("NFKC").toLocaleLowerCase("en").replace(/[\u200b-\u200d\ufeff]/g,"").replace(/[.,\-_]+/g," ").replace(/\s+/g," ").trim();
const amount=(x:unknown)=>Number(val(x).replace(/,/g,""));
const escape=(x:unknown)=>val(x).replace(/[&<>]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]||c));
type Bank={identity_id:number,customer_id:string,bank_name:string,account_holder_name:string,account_number:string|null,alternative_names:string[],active:boolean};
type Customer={customer_id:string,customer_name:string};
type Invoice={invoice_id:string,invoice_no:string,currency:string,outstanding:number};
const allowed=async(id:unknown)=>{if(!val(id))return false;const {data,error}=await db().from("bb_telegram_assistant_admins").select("telegram_user_id").eq("telegram_user_id",val(id)).limit(1);return !error&&!!data?.length;};
type RouteScope={location_code:string|null,access_mode:"legacy"|"staff_location"|"admin_only"};
async function bankScope(m:any):Promise<RouteScope|null>{
 if(!m?.chat?.id)return null;
 const chat=val(m.chat.id),thread=Number(m.message_thread_id||0);
 const client=db();
 const {data:legacy,error:legacyError}=await client.from("bb_telegram_assistant_routes").select("route_id").eq("assistant_key","bank_assistant").eq("telegram_chat_id",chat).eq("telegram_thread_id",thread).eq("active",true).limit(1);
 if(legacyError)throw legacyError;
 if(legacy?.length)return {location_code:null,access_mode:"legacy"};
 const {data:routes,error}=await client.from("bb_telegram_assistant_group_routes").select("location_code,access_mode")
 .eq("assistant_key","bank_assistant").eq("telegram_chat_id",chat).eq("telegram_thread_id",thread).eq("active",true).limit(1);
 if(error)throw error;
 if(!routes?.length)return null;
 return {location_code:routes[0].location_code,access_mode:routes[0].access_mode};
}
async function scopeAllows(m:any,scope:RouteScope){
 if(scope.access_mode==="legacy")return true;
 if(await allowed(m.from?.id))return true;
 if(scope.access_mode!=="staff_location"||!scope.location_code||!m.from?.id)return false;
 // Only explicitly verified personal Telegram/staff links are considered.
 const client=db();
 const {data:links,error}=await client.from("telegram_staff_links").select("staff_id").eq("telegram_chat_id",val(m.from.id)).eq("active",true).not("verified_at","is",null).limit(20);
 if(error||!links?.length)return false;
 const staffIds=links.map((x:any)=>x.staff_id);
 const {data:locations,error:locError}=await client.from("locations").select("location_code").eq("location_code",scope.location_code).in("salesperson_staff_id",staffIds).eq("active",true).limit(1);
 return !locError&&!!locations?.length;
}
const token=()=>val(Deno.env.get("TELEGRAM_BOT_TOKEN"));
const db=()=>createClient(Deno.env.get("SUPABASE_URL")||"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",{auth:{persistSession:false}});
async function tg(method:string,body:Record<string,unknown>){const r=await fetch("https://api.telegram.org/bot"+token()+"/"+method,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});if(!r.ok)throw Error("Telegram request failed: "+r.status);return r.json();}
let commandsReady=false;
async function ensureTelegramCommands(){
 if(commandsReady)return;
 // Telegram keeps separate slash-command menus for 1:1 chats and groups.
 // Preserve the existing Bank Assistant menu and register a private organizer menu.
 const definitions=[
  {scope:{type:"all_group_chats"},commands:[
   {command:"help",description:"Show supported bank notice formats"},
   {command:"bankhelp",description:"Show Bank Assistant help"},
   {command:"bankadd",description:"Request sender mapping (Admin approval required)"},
    {command:"reviewtransaction",description:"Prepare private bank transaction review"},
   {command:"myid",description:"Show your Telegram user ID"},
   {command:"groupid",description:"Show this group and topic ID for routing"}
  ]},
  {scope:{type:"all_private_chats"},commands:[
   {command:"start",description:"Welcome and show your Telegram ID"},
   {command:"help",description:"Show the private bot command menu"},
   {command:"myid",description:"Show your Telegram User ID"},
   {command:"photo",description:"Check Invoice Photo Organizer mapping"},
   {command:"phototest",description:"Test group and private message delivery"},
   {command:"review",description:"Open picture review with date and number boxes"},
    {command:"reviewtransaction",description:"Review bank transfers privately on request"},
   {command:"done",description:"Finish forwarding pictures and open review"},
   {command:"cancel",description:"Discard the pending forwarded-photo batch"}
  ]}
 ];
 const results=await Promise.all(definitions.map(d=>tg("setMyCommands",d)));
 if(results.some(x=>x?.ok!==true))throw Error("Telegram rejected command registration");
 commandsReady=true;
}
async function reply(m:any,html:string,extra:Record<string,unknown>={}){
 const destination:Record<string,unknown>={chat_id:m.chat.id,reply_to_message_id:m.message_id,text:html.slice(0,3900),parse_mode:"HTML",disable_web_page_preview:true,...extra};
 if(Number(m.message_thread_id)>0)destination.message_thread_id=m.message_thread_id;
 return tg("sendMessage",destination);
}
// Discover Telegram routing identifiers directly in ANY group/topic, including
// groups not configured yet in Telegram Manager. No finance or membership data used.
async function replyGroupAndTopicIds(m:any):Promise<boolean>{
 const command=val(m?.text);
 if(!/^\/(?:groupid|topicid|chatid)(?:@\w+)?$/i.test(command))return false;
 if(m?.from?.is_bot)return true;
 const type=val(m?.chat?.type);
 if(type!=="group"&&type!=="supergroup"){
  await reply(m,"🏦 Send <code>/groupid</code> inside the Telegram group or topic you want to map. I will reply with its Group ID and Topic ID.");
  return true;
 }
 const chatId=val(m.chat.id),rawTopic=Number(m.message_thread_id||0);
 const topic=Number.isSafeInteger(rawTopic)&&rawTopic>0?rawTopic:0;
 const name=val(m.chat.title);
 const title=name?"\nGroup: <b>"+escape(name)+"</b>":"";
 const answer="🏦 <b>BIG BROTHER — Telegram Routing IDs</b>"+title+
  "\n\n📍 <b>Group ID</b>\n<code>"+escape(chatId)+"</code>"+
  "\n\n🧵 <b>Topic ID</b>\n<code>"+topic+"</code>"+
  (topic===0?"\n<i>0 means this message has no separate topic ID (general group/chat).</i>":"")+
  "\n\nCopy these values into Telegram Manager → Bank Assistant / Personal Review Routes.";
 await reply(m,answer);
 return true;
}
async function clearReplyMarkup(chatId:unknown,messageId:unknown){
 const chat=val(chatId),id=Number(messageId||0);
 if(!chat||!Number.isSafeInteger(id)||id<1)return;
 try{await tg("editMessageReplyMarkup",{chat_id:chat,message_id:id,reply_markup:{inline_keyboard:[]}});}catch(_){}
}
function parseNotice(raw:string){
 const t=raw.slice(0,4500).trim();
 const grab=(patterns:RegExp[])=>{for(const p of patterns){const x=t.match(p);if(x?.[1])return x[1].trim();}return "";};
 const cleanSender=(value:string)=>val(value)
   .replace(/\s+(?:on|at|via|trx\.?\s*id|transaction\s*(?:id|no\.?|number)|reference\s*(?:id|no\.?|number))\b.*$/i,"")
   .replace(/^[\s:;|,\-–—]+|[\s:;|,\-–—]+$/g,"")
   .trim();

 // High-confidence ABA PayWay parser stays first.
 const payway=t.match(/(?:៛|KHR\b|\bUSD\b|US\$|\$)\s*([\d,]+(?:\.\d{1,4})?)\s+paid\s+by\s+(.+?)\s*\(\s*[*xX•]*\s*\d{2,8}\s*\)\s+on\b/i);

 // Generic money + sender patterns. Transaction ID is optional.
 // Examples:
 // "$50 from Ly Sreyleak"
 // "50$ from Ly Sreyleak"
 // "Received USD 50 from Ly Sreyleak"
 // "Ly Sreyleak paid $50"
 // "Ly Sreyleak transfer 50 USD"
 // "50$ - Ly Sreyleak"
 const moneyToken="(?:USD|US\\$|\\$|KHR|៛)\\s*[\\d,]+(?:\\.\\d{1,4})?|[\\d,]+(?:\\.\\d{1,4})?\\s*(?:USD|US\\$|\\$|KHR|៛)";
 const genericPatterns=[
   new RegExp("(?:received|receive|payment|paid|transfer(?:red)?|sent)?\\s*("+moneyToken+")\\s*(?:from|by|payer|sender)\\s*[:：-]?\\s*([^\\n\\r]+)","i"),
   new RegExp("^\\s*("+moneyToken+")\\s*[-–—|:]\\s*([^\\n\\r]+)","i"),
   new RegExp("^\\s*([^\\n\\r]{2,140}?)\\s+(?:paid|pays|sent|send|transfer(?:red)?|transfers?)\\s*[:：-]?\\s*("+moneyToken+")","i")
 ];

 let genericAmountToken="",genericSender="";
 for(let i=0;i<genericPatterns.length;i++){
   const m=t.match(genericPatterns[i]);
   if(!m)continue;
   if(i<2){genericAmountToken=val(m[1]);genericSender=cleanSender(val(m[2]));}
   else {genericSender=cleanSender(val(m[1]));genericAmountToken=val(m[2]);}
   if(genericAmountToken&&genericSender)break;
 }

 const labelledSender=grab([
   /(?:sender|from|payer|account holder|received from|ឈ្មោះអ្នកផ្ញើ|អ្នកផ្ទេរ)\s*[:：\-]\s*([^\n\r]+)/i,
   /(?:sent by|transfer from|paid by)\s+([^\n\r]+)/i
 ]);
 const sender=cleanSender(payway?.[2]?.trim()||genericSender||labelledSender);

 const moneySource=payway?((t.match(/(?:៛|KHR\b|\bUSD\b|US\$|\$)\s*[\d,]+(?:\.\d{1,4})?/i)||[])[0]||""):genericAmountToken;
 const currency=/(?:៛|\bKHR\b|\briel\b)/i.test(moneySource||t)
   ?"KHR"
   :/(?:\bUSD\b|US\$|\$|\bdollar\b)/i.test(moneySource||t)
     ?"USD"
     :"";

 const rawAmount=payway?.[1]
   ||(genericAmountToken.match(/[\d,]+(?:\.\d{1,4})?/)||[])[0]
   ||grab([
     /(?:amount|received|payment|transfer amount|ចំនួនទឹកប្រាក់)\s*[:：\-]?\s*(?:USD|KHR|US\$|\$|៛)?\s*([\d,]+(?:\.\d{1,4})?)/i,
     /(?:USD|US\$|\$|KHR|៛)\s*([\d,]+(?:\.\d{1,4})?)/i,
     /([\d,]+(?:\.\d{1,4})?)\s*(?:USD|US\$|\$|KHR|៛)/i
   ]);

 const tx=grab([
   /\bTrx\.?\s*ID\s*[:：#\-]?\s*([A-Z0-9\-]{5,80})/i,
   /(?:transaction\s*(?:id|number|no\.?|ref(?:erence)?)|reference\s*(?:id|no\.?|number))\s*[:：#\-]?\s*([A-Z0-9\-]{5,80})/i
 ]);

 return {
   sender,
   currency,
   amount:rawAmount?amount(rawAmount):null,
   transactionId:tx,
   channel:payway?grab([/\bvia\s+(ABA KHQR)\b/i]):""
 };
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
function noticeDetails(n:ReturnType<typeof parseNotice>){
 let result="\nឈ្មោះអ្នកផ្ទេរ៖ <b>"+escape(n.sender||"មិនមានឈ្មោះ")+"</b>";
 if(n.currency&&n.amount!==null)result+="\nចំនួនទឹកប្រាក់៖ "+escape(n.currency)+" "+escape(n.amount.toLocaleString("en-US",{maximumFractionDigits:2}));
 if(n.transactionId)result+="\nលេខប្រតិបត្តិការ៖ "+escape(n.transactionId);
 if(n.channel)result+="\nប្រភេទផ្ទេរ៖ "+escape(n.channel)+" (មិនមែនជាធនាគាររបស់អ្នកផ្ញើដែលបានផ្ទៀងផ្ទាត់)";
 return result;
}
// Offer a bank register review, never create any accounting record on detection.
// This is limited to parsed bank notices posted in authorized Bank Assistant routes.
// Silently retain structured bank notice metadata for on-demand review.
// This function never starts a task and never writes to Bank Register.
async function newInvoiceRegisterPrompt(m:any,notice:ReturnType<typeof parseNotice>){
 if(!notice.sender||!notice.currency||notice.amount===null||!Number.isFinite(notice.amount)||notice.amount<=0)return {};
 const chat=val(m.chat?.id),thread=Number(m.message_thread_id||0),mid=Number(m.message_id);
 if(!chat||!Number.isSafeInteger(mid)||mid<=0)return {};
 const {error}=await db().from("bb_bank_new_invoice_review_drafts").upsert({
  source_chat_id:chat,source_thread_id:thread,source_message_id:mid,
  sender_name:notice.sender,transaction_id:notice.transactionId||null,
  amount:notice.amount,currency:notice.currency,bank_channel:notice.channel||null
 },{onConflict:"source_chat_id,source_thread_id,source_message_id",ignoreDuplicates:true});
 if(error)console.warn("Bank notice review metadata capture failed",error.code||"db");
 return {};
}
async function newInvoiceRegisterClick(cb:any,_scope:RouteScope){
 if(!/^bbnew:/i.test(val(cb.data)))return false;
 await tg("answerCallbackQuery",{callback_query_id:cb.id,text:"Send /reviewtransaction in your Bank Assistant topic to get a private review batch.",show_alert:true});
 return true;
}
// Explicit trigger only: one private reviewer is assigned to every mapped group/topic.
async function beginBankTransactionReview(m:any,scope:RouteScope|null){
 const sender=val(m.from?.id),privateChat=m.chat?.type==="private"&&val(m.chat.id)===sender;
 if(!await allowed(sender)){
  await reply(m,"🔒 Only an authorized Bank Assistant administrator can request a private transaction review.");
  return;
 }
 if(!privateChat&&!scope){
  await reply(m,"🔒 Review is available only in a mapped Bank Assistant group/topic or your personal bot chat.");
  return;
 }
 let reviewer=sender;
 if(!privateChat){
  const {data:mapping,error:mapError}=await db().from("bb_bank_review_personal_routes")
   .select("reviewer_telegram_user_id").eq("source_chat_id",val(m.chat.id))
   .eq("source_thread_id",Number(m.message_thread_id||0)).eq("active",true).maybeSingle();
  if(mapError)throw mapError;
  if(!mapping?.reviewer_telegram_user_id){
   await reply(m,"🏦 No personal review account mapped for this Bank Assistant topic. Configure it in Telegram Manager → Bank Personal Review Routes.");
   return;
  }
  reviewer=val(mapping.reviewer_telegram_user_id);
 }
 const {data,error}=await db().rpc("bb_bank_start_transaction_review",{
  p_reviewer:reviewer,p_chat:privateChat?null:val(m.chat.id),
  p_thread:privateChat?null:Number(m.message_thread_id||0)
 });
 if(error){await reply(m,"⚠️ Unable to start bank review: "+escape(error.message.slice(0,220)));return;}
 const count=Number(data?.count||0),batch=val(data?.batch_id);
 if(!batch||count<1){
  await reply(m,"🏦 No unreviewed bank notifications available for this mapped topic. Keep forwarding normally, then ask /reviewtransaction.");
  return;
 }
 const url="https://angsokhey11-cloud.github.io/big-brother-notification-center/bank-transaction-batch-review.html?batch="+
  encodeURIComponent(batch)+"&v=staged-versus-registered-20261010";
 try{
  const sent=await tg("sendMessage",{
    chat_id:reviewer,
    text:"🏦 <b>BIG BROTHER — Personal Bank Transaction Review</b>\n\n"+
      "📋 <b>"+count+" transactions</b> to review.\n"+
      "Only NEW Invoice Generator payments may be registered. Leave A/R and unrelated transfers alone.\n"+
      "No registration occurs until you approve each New Invoice payment and confirm the summary.",
    parse_mode:"HTML",reply_markup:{inline_keyboard:[[
      {text:"📋 Open "+count+" Bank Transactions",web_app:{url}}
    ]]}
  });
  if(sent?.ok!==true)throw Error("Telegram message not accepted");
  if(!privateChat)await reply(m,"✅ On-demand bank review sent to the mapped personal Telegram account. Normal transaction analysis remains unchanged.");
 }catch(_){
  await reply(m,"⚠️ Telegram could not deliver this review privately. The mapped reviewer must first open the bot and send /start. The review batch remains saved; no bank transactions were registered.");
 }
}
async function report(m:any,notice:ReturnType<typeof parseNotice>,scope:RouteScope){
 const client=db();
 if(!notice.sender)return reply(m,"🔎 <b>មិនអាចកំណត់អតិថិជនបាន</b>"+noticeDetails(notice)+"\nមិនមានឈ្មោះអ្នកផ្ទេរដែលអាចសម្គាល់បាន។");

 const {data:identityRows,error:identityError}=await client.rpc("bb_bank_identity_customer_ids_by_name",{p_name:notice.sender});
 if(identityError)throw identityError;
 const ids=(identityRows||[]).map((x:any)=>x.customer_id).filter(Boolean).slice(0,8);

 if(!ids.length)return reply(m,"🔎 <b>អានប្រតិបត្តិការបានហើយ ប៉ុន្តែមិនទាន់ស្គាល់អតិថិជន</b>"+noticeDetails(notice)+"\n\nមិនទាន់មានឈ្មោះអ្នកផ្ទេរនេះក្នុងបញ្ជីអតិថិជនទេ។ សូមពិនិត្យឈ្មោះ រួចបន្ថែមដោយប្រើ៖\n<code>/bankadd CUSTOMER_ID | SENDER NAME</code>.\n\n🏦 For a NEW Invoice Generator invoice, an admin can review and register this transfer privately.",await newInvoiceRegisterPrompt(m,notice));

 let peopleQuery=client.from("customers").select("customer_id,customer_name").in("customer_id",ids);
 if(scope.location_code)peopleQuery=peopleQuery.eq("location_code",scope.location_code);

 const invoicesQuery=client.from("invoices")
   .select("invoice_id,invoice_no,customer_id,currency,outstanding,invoice_date")
   .in("customer_id",ids)
   .gt("outstanding",0)
   .order("invoice_date",{ascending:true})
   .limit(280);

 const duplicatePromise=notice.transactionId
   ? Promise.all([
      client.from("payments").select("payment_id").ilike("transaction_id",notice.transactionId).limit(1),
      client.from("bb_verified_bank_transactions").select("status").ilike("transaction_id",notice.transactionId).limit(1),
      client.from("company_deposits").select("deposit_id").ilike("collection_transaction_id",notice.transactionId).limit(1),
      client.from("bb_cancelled_bank_transaction_ids").select("transaction_id").ilike("transaction_id",notice.transactionId).limit(1)
     ]).then(([pay,reg,dep,cancelled])=>!!(pay.data?.length||reg.data?.length||dep.data?.length||cancelled.data?.length))
   : Promise.resolve(false);

 const [peopleResult,invoicesResult,isDuplicate]=await Promise.all([
   peopleQuery,
   invoicesQuery,
   duplicatePromise
 ]);

 if(peopleResult.error)throw peopleResult.error;
 if(invoicesResult.error)throw invoicesResult.error;

 const people=(peopleResult.data||[]) as Customer[];
 if(!people.length)return reply(m,"🔎 មិនមានអតិថិជនត្រូវនឹងឈ្មោះនេះនៅក្នុងទីតាំងដែលបានអនុញ្ញាតទេ។",await newInvoiceRegisterPrompt(m,notice));

 const invoiceRows=(invoicesResult.data||[]) as (Invoice&{customer_id:string,invoice_date?:string})[];
 const invoiceByCustomer=new Map<string,Invoice[]>();
 for(const row of invoiceRows){
   const list=invoiceByCustomer.get(row.customer_id)||[];
   if(list.length<35)list.push(row);
   invoiceByCustomer.set(row.customer_id,list);
 }

 let head=people.length>1?"⚠️ <b>ឈ្មោះអ្នកផ្ទេរនេះត្រូវនឹងអតិថិជនច្រើននាក់</b>":"✅ <b>រកឃើញអតិថិជនដែលអាចត្រូវនឹងឈ្មោះនេះ</b>";
 head+=noticeDetails(notice);

 if(isDuplicate)head+="\n⚠️ <b>លេខប្រតិបត្តិការនេះមានក្នុងប្រវត្តិទូទាត់ ឬបញ្ជីធនាគាររួចហើយ។ សូមពិនិត្យមុនបន្ត។</b>";

 for(const c of people){
  head+="\n\n👤 <b>"+escape(c.customer_name)+"</b> ("+escape(c.customer_id)+")\nផ្គូផ្គងតាមឈ្មោះអ្នកផ្ទេរ";
  const rows=invoiceByCustomer.get(c.customer_id)||[];
  if(!rows.length){head+="\nមិនមានវិក្កយបត្រជំពាក់។ អាចជាការទូទាត់វិក្កយបត្រថ្មី ឬប្រតិបត្តិការផ្សេង។";continue;}
  head+="\nវិក្កយបត្រមិនទាន់ទូទាត់៖ "+rows.length;
  if(notice.currency&&notice.amount!==null&&notice.amount>0){
   const matches=combos(rows,notice.amount,notice.currency);
   if(matches.length){
    head+="\n<b>វិក្កយបត្រជំពាក់ដែលអាចត្រូវនឹងចំនួនទឹកប្រាក់៖</b>";
    for(const group of matches){
      head+="\n• "+group.map(x=>escape(x.invoice_no)+" ("+escape(x.currency)+" "+escape(x.outstanding)+")").join(" + ");
    }
   }else{
    head+="\nរកមិនឃើញវិក្កយបត្រជំពាក់ដែលមានរូបិយប័ណ្ណ និងចំនួនទឹកប្រាក់ត្រូវគ្នាទាំងស្រុងទេ។ អាចជាការបង់មួយផ្នែក ការបង់ឆ្លងរូបិយប័ណ្ណ វិក្កយបត្រថ្មី ឬប្រតិបត្តិការផ្សេង។";
   }
  }else{
   head+="\nមិនទាន់មានចំនួនទឹកប្រាក់ ឬរូបិយប័ណ្ណច្បាស់លាស់ ដូច្នេះមិនទាន់ផ្គូផ្គងវិក្កយបត្រទេ។";
  }
 }

 head+="\n\n<i>នេះគ្រាន់តែជាការសម្គាល់ និងការណែនាំប៉ុណ្ណោះ។ គ្មានការកែប្រែការទូទាត់ ឬវិក្កយបត្រឡើយ។</i>";
 return reply(m,head+"\n\n🏦 New Invoice registration is admin-review-only. Do not use it for A/R or unrelated payments.",await newInvoiceRegisterPrompt(m,notice));
}
function whoIsName(text:string){
 const t=val(text).replace(/[?？!។.]+\s*$/u,"").trim();
 // Deliberately scoped to sender identity questions; normal bank forwards
 // and unrelated conversation continue through the existing handlers.
 const patterns=[
  /^(?:who\s+is|who['’]?s|which\s+customer\s+is|identify(?:\s+sender)?)\s+(.+)$/i,
  /^(?:តើ\s*)?(.+?)\s*(?:ជា\s*នរណា|គឺ\s*ជា\s*នរណា|ជា\s*អ្នកណា|គឺ\s*អ្នកណា)$/u,
  /^(?:តើ\s*)?(?:ឈ្មោះ|អ្នកផ្ទេរ|ម្ចាស់គណនី)\s*(.+?)\s*(?:ជា\s*អតិថិជន\s*(?:ណា|មួយណា)|របស់\s*អតិថិជន\s*(?:ណា|មួយណា))$/u,
  /^(?:តើ\s*)?(.+?)\s*(?:ជា\s*អតិថិជន\s*(?:ណា|មួយណា)|របស់\s*អតិថិជន\s*(?:ណា|មួយណា))$/u,
 ];
 for(const pattern of patterns){
  const match=t.match(pattern);
  if(match?.[1])return val(match[1]).replace(/^ឈ្មោះ\s*/u,"").trim();
 }
 return "";
}
async function answerWhoIs(m:any,rawName:string,scope:RouteScope){
 const queried=norm(rawName);
 if(queried.length<2||queried.length>150)return reply(m,"សូមសួរដោយប្រើឈ្មោះអ្នកផ្ទេរ ឧទាហរណ៍៖ <code>Who is KEO LAKHENA?</code> ឬ <code>តើ KEO LAKHENA ជានរណា?</code>");
 const client=db();
 const {data:rows,error}=await client.from("bb_customer_bank_identities")
   .select("customer_id,account_holder_name,alternative_names").eq("active",true).limit(2000);
 if(error)throw error;
 // Identity is attached to a customer, not an individual's verified identity.
 const ids=new Set<string>();
 for(const entry of rows||[]){
  const names=[entry.account_holder_name,...(entry.alternative_names||[])];
  if(names.some((name:string)=>norm(name)===queried))ids.add(entry.customer_id);
 }
 if(!ids.size)return reply(m,"🔎 <b>មិនមានឈ្មោះអ្នកផ្ទេរនេះក្នុងបញ្ជី</b>\nឈ្មោះ៖ "+escape(rawName)+"\nខ្ញុំមិនទាន់មានព័ត៌មានបញ្ជាក់ថាឈ្មោះនេះភ្ជាប់នឹងអតិថិជនណាទេ។\nបើលោកអ្នកស្គាល់អតិថិជន អ្នកគ្រប់គ្រងដែលមានសិទ្ធិអាចបន្ថែមតាម៖\n<code>/bankadd CUSTOMER_ID | SENDER NAME</code>");
 const customerIds=[...ids].slice(0,12);
 let customersQuery=client.from("customers").select("customer_id,customer_name").in("customer_id",customerIds);
 if(scope.location_code)customersQuery=customersQuery.eq("location_code",scope.location_code);
 const {data:customers,error:peopleError}=await customersQuery;
 if(peopleError)throw peopleError;
 if(!customers?.length)return reply(m,"🔎 មិនមានអតិថិជនត្រូវនឹងឈ្មោះនេះនៅក្នុងទីតាំងដែលបានអនុញ្ញាតទេ។");
 let msg=customers.length>1?"⚠️ <b>ឈ្មោះអ្នកផ្ទេរនេះភ្ជាប់នឹងអតិថិជនច្រើននាក់</b>":"🔎 <b>លទ្ធផលស្វែងរកឈ្មោះអ្នកផ្ទេរ</b>";
 msg+="\nឈ្មោះអ្នកផ្ទេរ៖ <b>"+escape(rawName)+"</b>";
 if(ids.size>12)msg+="\nបង្ហាញត្រឹម ១២ លទ្ធផលដំបូង។ សូមពិនិត្យបញ្ជីឈ្មោះអ្នកផ្ទេរសម្រាប់ព័ត៌មានទាំងអស់។";
 for(const c of customers||[]){
  msg+="\n\n👤 <b>"+escape(c.customer_name)+"</b> ("+escape(c.customer_id)+")";
  const {data:open,error:openError}=await client.from("invoices")
    .select("invoice_no,currency,outstanding").eq("customer_id",c.customer_id)
    .gt("outstanding",0).order("invoice_date",{ascending:true}).limit(100);
  if(openError){msg+="\nមិនអាចទាញយកព័ត៌មានបំណុលបាននៅពេលនេះ។";continue;}
  if(!open?.length){msg+="\nមិនមានវិក្កយបត្រជំពាក់។";continue;}
  const totals=new Map<string,number>();
  for(const invoice of open){
    const currency=val(invoice.currency).toUpperCase()||"USD";
    totals.set(currency,(totals.get(currency)||0)+Number(invoice.outstanding||0));
  }
  msg+="\nវិក្កយបត្រមិនទាន់ទូទាត់៖ "+open.length+(open.length===100?" (បង្ហាញអតិបរមា ១០០)":"");
  for(const [currency,total] of totals)msg+="\nសរុប "+escape(currency)+": "+total.toLocaleString("en-US",{maximumFractionDigits:2});
  for(const invoice of open.slice(0,5)){
   msg+="\n• "+escape(invoice.invoice_no)+" — "+escape(invoice.currency)+" "+Number(invoice.outstanding).toLocaleString("en-US",{maximumFractionDigits:2});
  }
  if(open.length>5)msg+="\n...និងវិក្កយបត្រជំពាក់ "+(open.length-5)+" ផ្សេងទៀត។";
 }
 msg+="\n\n<i>ផ្អែកតាមឈ្មោះដែលបានរក្សាទុក និងទិន្នន័យបំណុលបច្ចុប្បន្នប៉ុណ្ណោះ។ មិនមែនជាការផ្ទៀងផ្ទាត់អត្តសញ្ញាណអ្នកផ្ទេរដោយឯករាជ្យទេ។</i>";
 return reply(m,msg);
}
function addCmd(t:string){
 const content=t.replace(/^\/bankadd(?:@\w+)?\s*/i,"");
 const parts=content.split("|").map(x=>x.trim());
 if(parts.length===2&&parts.every(Boolean))return {customer:parts[0],holder:parts[1]};
 // Previous command format is also accepted, but bank and account details
 // are ignored so this feature never learns masked or bank-specific IDs.
 if(parts.length>=3&&parts[0]&&parts[2])return {customer:parts[0],holder:parts[2]};
 return null;
}
function bankAddReplyData(m:any){
 const replyText=val(m?.reply_to_message?.text||m?.reply_to_message?.caption);
 if(!replyText.includes("BB_BANKADD_PROMPT"))return null;
 const parts=val(m?.text||m?.caption).split("|").map(x=>x.trim());
 if(parts.length===2&&parts.every(Boolean))return {customer:parts[0],holder:parts[1]};
 return null;
}
async function setPendingBankAdd(m:any,promptMessageId?:number){
 const userId=val(m?.from?.id),chat=val(m?.chat?.id),thread=Number(m?.message_thread_id||0);
 if(!userId||!chat)return;
 const {error}=await db().from("bb_bank_assistant_pending_actions").upsert({
   telegram_chat_id:chat,
   telegram_thread_id:thread,
   telegram_user_id:userId,
   action:"bankadd",
   expires_at:new Date(Date.now()+5*60*1000).toISOString(),
   created_at:new Date().toISOString(),
   prompt_message_id:Number(promptMessageId||0)||null
 },{onConflict:"telegram_chat_id,telegram_thread_id,telegram_user_id,action"});
 if(error)throw error;
}
async function takePendingBankAdd(m:any){
 const userId=val(m?.from?.id),chat=val(m?.chat?.id),thread=Number(m?.message_thread_id||0);
 if(!userId||!chat)return null;
 const client=db();
 const {data,error}=await client.from("bb_bank_assistant_pending_actions")
   .select("expires_at,prompt_message_id")
   .eq("telegram_chat_id",chat)
   .eq("telegram_thread_id",thread)
   .eq("telegram_user_id",userId)
   .eq("action","bankadd")
   .maybeSingle();
 if(error)throw error;
 if(!data)return null;
 if(new Date(data.expires_at).getTime()<Date.now()){
   await client.from("bb_bank_assistant_pending_actions")
     .delete()
     .eq("telegram_chat_id",chat)
     .eq("telegram_thread_id",thread)
     .eq("telegram_user_id",userId)
     .eq("action","bankadd");
   return null;
 }
 const parts=val(m?.text||m?.caption).split("|").map(x=>x.trim());
 if(parts.length!==2||!parts.every(Boolean))return null;
 await clearReplyMarkup(chat,data.prompt_message_id);
 await client.from("bb_bank_assistant_pending_actions")
   .delete()
   .eq("telegram_chat_id",chat)
   .eq("telegram_thread_id",thread)
   .eq("telegram_user_id",userId)
   .eq("action","bankadd");
 return {customer:parts[0],holder:parts[1]};
}
async function handle(m:any,scope:RouteScope){
 const t=val(m.text||m.caption);
 if(/^\/reviewtransaction(?:@\w+)?$/i.test(t))return beginBankTransactionReview(m,scope);
 const bankAddReply=bankAddReplyData(m);
 const pendingBankAdd=bankAddReply?null:await takePendingBankAdd(m);
 if(/^\/(?:help|bankhelp)(?:@\w+)?$/i.test(t))return reply(m,
"🏦 <b>BIG BROTHER — Bank Payment Assistant</b>\n"+
"ខ្ញុំផ្គូផ្គង <b>ឈ្មោះអ្នកផ្ទេរ + ចំនួនទឹកប្រាក់</b> ទៅអតិថិជន និងវិក្កយបត្រជំពាក់។\n\n"+
"<b>ទម្រង់ដែលគាំទ្រ៖</b>\n"+
"• <code>$50 from Ly Sreyleak</code>\n"+
"• <code>50$ from Ly Sreyleak</code>\n"+
"• <code>Received USD 50 from Ly Sreyleak</code>\n"+
"• <code>Ly Sreyleak paid $50</code>\n"+
"• <code>Ly Sreyleak transfer 50 USD</code>\n"+
"• <code>50$ - Ly Sreyleak</code>\n"+
"• ABA PayWay / KHQR notification format\n\n"+
"<b>Transaction ID:</b> មិនចាំបាច់មានទេ។ បើមាន ខ្ញុំនឹងប្រើវាសម្រាប់ពិនិត្យ duplicate។\n\n"+
"<b>ស្វែងរកឈ្មោះអ្នកផ្ទេរ៖</b>\n"+
"• <code>Who is KEO LAKHENA?</code>\n"+
"• <code>តើ KEO LAKHENA ជានរណា?</code>\n\n"+
"<b>Request sender name mapping:</b>\n"+
"<code>/bankadd CUSTOMER_ID | SENDER NAME</code>\n"+
"ការរក្សាទុកត្រូវការ Admin អនុម័តជាមុន។\n\n"+
"Forward សារធនាគារច្រើនបាន។ ខ្ញុំនឹងឆ្លើយតាមលំដាប់ក្នុង Topic ដដែល។"
);
 if(/^\/myid(?:@\w+)?$/i.test(t))return reply(m,
  "🪪 <b>Your Telegram User ID</b>\n<code>"+escape(m.from?.id)+"</code>\n\nSend this ID to an Admin to enable approval rights."
 );
 const askedName=whoIsName(t);
 if(askedName){
   // Customer balances should only be returned to authorized Telegram administrators.
   if(scope.access_mode==="legacy"&&!await allowed(m.from?.id))return reply(m,"មានតែអ្នកគ្រប់គ្រងដែលបានផ្តល់សិទ្ធិប៉ុណ្ណោះដែលអាចសួរព័ត៌មានបំណុលអតិថិជនបាន។");
   return answerWhoIs(m,askedName,scope);
 }
 if(/^\/bankadd(?:@\w+)?\s*$/i.test(t)){
  const sent=await reply(m,
    "BB_BANKADD_PROMPT\n🏦 <b>Request sender mapping</b>\nSend your next message as:\n<code>CUSTOMER_ID | SENDER NAME</code>\n\nExample:\n<code>CUS-0255 | Him Techchong</code>\n\n⏱ Waiting for 5 minutes."
  );
  await setPendingBankAdd(m,Number(sent?.result?.message_id||0));
  return sent;
 }
 if(/^\/bankadd(?:@\w+)?\b/i.test(t)||bankAddReply||pendingBankAdd){
  const data=pendingBankAdd||bankAddReply||addCmd(t);
  if(!data)return reply(m,"ទម្រង់៖ <code>/bankadd CUSTOMER_ID | SENDER NAME</code>");
  const requestedCustomerId=val(data.customer)
    .normalize("NFKC")
    .replace(/[\u200b-\u200d\ufeff]/g,"")
    .replace(/[‐‑‒–—−]/g,"-")
    .replace(/\s+/g,"")
    .toUpperCase();
  const {data:c,error:customerError}=await db().from("customers")
    .select("customer_id,customer_name")
    .eq("customer_id",requestedCustomerId)
    .eq("active",true)
    .maybeSingle();
  if(customerError)throw customerError;
  if(!c)return reply(m,"រកមិនឃើញលេខសម្គាល់អតិថិជន។ សូមពិនិត្យក្នុង Customer Editor។");
  return reply(m,"🏦 <b>សំណើបន្ថែមឈ្មោះអ្នកផ្ទេរ</b>\nអតិថិជន៖ "+escape(c.customer_name)+"\nលេខសម្គាល់អតិថិជន៖ <code>"+escape(c.customer_id)+"</code>\nឈ្មោះម្ចាស់គណនី៖ <code>"+escape(data.holder)+"</code>\n\n⚠️ <b>មិនទាន់បានរក្សាទុកទេ។ ត្រូវការ Admin អនុម័ត។</b>\nឈ្មោះនេះនឹងត្រូវផ្គូផ្គងដោយមិនប្រកាន់ធនាគារ។",{reply_markup:{inline_keyboard:[[{text:"✅ Admin Approve & Save",callback_data:"bbbank:confirm"},{text:"❌ Reject",callback_data:"bbbank:cancel"}]]}});
 }
 // Only inspect forwarded messages or direct slips/text notifications posted inside our dedicated group.
 if(!t){
  if(m.forward_origin||m.forward_date){
   return reply(m,"❌ <b>REJECTED — មិនស្គាល់ទម្រង់សារធនាគារ</b>\nខ្ញុំមិនអាចអានឈ្មោះអ្នកផ្ទេរ ចំនួនទឹកប្រាក់ ឬលេខប្រតិបត្តិការពីសារនេះបានទេ។ សូមបញ្ជូនសារជូនដំណឹងធនាគារដែលមានអក្សរ (Text/Caption)។");
  }
  if(m.photo?.length)return reply(m,"❌ <b>REJECTED — រូបភាពមិនអាចអានដោយកំណែនេះ</b>\nសូមបញ្ជូនសារជូនដំណឹងពីធនាគារជាអក្សរ ឬបន្ថែម Caption។");
  return;
 }
 if(!m.forward_origin&&!m.forward_date&&!/(?:received|transfer|transaction|sender|payer|payment|amount|\$|៛)/i.test(t))return;
 const notice=parseNotice(t);
 if((m.forward_origin||m.forward_date)&&!notice.sender){
  return reply(m,"❌ <b>REJECTED — មិនស្គាល់ទម្រង់សារធនាគារ</b>"+noticeDetails(notice)+"\n\nខ្ញុំមិនអាចកំណត់ឈ្មោះអ្នកផ្ទេរពីសារនេះបានទេ។ សូមពិនិត្យទម្រង់សារ ឬបន្ថែម Parser សម្រាប់ធនាគារនេះ។");
 }
 return report(m,notice,scope);
}
async function callback(cb:any){
 const m=cb.message,choice=val(cb.data),id=cb.id;
 if(!m||!await allowed(cb.from?.id)){await tg("answerCallbackQuery",{callback_query_id:id,text:"មានតែអ្នកគ្រប់គ្រងដែលបានអនុញ្ញាតប៉ុណ្ណោះដែលអាចរក្សាទុកឈ្មោះអ្នកផ្ទេរ។",show_alert:true});return;}
 if(choice==="bbbank:cancel"){await tg("answerCallbackQuery",{callback_query_id:id,text:"បានបោះបង់។"});return;}
 if(choice!=="bbbank:confirm")return;
 const t=val(m.text);
 const field=(name:string)=>{const rx=new RegExp("^"+name+":\\s*(.+)$","mi");return val(t.match(rx)?.[1]);};
 const customer=field("លេខសម្គាល់អតិថិជន"),holder=field("ឈ្មោះម្ចាស់គណនី");
 if(!customer||!holder||holder.length>140){await tg("answerCallbackQuery",{callback_query_id:id,text:"មិនអាចផ្ទៀងផ្ទាត់ការបញ្ជាក់បានទេ។",show_alert:true});return;}
 const client=db();
 const {data:existing}=await client.from("bb_customer_bank_identities").select("identity_id").eq("customer_id",customer).ilike("account_holder_name",holder).eq("active",true).limit(1);
 if(existing?.length){await tg("answerCallbackQuery",{callback_query_id:id,text:"ឈ្មោះអ្នកផ្ទេរនេះមានរួចហើយ។"});return;}
 const {error}=await client.from("bb_customer_bank_identities").insert({customer_id:customer,bank_name:"ANY",account_holder_name:holder,account_number:null});
 if(error){await tg("answerCallbackQuery",{callback_query_id:id,text:"មិនអាចរក្សាទុកឈ្មោះអ្នកផ្ទេរបានទេ។",show_alert:true});return;}
 await tg("answerCallbackQuery",{callback_query_id:id,text:"បានរក្សាទុកឈ្មោះអ្នកផ្ទេរហើយ។"});
 await tg("editMessageReplyMarkup",{chat_id:m.chat.id,message_id:m.message_id,reply_markup:{inline_keyboard:[]}});
 await reply(m,"✅ បានរក្សាទុកឈ្មោះអ្នកផ្ទេរហើយ។ សារជូនដំណឹងបន្ទាប់អាចផ្គូផ្គងនឹងអតិថិជននេះបាន។");
}

// Private Telegram ID lookup and photo-organizer routing diagnostics.
// All photo organizer actions here are administrative checks only; invoice intake is NOT active.
async function replyToPrivateIdentity(m:any):Promise<boolean>{
 if(val(m?.chat?.type)!=="private"||m.from?.is_bot===true)return false;
 const id=val(m.from?.id),chat=val(m.chat?.id);
 if(!/^[0-9]{5,20}$/.test(id)||id!==chat)return false;
 const t=val(m.text);
 const start=/^\/start(?:@\w+)?(?:\s+\S{1,64})?$/i.test(t);
 const myid=/^\/myid(?:@\w+)?$/i.test(t)||/^(?:id|my id)$/i.test(t);
 const status=/^(?:\/(?:photo|photostatus)(?:@\w+)?|photo|photo status|organizer)$/i.test(t);
 const test=/^(?:\/phototest(?:@\w+)?|photo test)$/i.test(t);
 const help=/^\/help(?:@\w+)?$/i.test(t);
 const review=/^\/review(?:@\w+)?$/i.test(t);
 if(!start&&!myid&&!status&&!test&&!help&&!review)return false;
 if(help){
   await reply(m,
     "🤖 <b>BIG BROTHER — Private Bot Commands</b>\n\n"+
     "👋 <code>/start</code> — Welcome and show my User ID\n"+
     "🪪 <code>/myid</code> — Show my Telegram User ID\n"+
     "📸 <code>/photo</code> — Check private reviewer and output mappings\n"+
     "🧪 <code>/phototest</code> — Send harmless tests to mapped destinations\n"+
     "📋 <code>/review</code> — Open photo review with two input boxes\n"+
     "✅ <code>/done</code> — Finish collecting forwarded photos\n"+
     "🗑 <code>/cancel</code> — Discard an unfinished batch\n"+
     "❓ <code>/help</code> — Show this list\n\n"+
     "Note: Private invoice intake works only when enabled in Telegram Manager. Original pictures are preserved; automatic crop and straighten are not connected yet."
   );
   return true;
 }
 if(start||myid){
   const message=(start?"👋 <b>Welcome to BIG BROTHER Bot!</b>\n\n":"")
     +"🪪 <b>Your Telegram User ID</b>\n<code>"+escape(id)+"</code>\n\n"
     +"Tap <code>/</code> beside the message box for available commands, or send <code>/help</code>.\n"
     +"Use <code>/photo</code> to check mapping and <code>/phototest</code> to test delivery.\n\n"
     +"📸 When enabled, forward chosen invoice pictures here, then use /done or wait for the automatic review task. The bot uses original, unaltered pictures for delivery.";
   await reply(m,message);
   return true;
 }
 // Never reveal routing details or trigger delivery tests for unapproved Telegram accounts.
 if(!await allowed(id)){
   await reply(m,"🔒 Private Invoice Photo Organizer settings are available only to an authorized BIG BROTHER Telegram administrator.");
   return true;
 }
 if(review){
   await reply(m,
     "📸 <b>BIG BROTHER — Invoice Review</b>\n\n"+
     "Tap below to open the one-photo review screen with <b>Invoice Date</b> and <b>Invoice Number</b> boxes, plus <b>Save &amp; Next</b>.\n\n"+
     "If you have already forwarded your chosen photos, tap below to review them. If no batch is pending, the Mini App offers a harmless layout preview.",
     {reply_markup:{inline_keyboard:[[{text:"📸 Open Invoice Review",web_app:{url:"https://angsokhey11-cloud.github.io/big-brother-notification-center/invoice-photo-review.html?v=sticky-range-20261009"}}]]}}
   );
   return true;
 }
 const client=db();
 const {data:route,error:routeError}=await client.from("bb_invoice_photo_routes")
   .select("route_id,route_label,active,source_chat_id,source_thread_id,reviewer_telegram_user_id,review_mode,intake_mode")
   .eq("source_chat_id",id).eq("reviewer_telegram_user_id",id).eq("intake_mode","private_forward_only")
   .limit(1).maybeSingle();
 if(routeError)throw routeError;
 if(!route){
   await reply(m,"📸 <b>Invoice Photo Organizer</b>\nYour Telegram account is authorized, but you have no matching private review route yet.\nConfigure your private reviewer account in Telegram Manager → Invoice Photo Organizer.");
   return true;
 }
 const {data:outputs,error:destError}=await client.from("bb_invoice_photo_destinations")
   .select("destination_label,telegram_chat_id,telegram_thread_id,active")
   .eq("route_id",route.route_id).order("destination_id");
 if(destError)throw destError;
 const activeOutputs=(outputs||[]).filter((x:any)=>x.active===true);
 const privateOutput=activeOutputs.some((x:any)=>val(x.telegram_chat_id)===id&&Number(x.telegram_thread_id||0)===0);
 const groupOutputs=activeOutputs.filter((x:any)=>val(x.telegram_chat_id).startsWith("-"));
 const authorized=route.reviewer_telegram_user_id===id&&route.source_chat_id===id&&route.review_mode==="manual_all"&&route.intake_mode==="private_forward_only"&&Number(route.source_thread_id)===0;
 if(test){
   if(!authorized||!groupOutputs.length||!privateOutput){
     await reply(m,"⚠️ The private review mapping or required destinations are incomplete. Send <code>PHOTO</code> to see the setup.");
     return true;
   }
   const results:string[]=[];
   for(const target of activeOutputs){
     const dest:Record<string,unknown>={
       chat_id:target.telegram_chat_id,
       text:"✅ BIG BROTHER — Invoice Photo Organizer\nTest delivery from your mapped private reviewer.\nDestination: "+val(target.destination_label)+"\nThis is a routing test only. No invoice images or accounting records were shared."
     };
     if(Number(target.telegram_thread_id)>0)dest.message_thread_id=Number(target.telegram_thread_id);
     try{
       const res=await tg("sendMessage",dest);
       if(res?.ok!==true)throw Error("Telegram destination rejected test");
       results.push("✅ "+escape(val(target.destination_label)));
     }catch(err){
       results.push("❌ "+escape(val(target.destination_label))+" — unable to deliver");
     }
   }
   await reply(m,"📸 <b>Photo Organizer — Delivery Test</b>\n"+results.join("\n")+"\n\nThis was a harmless routing test. Private photo review and original-image album delivery work only when intake is enabled in Telegram Manager.");
   return true;
 }
 const lines=[
   "📸 <b>BIG BROTHER — Invoice Photo Organizer</b>",
   "👤 Private reviewer linked: "+(authorized?"✅ Yes":"❌ Invalid"),
   "🔐 Reviewer ID: <code>"+escape(id)+"</code>",
   "📥 Input: Private forwarded photos only",
   "📝 Every invoice requires manual number + date approval",
   "📤 Group/topic destinations: "+groupOutputs.length,
   "📩 Your private output: "+(privateOutput?"✅ Mapped":"❌ Not mapped"),
   "⚙️ Private intake: "+(route.active?"✅ Enabled (original-image delivery)":"⏸ Paused"),
   "",
   "<b>Output mappings</b>"
 ];
 for(const output of activeOutputs.slice(0,15)){
   lines.push("• "+escape(val(output.destination_label))+(Number(output.telegram_thread_id)>0?" (topic)":""));
 }
 if(!activeOutputs.length)lines.push("No enabled destinations");
 lines.push("","Use <code>/phototest</code> to test delivery of a harmless message to mapped destinations.",
   "🧾 When enabled, forward selected invoice photos privately. Use /done or wait for an automatic review task. After checking each photo, approve delivery. The current mode sends the original images without automatic crop/deskew.");
 await reply(m,lines.join("\n"));
 return true;
}
// The photo organizer listens ONLY to forwarded photos in the explicitly mapped private chat.
// Groups remain outgoing destinations, never scanned or queued.
async function invoicePhotoPrivate(m:any):Promise<boolean>{
 if(val(m?.chat?.type)!=="private"||m.from?.is_bot===true||val(m.chat?.id)!==val(m.from?.id))return false;
 const user=val(m.from?.id),txt=val(m.text);
 const cmdDone=/^\/done(?:@\w+)?$/i.test(txt);
 const cmdCancel=/^\/cancel(?:@\w+)?$/i.test(txt);
 const forwardedPicture=Array.isArray(m.photo)&&m.photo.length>0&&!!(m.forward_origin||m.forward_date);
 if(!cmdDone&&!cmdCancel&&!forwardedPicture)return false;
 if(!await allowed(user))return false;
 const client=db();
 const {data:route,error}=await client.from("bb_invoice_photo_routes").select("route_id,route_label").eq("source_chat_id",user)
   .eq("reviewer_telegram_user_id",user).eq("source_thread_id",0).eq("active",true)
   .eq("intake_mode","private_forward_only").eq("review_mode","manual_all").maybeSingle();
 if(error)throw error;
 if(!route){
   await reply(m,"📸 Invoice Photo Organizer intake is not enabled yet. Check your private reviewer mapping in Telegram Manager.");
   return true;
 }
 if(forwardedPicture){
   const photo=m.photo[m.photo.length-1];
   const {data,error:err}=await client.rpc("bb_invoice_photo_receive",{
      p_reviewer:user,p_message_id:Number(m.message_id),p_file_id:val(photo.file_id),p_file_unique_id:val(photo.file_unique_id)||null
   });
   if(err)throw err;
   if(data?.first&&!data?.duplicate)await reply(m,"📥 <b>Invoice pictures received privately.</b>\nForward the rest of your chosen invoice pictures here.\nTap <code>/done</code> when finished, or wait for the automatic review task.\nNo photos have been sent to any group.");
   return true;
 }
 if(cmdCancel){
   const {data:rows,error:e}=await client.from("bb_invoice_photo_review_batches").select("batch_id,status")
    .eq("reviewer_telegram_user_id",user).eq("route_id",route.route_id).in("status",["collecting","awaiting_review"]).limit(10);
   if(e)throw e;
   for(const row of rows||[]){
    const {error:d}=await client.from("bb_invoice_photo_review_batches").delete().eq("batch_id",row.batch_id)
       .in("status",["collecting","awaiting_review"]);
    if(d)throw d;
   }
   await reply(m,"🗑 Temporary invoice photo review "+(rows?.length?"batch discarded.":"queue is already empty.")+"\nNo pictures were posted to your group.");
   return true;
 }
 if(cmdDone){
   const {data,error:e}=await client.rpc("bb_invoice_photo_close",{p_reviewer:user});
   if(e)throw e;
   if(!data?.ok){
     await reply(m,"📸 "+escape(val(data?.reason)||"No forwarded invoice photos to review."));
     return true;
   }
   const {error:markError}=await client.from("bb_invoice_photo_review_batches").update({review_notice_sent_at:new Date().toISOString()}).eq("batch_id",data.batch_id);
   if(markError)throw markError;
   await reply(m,"✅ <b>"+Number(data.count)+" invoice pictures ready for review</b>\nTap below, check both boxes for every invoice, then approve sending to your mapped destinations.",
     {reply_markup:{inline_keyboard:[[{text:"📋 Open Invoice Review",web_app:{url:"https://angsokhey11-cloud.github.io/big-brother-notification-center/invoice-photo-review.html?v=sticky-range-20261009"}}]]}});
   return true;
 }
 return false;
}

function queueableNotice(m:any){
 const t=val(m?.text||m?.caption);
 if(/^\/reviewtransaction(?:@\w+)?$/i.test(t))return true;
 if(/^\/bank(?:help|add)\b/i.test(t)||whoIsName(t))return false;
 // Every forwarded item is queued so it receives one ordered result,
 // including unsupported bank formats that must be explicitly rejected.
 if(m?.forward_origin||m?.forward_date)return true;
 if(!t)return false;
 return /(?:received|transfer|transaction|sender|payer|payment|amount|\$|៛|paid\s+by|Trx\.?\s*ID)/i.test(t);
}
async function enqueueNotice(updateId:number,m:any){
 const client=db();
 const {error}=await client.from("bb_bank_assistant_queue").upsert({
   telegram_update_id:updateId,
   telegram_chat_id:val(m.chat?.id),
   telegram_thread_id:Number(m.message_thread_id||0),
   telegram_message_id:Number(m.message_id||0),
   payload:m
 },{onConflict:"telegram_update_id",ignoreDuplicates:true});
 if(error)throw error;
}
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function drainTopicQueue(chat:string,thread:number){
 const owner=crypto.randomUUID(),client=db();
 let acquired=false;
 for(let waitAttempt=0;waitAttempt<90;waitAttempt++){
  const {data:locked,error:lockError}=await client.rpc("bb_bank_assistant_try_lock",{p_chat:chat,p_thread:thread,p_owner:owner,p_seconds:45});
  if(lockError)throw lockError;
  if(locked===true){acquired=true;break;}
  await sleep(1000);
 }
 if(!acquired)return;
 try{
  for(let processed=0;processed<40;processed++){
   const {data:row,error}=await client.from("bb_bank_assistant_queue")
     .select("queue_id,payload,attempts").eq("telegram_chat_id",chat).eq("telegram_thread_id",thread)
     .order("queue_id",{ascending:true}).limit(1).maybeSingle();
   if(error)throw error;
   if(!row)break;
   const m=row.payload;
   try{
    const scope=await bankScope(m);
    if(scope&&await scopeAllows(m,scope))await handle(m,scope);
    await client.from("bb_bank_assistant_queue").delete().eq("queue_id",row.queue_id);
   }catch(error){
    const attempts=Number(row.attempts||0)+1;
    const message=error instanceof Error?error.message:"Unknown processing error";
    console.error("Queued Telegram handling failed",message);
    if(attempts>=3){
      try{await reply(m,"⚠️ មិនអាចដំណើរការសារនេះបាននៅពេលនេះទេ។ សូមសាកល្បងបញ្ជូនម្តងទៀត។");}catch(_){}
      await client.from("bb_bank_assistant_queue").delete().eq("queue_id",row.queue_id);
    }else{
      await client.from("bb_bank_assistant_queue").update({attempts,last_error:message.slice(0,500)}).eq("queue_id",row.queue_id);
      await sleep(700);
      continue;
    }
   }
   await client.rpc("bb_bank_assistant_try_lock",{p_chat:chat,p_thread:thread,p_owner:owner,p_seconds:45});
   const {count}=await client.from("bb_bank_assistant_queue").select("queue_id",{count:"exact",head:true})
     .eq("telegram_chat_id",chat).eq("telegram_thread_id",thread);
   const backlog=count||0;
   if(backlog===1)await sleep(250);
   else if(backlog<=4&&backlog>1)await sleep(900);
   else if(backlog>4)await sleep(2600);
  }
 }finally{
  await client.rpc("bb_bank_assistant_unlock",{p_chat:chat,p_thread:thread,p_owner:owner}).catch(()=>{});
 }
}
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return new Response("Method not allowed",{status:405});
 if(!token())return new Response("Bot not configured",{status:503});
 const {data:cfg,error}=await db().from("bb_telegram_inbound_config").select("secret").eq("config_key","telegram_main").maybeSingle();
 if(error||!cfg?.secret)return new Response("Webhook not configured",{status:503});
 if(val(req.headers.get("X-Telegram-Bot-Api-Secret-Token"))!==cfg.secret)return new Response("Unauthorized",{status:401});
 try{
  try{await ensureTelegramCommands();}catch(e){console.warn("Telegram command menu setup failed",e instanceof Error?e.message:"error");}
  const u=await req.json(),m=u.message;
  if(m){
    // Route discovery works before any Bank Assistant group/topic mapping exists.
    if(await replyGroupAndTopicIds(m))return Response.json({ok:true});
    // Reply privately and stop; mapped group Bank Assistant handling remains untouched.
    if(await replyToPrivateIdentity(m))return Response.json({ok:true});
    if(m.chat?.type==="private"&&val(m.chat.id)===val(m.from?.id)&&
     /^\/reviewtransaction(?:@\w+)?$/i.test(val(m.text))){
      await beginBankTransactionReview(m,null);
      return Response.json({ok:true});
    }
    if(await invoicePhotoPrivate(m))return Response.json({ok:true});
    const scope=await bankScope(m);
    if(scope){
      if(await scopeAllows(m,scope)){
        if(queueableNotice(m)){
          await enqueueNotice(Number(u.update_id||0),m);
          const task=drainTopicQueue(val(m.chat.id),Number(m.message_thread_id||0));
          try{(globalThis as any).EdgeRuntime?.waitUntil?.(task);}catch(_){}
          if(!(globalThis as any).EdgeRuntime?.waitUntil)await task;
        }else{
          await handle(m,scope);
        }
      }else if(val(m.text).startsWith("/bankhelp")||val(m.text).startsWith("/bankadd")){
        await reply(m,"⛔ អ្នកមិនទាន់មានសិទ្ធិប្រើ Assistant ក្នុងក្រុមនេះទេ។ សូមទាក់ទង Admin។");
      }
    }
  }
  if(u.callback_query){
    const scope=await bankScope(u.callback_query.message);
    if(scope&&await scopeAllows({from:u.callback_query.from},scope)){
      if(!await newInvoiceRegisterClick(u.callback_query,scope))await callback(u.callback_query);
    }
  }
  return Response.json({ok:true});
 }catch(e){console.error("Incoming Telegram handling failed", e instanceof Error?e.name:"error");return Response.json({ok:false},{status:500});}
});