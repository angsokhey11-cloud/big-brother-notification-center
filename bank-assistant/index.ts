// BIG BROTHER: inbound Telegram dispatcher. Topic routing and webhook authentication are configured in Supabase.
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
const allowed=async(id:unknown)=>{if(!val(id))return false;const {data,error}=await db().from("bb_telegram_assistant_admins").select("telegram_user_id").eq("telegram_user_id",val(id)).maybeSingle();return !error&&!!data;};
type RouteScope={location_code:string|null,access_mode:"legacy"|"staff_location"|"admin_only"};
async function bankScope(m:any):Promise<RouteScope|null>{
 if(!m?.chat?.id)return null;
 const chat=val(m.chat.id),thread=Number(m.message_thread_id||0);
 const client=db();
 const {data:legacy,error:legacyError}=await client.from("bb_telegram_assistant_routes").select("telegram_chat_id,telegram_thread_id").eq("assistant_key","bank_assistant").eq("active",true).maybeSingle();
 if(legacyError)throw legacyError;
 if(legacy&&chat===val(legacy.telegram_chat_id)&&thread===Number(legacy.telegram_thread_id))return {location_code:null,access_mode:"legacy"};
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
async function reply(m:any,html:string,extra:Record<string,unknown>={}){
 const destination:Record<string,unknown>={chat_id:m.chat.id,reply_to_message_id:m.message_id,text:html.slice(0,3900),parse_mode:"HTML",disable_web_page_preview:true,...extra};
 if(Number(m.message_thread_id)>0)destination.message_thread_id=m.message_thread_id;
 return tg("sendMessage",destination);
}
function parseNotice(raw:string){
 const t=raw.slice(0,4500);
 const grab=(patterns:RegExp[])=>{for(const p of patterns){const x=t.match(p);if(x?.[1])return x[1].trim();}return "";};
 // ABA PayWay: sender name is useful; masked account suffix is deliberately discarded.
 // "via ABA KHQR" is a payment channel, NOT a verified sender bank.
 const payway=t.match(/(?:៛|KHR\b|\bUSD\b|US\$|\$)\s*([\d,]+(?:\.\d{1,4})?)\s+paid\s+by\s+(.+?)\s*\(\s*[*xX•]*\s*\d{2,8}\s*\)\s+on\b/i);
 const sender=payway?.[2]?.trim()||grab([/(?:sender|from|payer|account holder|received from|ឈ្មោះអ្នកផ្ញើ)\s*[:：\-]\s*([^\n\r]+)/i,/(?:sent by|transfer from)\s+([^\n\r]+)/i]);
 const currency=payway?( /^\s*(?:៛|KHR\b)/i.test(t)?"KHR":"USD" ):/(?:៛|\bKHR\b|\briel\b)/i.test(t)?"KHR":/(?:\bUSD\b|US\$|\$|\bdollar\b)/i.test(t)?"USD":"";
 const rawAmount=payway?.[1]||grab([/(?:amount|received|payment|transfer amount|ចំនួនទឹកប្រាក់)\s*[:：\-]?\s*(?:USD|KHR|US\$|\$|៛)?\s*([\d,]+(?:\.\d{1,4})?)/i,/(?:USD|US\$|\$|KHR|៛)\s*([\d,]+(?:\.\d{1,4})?)/i]);
 const tx=grab([/\bTrx\.?\s*ID\s*[:：#\-]?\s*([A-Z0-9\-]{5,80})/i,/(?:transaction\s*(?:id|number|no\.?|ref(?:erence)?)|reference\s*(?:id|no\.?|number))\s*[:：#\-]?\s*([A-Z0-9\-]{5,80})/i]);
 return {sender,currency,amount:rawAmount?amount(rawAmount):null,transactionId:tx,channel:payway?grab([/\bvia\s+(ABA KHQR)\b/i]):""};
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
async function report(m:any,notice:ReturnType<typeof parseNotice>,scope:RouteScope){
 const client=db();
 if(!notice.sender)return reply(m,"🔎 <b>មិនអាចកំណត់អតិថិជនបាន</b>"+noticeDetails(notice)+"\nមិនមានឈ្មោះអ្នកផ្ទេរដែលអាចសម្គាល់បាន។");
 const {data:bankRows,error:bankError}=await client.from("bb_customer_bank_identities").select("identity_id,customer_id,bank_name,account_holder_name,account_number,alternative_names,active").eq("active",true).limit(2000);
 if(bankError)throw bankError;
 const nSender=norm(notice.sender);
 const candidates=new Set<string>();
 for(const b of (bankRows||[]) as Bank[]){
  // Match the actual sender NAME across all banks and accounts.
  // If multiple customers share this name, keep all candidates for review.
  if([b.account_holder_name,...(b.alternative_names||[])].some(name=>norm(name)===nSender))candidates.add(b.customer_id);
 }
 if(!candidates.size)return reply(m,"🔎 <b>អានប្រតិបត្តិការបានហើយ ប៉ុន្តែមិនទាន់ស្គាល់អតិថិជន</b>"+noticeDetails(notice)+"\n\nមិនទាន់មានឈ្មោះអ្នកផ្ទេរនេះក្នុងបញ្ជីអតិថិជនទេ។ សូមពិនិត្យឈ្មោះ រួចបន្ថែមដោយប្រើ៖\n<code>/bankadd CUSTOMER_ID | SENDER NAME</code>.");
 const ids=[...candidates].slice(0,8);
 let peopleQuery=client.from("customers").select("customer_id,customer_name").in("customer_id",ids);
 if(scope.location_code)peopleQuery=peopleQuery.eq("location_code",scope.location_code);
 const {data:people,error:peopleErr}=await peopleQuery;
 if(peopleErr)throw peopleErr;
 if(!people?.length)return reply(m,"🔎 មិនមានអតិថិជនត្រូវនឹងឈ្មោះនេះនៅក្នុងទីតាំងដែលបានអនុញ្ញាតទេ។");
 let head=people.length>1?"⚠️ <b>ឈ្មោះអ្នកផ្ទេរនេះត្រូវនឹងអតិថិជនច្រើននាក់</b>":"✅ <b>រកឃើញអតិថិជនដែលអាចត្រូវនឹងឈ្មោះនេះ</b>";
 head+=noticeDetails(notice);
 if(notice.transactionId){
  const [pay,reg,dep]=await Promise.all([
    client.from("payments").select("payment_id").ilike("transaction_id",notice.transactionId).limit(1),
    client.from("bb_verified_bank_transactions").select("status").ilike("transaction_id",notice.transactionId).limit(1),
    client.from("company_deposits").select("deposit_id").ilike("collection_transaction_id",notice.transactionId).limit(1)
  ]);
  if(pay.data?.length||reg.data?.length||dep.data?.length)head+="\n⚠️ <b>លេខប្រតិបត្តិការនេះមានក្នុងប្រវត្តិទូទាត់ ឬបញ្ជីធនាគាររួចហើយ។ សូមពិនិត្យមុនបន្ត។</b>";
 }
 for(const c of (people||[]) as Customer[]){
  head+="\n\n👤 <b>"+escape(c.customer_name)+"</b> ("+escape(c.customer_id)+")\nផ្គូផ្គងតាមឈ្មោះអ្នកផ្ទេរ";
  const {data:open,error:openError}=await client.from("invoices").select("invoice_id,invoice_no,currency,outstanding").eq("customer_id",c.customer_id).gt("outstanding",0).order("invoice_date",{ascending:true}).limit(35);
  if(openError){head+="\nមិនអាចទាញយកទិន្នន័យបំណុលបាននៅពេលនេះ។";continue;}
  const rows=(open||[]) as Invoice[];
  if(!rows.length){head+="\nមិនមានវិក្កយបត្រជំពាក់។ អាចជាការទូទាត់វិក្កយបត្រថ្មី ឬប្រតិបត្តិការផ្សេង។";continue;}
  head+="\nវិក្កយបត្រមិនទាន់ទូទាត់៖ "+rows.length;
  if(notice.currency&&notice.amount!==null&&notice.amount>0){
   const matches=combos(rows,notice.amount,notice.currency);
   if(matches.length){head+="\n<b>វិក្កយបត្រជំពាក់ដែលអាចត្រូវនឹងចំនួនទឹកប្រាក់៖</b>";
    for(const group of matches){head+="\n• "+group.map(x=>escape(x.invoice_no)+" ("+escape(x.currency)+" "+escape(x.outstanding)+")").join(" + ");}
   }else head+="\nរកមិនឃើញវិក្កយបត្រជំពាក់ដែលមានរូបិយប័ណ្ណ និងចំនួនទឹកប្រាក់ត្រូវគ្នាទាំងស្រុងទេ។ អាចជាការបង់មួយផ្នែក ការបង់ឆ្លងរូបិយប័ណ្ណ វិក្កយបត្រថ្មី ឬប្រតិបត្តិការផ្សេង។";
  }else head+="\nមិនទាន់មានចំនួនទឹកប្រាក់ ឬរូបិយប័ណ្ណច្បាស់លាស់ ដូច្នេះមិនទាន់ផ្គូផ្គងវិក្កយបត្រទេ។";
 }
 head+="\n\n<i>នេះគ្រាន់តែជាការសម្គាល់ និងការណែនាំប៉ុណ្ណោះ។ គ្មានការកែប្រែការទូទាត់ ឬវិក្កយបត្រឡើយ។</i>";
 return reply(m,head);
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
async function handle(m:any,scope:RouteScope){
 const t=val(m.text||m.caption);
 if(/^\/bankhelp(?:@\w+)?$/i.test(t))return reply(m,"🏦 <b>BIG BROTHER Bank Assistant</b>\nសូមបញ្ជូនសារជូនដំណឹងពីធនាគារមកទីនេះ ឬសួរ៖\n• Who is KEO LAKHENA?\n• តើ KEO LAKHENA ជានរណា?\n• តើ KEO LAKHENA ជាអតិថិជនណា?\nដើម្បីបន្ថែមឈ្មោះអ្នកផ្ទេរ សូមប្រើ៖\n<code>/bankadd CUSTOMER_ID | SENDER NAME</code>\nត្រូវមានការបញ្ជាក់ពីអ្នកគ្រប់គ្រង។ មិនរក្សាទុកប្រវត្តិសន្ទនាទេ។");
 const askedName=whoIsName(t);
 if(askedName){
   // Customer balances should only be returned to authorized Telegram administrators.
   if(scope.access_mode==="legacy"&&!await allowed(m.from?.id))return reply(m,"មានតែអ្នកគ្រប់គ្រងដែលបានផ្តល់សិទ្ធិប៉ុណ្ណោះដែលអាចសួរព័ត៌មានបំណុលអតិថិជនបាន។");
   return answerWhoIs(m,askedName,scope);
 }
 if(/^\/bankadd(?:@\w+)?\b/i.test(t)){
  if(!await allowed(m.from?.id))return reply(m,"មានតែអ្នកគ្រប់គ្រងដែលបានផ្តល់សិទ្ធិប៉ុណ្ណោះដែលអាចបន្ថែមឈ្មោះអ្នកផ្ទេរបាន។");
  const data=addCmd(t);
  if(!data)return reply(m,"ទម្រង់៖ <code>/bankadd CUSTOMER_ID | SENDER NAME</code>");
  const {data:c}=await db().from("customers").select("customer_id,customer_name").eq("customer_id",data.customer).eq("active",true).maybeSingle();
  if(!c)return reply(m,"រកមិនឃើញលេខសម្គាល់អតិថិជន។ សូមពិនិត្យក្នុង Customer Editor។");
  // No pending conversation stored: confirmation details live only in this bot message.
  return reply(m,"🏦 <b>បញ្ជាក់ការបន្ថែមឈ្មោះអ្នកផ្ទេរ</b>\nអតិថិជន៖ "+escape(c.customer_name)+"\nលេខសម្គាល់អតិថិជន៖ <code>"+escape(data.customer)+"</code>\nឈ្មោះម្ចាស់គណនី៖ <code>"+escape(data.holder)+"</code>\nឈ្មោះនេះនឹងត្រូវផ្គូផ្គងដោយមិនប្រកាន់ធនាគារ។ សូមផ្ទៀងផ្ទាត់មុនរក្សាទុក។",{reply_markup:{inline_keyboard:[[{text:"✅ បញ្ជាក់ និងរក្សាទុក",callback_data:"bbbank:confirm"},{text:"បោះបង់",callback_data:"bbbank:cancel"}]]}});
 }
 // Only inspect forwarded messages or direct slips/text notifications posted inside our dedicated group.
 if(m.photo?.length&&!t)return reply(m,"ខ្ញុំបានទទួលរូបភាពហើយ ប៉ុន្តែកំណែនេះត្រូវការឈ្មោះអ្នកផ្ទេរជាអក្សរ។ សូមបញ្ជូនសារជូនដំណឹងពីធនាគារ ឬបន្ថែមឈ្មោះអ្នកផ្ទេរក្នុង Caption។ ខ្ញុំមិនអាចសន្មតពីរូបភាពមិនច្បាស់បានទេ។");
 if(!t)return;
 if(!m.forward_origin&&!m.forward_date&&!/(?:received|transfer|transaction|sender|payer|payment|amount|\$|៛)/i.test(t))return;
 return report(m,parseNotice(t),scope);
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
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return new Response("Method not allowed",{status:405});
 if(!token())return new Response("Bot not configured",{status:503});
 const {data:cfg,error}=await db().from("bb_telegram_inbound_config").select("secret").eq("config_key","telegram_main").maybeSingle();
 if(error||!cfg?.secret)return new Response("Webhook not configured",{status:503});
 if(val(req.headers.get("X-Telegram-Bot-Api-Secret-Token"))!==cfg.secret)return new Response("Unauthorized",{status:401});
 try{
  const u=await req.json(),m=u.message;
  if(m){const scope=await bankScope(m);if(scope){if(await scopeAllows(m,scope))await handle(m,scope);else if(val(m.text).startsWith("/bankhelp")||val(m.text).startsWith("/bankadd"))await reply(m,"⛔ អ្នកមិនទាន់មានសិទ្ធិប្រើ Assistant ក្នុងក្រុមនេះទេ។ សូមទាក់ទង Admin។");}}
  if(u.callback_query){const scope=await bankScope(u.callback_query.message);if(scope&&await scopeAllows({from:u.callback_query.from},scope))await callback(u.callback_query);}
  return Response.json({ok:true});
 }catch(e){console.error("Incoming Telegram handling failed", e instanceof Error?e.name:"error");return Response.json({ok:false},{status:500});}
});