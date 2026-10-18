// BIG BROTHER Staff Assistant V3 - private verified staff only.
// No Telegram messages, chat transcripts, search strings, screenshots, or photo copies are persisted.
// Only admin-approved staff mapping + language, and 30-minute expiring navigation IDs.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const env=(x:string)=>Deno.env.get(x)||"";
const db=()=>createClient(env("SUPABASE_URL"),env("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false}});
const val=(x:unknown)=>String(x??"").trim();
const num=(x:unknown)=>Number(x||0);
const esc=(x:unknown)=>val(x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));
const norm=(x:unknown)=>val(x).normalize("NFKC").toLocaleLowerCase("en").replace(/[\u200b-\u200d\ufeff]/g,"").replace(/\s+/g," ").trim();
const fmtDate=(v:unknown)=>{const x=val(v).slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(x))return val(v);const a=x.split("-");return a[2]+"-"+["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(a[1])-1]+"-"+a[0];};
const money=(v:unknown,c:unknown)=>val(c).toUpperCase()==="KHR"?"៛"+num(v).toLocaleString("en-US",{maximumFractionDigits:0}):"$"+num(v).toFixed(2);
const lang=(a:any)=>a?.language==="en"?"en":"km";
const phrase=(a:any,km:string,en:string)=>lang(a)==="km"?km:en;
const kb=(rows:any[][])=>({inline_keyboard:rows.map(row=>row.map(x=>({text:x[0],callback_data:x[1]})))});
async function tg(method:string,payload:any){
 const res=await fetch("https://api.telegram.org/bot"+env("TELEGRAM_BOT_TOKEN")+"/"+method,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
 const data=await res.json().catch(()=>({ok:false,description:"Telegram API error"}));
 if(!res.ok||data.ok!==true)throw Error("Telegram "+method+" failed: "+val(data.description).slice(0,120));
 return data.result;
}
async function validAccount(id:string){
 const {data:a,error}=await db().from("bb_staff_assistant_accounts").select("telegram_user_id,staff_id,language,language_confirmed").eq("telegram_user_id",id).eq("active",true).maybeSingle();
 if(error||!a)return null;
 const {data:s}=await db().from("staff").select("staff_name,status").eq("staff_id",a.staff_id).maybeSingle();
 if(!s||norm(s.status)!=="active")return null;
 return {...a,staff_name:s.staff_name};
}
async function session(id:string){
 const {data}=await db().from("bb_staff_assistant_sessions").select("*").eq("telegram_user_id",id).gt("expires_at",new Date().toISOString()).maybeSingle();
 return data||null;
}
async function save(id:string,patch:any){
 const old=await session(id);
 const payload={telegram_user_id:id,mode:"menu",customer_id:null,invoice_id:null,page:0,selected_earning_ids:[],menu_message_id:null,...(old||{}),...patch,updated_at:new Date().toISOString(),expires_at:new Date(Date.now()+30*60*1000).toISOString()};
 const {error}=await db().from("bb_staff_assistant_sessions").upsert(payload,{onConflict:"telegram_user_id"});
 if(error)throw error;
 return payload;
}
async function show(chat:string,s:any,html:string,keyboard:any,editId?:number){
 const data={chat_id:chat,text:html.slice(0,3950),parse_mode:"HTML",disable_web_page_preview:true,reply_markup:keyboard};
 let result:any;
 if(editId){try{result=await tg("editMessageText",{...data,message_id:editId});}catch(_){result=await tg("sendMessage",data);}}
 else if(s?.menu_message_id){try{result=await tg("editMessageText",{...data,message_id:s.menu_message_id});}catch(_){result=await tg("sendMessage",data);}}
 else result=await tg("sendMessage",data);
 await save(chat,{menu_message_id:Number(result?.message_id||editId||s?.menu_message_id||0)});
}
const nav=(a:any,back="v3:home")=>[[[phrase(a,"⬅️ ត្រឡប់","⬅️ Back"),back],[phrase(a,"🏠 ម៉ឺនុយមេ","🏠 Main Menu"),"v3:home"]]];
function mainKeys(a:any){return kb([
 [[phrase(a,"🔎 ស្វែងរកអតិថិជន","🔎 Find Customer"),"v3:customer"],[phrase(a,"📊 ព័ត៌មានលក់","📊 Sales Information"),"v3:sales"]],
 [[phrase(a,"💰 បំណុលអតិថិជន","💰 Current A/R"),"v3:ar"],[phrase(a,"🧾 ស្វែងរកវិក្កយបត្រ","🧾 Find Invoice"),"v3:invoice"]],
 [[phrase(a,"📦 ការទិញចុងក្រោយ","📦 Last Purchase & Price"),"v3:last"],[phrase(a,"📋 របាយការណ៍អតិថិជន","📋 Customer Summary"),"v3:summary"]],
 [[phrase(a,"💵 ប្រាក់ចំណូលរបស់ខ្ញុំ","💵 My Earnings"),"v3:earn"],[phrase(a,"📨 ស្នើសុំបើកប្រាក់","📨 Request Earnings"),"v3:earn"]],
 [[phrase(a,"📨 ស្ថានភាពសំណើ","📨 Request Status"),"v3:requests"],[phrase(a,"📜 ប្រវត្តិបើកប្រាក់","📜 Payment History"),"v3:history"]],
 [[phrase(a,"🌐 ប្តូរភាសា","🌐 Change Language"),"v3:language"]]
]);}
async function main(chat:string,a:any,editId?:number){const s=await save(chat,{mode:"menu",page:0,selected_earning_ids:[]});await show(chat,s,"🤖 <b>BIG BROTHER Staff Assistant V3</b>\n"+phrase(a,"សូមជ្រើសរើសមុខងារខាងក្រោម។","Choose a function below.")+"\n🔐 "+esc(a.staff_name),mainKeys(a),editId);}
async function languageMenu(chat:string,a:any,editId?:number){const s=await save(chat,{mode:"language"});await show(chat,s,"🌐 <b>BIG BROTHER</b>\nសូមជ្រើសរើសភាសា។\nPlease choose your language.",kb([[["🇰🇭 ភាសាខ្មែរ","v3:lang:km"],["🇬🇧 English","v3:lang:en"]]]),editId);}
async function locationMap(){
 const {data,error}=await db().from("locations").select("location_code,location_name");
 if(error)throw error;return Object.fromEntries((data||[]).map((x:any)=>[x.location_code,x.location_name]));
}
async function allCustomers(){
 const {data,error}=await db().from("customers").select("customer_id,customer_name,location_code").order("customer_name").limit(2000);
 if(error)throw error;return data||[];
}
function score(name:string,query:string){const n=norm(name),q=norm(query);if(n===q)return 0;if(n.startsWith(q))return 1;if(n.includes(q))return 2;return 9;}
async function askCustomer(chat:string,a:any,mode:string,editId?:number){
 const s=await save(chat,{mode:"query_"+mode,page:0,customer_id:null});
 const titles:any={customer:["🔎 ស្វែងរកអតិថិជន","🔎 Find Customer"],sales:["📊 ព័ត៌មានលក់","📊 Sales Information"],ar:["💰 បំណុលអតិថិជន","💰 Current A/R"],summary:["📋 របាយការណ៍អតិថិជន","📋 Customer Summary"],last:["📦 ការទិញចុងក្រោយ","📦 Last Purchase & Price"]};
 const t=titles[mode]||titles.customer;
 await show(chat,s,"<b>"+phrase(a,t[0],t[1])+"</b>\n"+phrase(a,"សូមវាយឈ្មោះអតិថិជន (អាចវាយត្រឹម ៣ តួអក្សរ រួមទាំងស្រៈ)។","Type the customer name (3 or more matching characters)."),kb(nav(a)),editId);
}
async function customerSearch(chat:string,a:any,mode:string,input:string){
 const q=norm(input);if([...q].length<3){await show(chat,await session(chat),phrase(a,"⚠️ សូមវាយយ៉ាងហោចណាស់ ៣ តួអក្សរ។","⚠️ Please enter at least 3 characters."),kb(nav(a,"v3:"+mode)));return;}
 const loc=await locationMap();const customers=(await allCustomers()).map((c:any)=>({...c,_score:score(c.customer_name,q)})).filter((c:any)=>c._score<9).sort((x:any,y:any)=>x._score-y._score||norm(x.customer_name).localeCompare(norm(y.customer_name)));
 if(!customers.length){await show(chat,await session(chat),phrase(a,"រកមិនឃើញអតិថិជនដែលផ្គូផ្គងទេ។ សូមសាកល្បងឈ្មោះផ្សេង។","No matching customers. Try another name."),kb(nav(a,"v3:"+mode)));return;}
 const buttons=customers.slice(0,15).map((c:any)=>[[val(c.customer_name).slice(0,38)+" · "+val(loc[c.location_code]||c.location_code).slice(0,20),"v3:c:"+mode+":"+c.customer_id]]);
 await show(chat,await session(chat),phrase(a,"🔎 សូមជ្រើសរើសអតិថិជន៖","🔎 Choose the correct customer:")+"\n"+phrase(a,"រកឃើញ៖ ","Matches: ")+customers.length,kb([...buttons,...nav(a,"v3:"+mode)]));
}
async function customerHome(chat:string,a:any,id:string,mode:string,editId?:number){
 const {data:c}=await db().from("customers").select("customer_id,customer_name,location_code").eq("customer_id",id).maybeSingle();
 if(!c){await main(chat,a,editId);return;}
 const loc=await locationMap();
 const s=await save(chat,{customer_id:id,mode:"customer_open"});
 if(mode==="summary"||mode==="ar"){await outstanding(chat,a,c,editId);return;}
 if(mode==="sales"){await sales(chat,a,c,editId);return;}
 if(mode==="last"){await last(chat,a,c,editId);return;}
 await show(chat,s,"👤 <b>"+esc(c.customer_name)+"</b>\n📍 "+esc(loc[c.location_code]||c.location_code)+"\n"+phrase(a,"សូមជ្រើសរើសព័ត៌មាន៖","Choose customer information:"),kb([
 [[phrase(a,"💰 បំណុលបច្ចុប្បន្ន","💰 Current A/R"),"v3:aropen"],[phrase(a,"📊 ការលក់","📊 Sales"),"v3:salesopen"]],
 [[phrase(a,"📋 របាយការណ៍សង្ខេប","📋 Summary"),"v3:summaryopen"],[phrase(a,"📦 ការទិញចុងក្រោយ","📦 Last Purchase"),"v3:lastopen"]],
 ...nav(a,"v3:customer")
 ]),editId);
}
async function customerInvoices(id:string){const {data,error}=await db().from("invoices").select("invoice_id,invoice_no,invoice_date,customer_id,currency,grand_total,outstanding,amount_paid,status").eq("customer_id",id).order("invoice_date",{ascending:false}).limit(1000);if(error)throw error;return data||[];}
async function outstanding(chat:string,a:any,c:any,editId?:number){
 const items=(await customerInvoices(c.customer_id)).filter((i:any)=>num(i.outstanding)>0.000001).sort((x:any,y:any)=>val(x.invoice_date).localeCompare(val(y.invoice_date)));
 const loc=await locationMap();const byCur:any={};for(const i of items){const cur=val(i.currency)||"USD";byCur[cur]=(byCur[cur]||0)+num(i.outstanding);}
 let text="📋 <b>"+phrase(a,"របាយការណ៍បំណុលអតិថិជន","Customer Outstanding Summary")+"</b>\n👤 "+esc(c.customer_name)+"\n📍 "+esc(loc[c.location_code]||c.location_code)+"\n🧾 "+phrase(a,"វិក្កយបត្រនៅជំពាក់","Open invoices")+": "+items.length+"\n";
 text+=Object.entries(byCur).map(([cur,total])=>money(total,cur)).join(" / "); 
 text+="\n"+(items.length?items.slice(0,35).map((i:any)=>esc(i.invoice_no)+" · "+fmtDate(i.invoice_date)+" · "+money(i.outstanding,i.currency)).join("\n"):phrase(a,"✅ មិនមានវិក្កយបត្រនៅជំពាក់។","✅ No outstanding invoices."));
 const rows=[[[phrase(a,"📸 រូបវិក្កយបត្រដើម","📸 Original Invoice Album"),"v3:album"]],[[phrase(a,"📊 ប្រវត្តិលក់","📊 Sales History"),"v3:salesopen"],[phrase(a,"📦 ការទិញចុងក្រោយ","📦 Last Purchase"),"v3:lastopen"]],...nav(a,"v3:customer")];
 await show(chat,await save(chat,{mode:"customer_open",customer_id:c.customer_id}),text,kb(rows),editId);
}
async function sales(chat:string,a:any,c:any,editId?:number){
 const inv=await customerInvoices(c.customer_id);const latest=inv.slice(0,20);const loc=await locationMap();const cur:any={};for(const i of inv){const u=val(i.currency)||"USD";cur[u]=(cur[u]||0)+num(i.grand_total);}
 const totals=Object.entries(cur).map(([u,x])=>money(x,u)).join(" / ");
 const t="📊 <b>"+phrase(a,"ប្រវត្តិការលក់","Sales History")+"</b>\n👤 "+esc(c.customer_name)+"\n📍 "+esc(loc[c.location_code]||c.location_code)+"\n"+phrase(a,"សរុបវិក្កយបត្រ","Total invoices")+": "+inv.length+"\n"+phrase(a,"ទឹកប្រាក់វិក្កយបត្រសរុប","Invoiced total")+": "+totals+"\n\n"+latest.map((i:any)=>esc(i.invoice_no)+" · "+fmtDate(i.invoice_date)+" · "+money(i.grand_total,i.currency)).join("\n");
 await show(chat,await save(chat,{mode:"customer_open",customer_id:c.customer_id}),t,kb(nav(a,"v3:summaryopen")),editId);
}
async function last(chat:string,a:any,c:any,editId?:number){
 const inv=(await customerInvoices(c.customer_id)).slice(0,1);if(!inv.length){await show(chat,await session(chat),phrase(a,"មិនទាន់មានការទិញទេ។","No purchases yet."),kb(nav(a,"v3:customer")));return;}
 const i=inv[0];const {data:lines}=await db().from("invoice_lines").select("product_name_snapshot,qty,unit_price,line_total").eq("invoice_id",i.invoice_id).order("line_no");
 let t="📦 <b>"+phrase(a,"ការទិញចុងក្រោយ និងតម្លៃ","Last Purchase & Price")+"</b>\n👤 "+esc(c.customer_name)+"\n🧾 "+esc(i.invoice_no)+" · "+fmtDate(i.invoice_date)+"\n";
 for(const x of lines||[])t+="\n• "+esc(x.product_name_snapshot)+" × "+num(x.qty)+" @ "+money(x.unit_price,i.currency);
 await show(chat,await save(chat,{customer_id:c.customer_id,mode:"customer_open"}),t,kb(nav(a,"v3:customer")),editId);
}
function parseDate(v:string){let m=v.trim().match(/^(\d{1,2})[-\/](\d{1,2}|[a-zA-Z]{3})[-\/](\d{2}|\d{4})$/);if(!m)return null;const names=["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];let mm=/^\d+$/.test(m[2])?Number(m[2]):names.indexOf(m[2].toLowerCase())+1;let y=Number(m[3]);if(y<100)y+=2000;const date=new Date(Date.UTC(y,mm-1,Number(m[1])));if(mm<1||mm>12||date.getUTCDate()!=Number(m[1])||date.getUTCMonth()!=mm-1||date.getUTCFullYear()!=y)return null;return y+"-"+String(mm).padStart(2,"0")+"-"+m[1].padStart(2,"0");}
async function invoiceSearch(chat:string,a:any,input:string){
 const str=val(input);const match=str.match(/^(.*?)\s*\/\s*(\d{1,2}[-\/](?:\d{1,2}|[a-zA-Z]{3})[-\/]\d{2,4})$/);
 let found:any[]=[];
 if(match){const dt=parseDate(match[2]);if(!dt){await show(chat,await session(chat),phrase(a,"កាលបរិច្ឆេទមិនត្រឹមត្រូវ។","Invalid invoice date."),kb(nav(a,"v3:invoice")));return;}
 const names=(await allCustomers()).map((x:any)=>({...x,_score:score(x.customer_name,match[1])})).filter((x:any)=>x._score<9).sort((x:any,y:any)=>x._score-y._score);if(names.length){const ids=names.map((x:any)=>x.customer_id);const {data}=await db().from("invoices").select("invoice_id,invoice_no,invoice_date,customer_id,customer_name_snapshot,location_code").eq("invoice_date",dt).in("customer_id",ids).limit(150);found=(data||[]).sort((x:any,y:any)=>ids.indexOf(x.customer_id)-ids.indexOf(y.customer_id));}}
 else{const {data}=await db().from("invoices").select("invoice_id,invoice_no,invoice_date,customer_id,customer_name_snapshot,location_code").eq("invoice_no",str).limit(50);found=data||[];}
 if(!found.length){await show(chat,await session(chat),phrase(a,"រកមិនឃើញវិក្កយបត្រ។ សូមសាកល្បងម្ដងទៀត។","Invoice not found. Please try again."),kb(nav(a,"v3:invoice")));return;}
 if(found.length===1&&!match){await invoiceOpen(chat,a,found[0].invoice_id);return;}
 const loc=await locationMap();const rows=found.slice(0,15).map((i:any)=>[[esc(i.invoice_no)+" · "+val(i.customer_name_snapshot).slice(0,28)+" · "+val(loc[i.location_code]||i.location_code).slice(0,15)+" · "+fmtDate(i.invoice_date),"v3:i:"+i.invoice_id]]);
 await show(chat,await save(chat,{mode:"invoice_open"}),phrase(a,"🧾 សូមជ្រើសរើសវិក្កយបត្រ៖","🧾 Please select the correct invoice:"),kb([...rows,...nav(a,"v3:invoice")]));
}
async function invoiceOpen(chat:string,a:any,id:string,editId?:number){
 const {data:i}=await db().from("invoices").select("invoice_id,invoice_no,invoice_date,customer_id,customer_name_snapshot,location_code,currency,grand_total,amount_paid,outstanding,status").eq("invoice_id",id).maybeSingle();
 if(!i){await main(chat,a,editId);return;}
 const {data:lines}=await db().from("invoice_lines").select("product_name_snapshot,qty,unit_price,line_total").eq("invoice_id",id).order("line_no");
 const loc=await locationMap();
 let t="🧾 <b>"+phrase(a,"ព័ត៌មានវិក្កយបត្រ","Invoice Details")+"</b>\nNo. "+esc(i.invoice_no)+" · "+fmtDate(i.invoice_date)+"\n👤 "+esc(i.customer_name_snapshot)+"\n📍 "+esc(loc[i.location_code]||i.location_code)+"\n";
 for(const x of (lines||[]).slice(0,25))t+="\n• "+esc(x.product_name_snapshot)+" × "+num(x.qty)+" @ "+money(x.unit_price,i.currency);
 t+="\n\n"+phrase(a,"សរុប","Total")+": "+money(i.grand_total,i.currency)+"\n"+phrase(a,"បានបង់","Paid")+": "+money(i.amount_paid,i.currency)+"\n"+phrase(a,"នៅជំពាក់","Outstanding")+": "+money(i.outstanding,i.currency)+"\n"+phrase(a,"ស្ថានភាព","Status")+": "+esc(i.status);
 await show(chat,await save(chat,{mode:"invoice_open",invoice_id:id}),t,kb([[[phrase(a,"📷 រូបវិក្កយបត្រដើម","📷 Original Invoice Photo"),"v3:photo"]],...nav(a,"v3:invoice")]),editId);
}
async function sendPhotos(chat:string,a:any,invoiceIds:string[],summary?:{name:string, count:number,total:string}){
 if(!invoiceIds.length){await tg("sendMessage",{chat_id:chat,text:phrase(a,"មិនមានរូបវិក្កយបត្រដើមដែលត្រូវផ្ញើ។","No original invoice photos to send.")});return;}
 const {data:files,error}=await db().from("bb_real_invoice_files").select("invoice_id,storage_path,retention_deleted_at").in("invoice_id",invoiceIds);
 if(error)throw error;
 const current=new Map((files||[]).filter((x:any)=>!x.retention_deleted_at).map((x:any)=>[x.invoice_id,x]));
 const ordered=invoiceIds.filter(id=>current.has(id));
 const missing=invoiceIds.filter(id=>!current.has(id));
 const payload:any[]=[];
 for(const id of ordered){
  const f:any=current.get(id);const {data, error:signError}=await db().storage.from("bb-real-invoices").createSignedUrl(f.storage_path,180);
  if(!signError&&data?.signedUrl)payload.push({type:"photo",media:data.signedUrl});
  else missing.push(id);
 }
 if(summary)await tg("sendMessage",{chat_id:chat,text:"📋 "+summary.name+"\n🧾 "+summary.count+" · "+summary.total+"\n📸 "+payload.length+" "+phrase(a,"រូបដើម","original photos")});
 for(let j=0;j<payload.length;j+=10){const group=payload.slice(j,j+10);if(group.length===1)await tg("sendPhoto",{chat_id:chat,photo:group[0].media});else await tg("sendMediaGroup",{chat_id:chat,media:group});}
 if(missing.length)await tg("sendMessage",{chat_id:chat,text:phrase(a,"⚠️ មិនមានរូបដើមសម្រាប់វិក្កយបត្រចំនួន៖ ","⚠️ Missing original photos: ")+missing.length});
}
async function album(chat:string,a:any){
 const s=await session(chat);if(!s?.customer_id)return main(chat,a);
 const {data:c}=await db().from("customers").select("customer_name").eq("customer_id",s.customer_id).maybeSingle();
 const inv=(await customerInvoices(s.customer_id)).filter((x:any)=>num(x.outstanding)>0).sort((x:any,y:any)=>val(x.invoice_date).localeCompare(val(y.invoice_date)));
 const totals:any={};for(const i of inv)totals[i.currency]=(totals[i.currency]||0)+num(i.outstanding);
 await sendPhotos(chat,a,inv.map((x:any)=>x.invoice_id),{name:val(c?.customer_name),count:inv.length,total:Object.entries(totals).map(([k,v])=>money(v,k)).join(" / ")});
}
async function earnIds(a:any){
 const {data:linked}=await db().from("app_user_staff_links").select("user_id").eq("staff_id",a.staff_id).eq("active",true).eq("is_primary",true).limit(1);
 const id=linked?.[0]?.user_id;
 if(id){const {data:other}=await db().from("app_user_staff_links").select("staff_id").eq("user_id",id).eq("active",true);return [...new Set([a.staff_id,...(other||[]).map((x:any)=>x.staff_id)])];}
 return [a.staff_id];
}
async function available(a:any){const ids=await earnIds(a);const {data,error}=await db().from("staff_payment_earnings").select("earning_id,earning_type,source_role,source_date,salary_month,batch_id,location_code,earning_amount,currency,status").in("staff_id",ids).eq("status","AVAILABLE").gt("earning_amount",0).order("source_date",{ascending:false}).order("earning_id",{ascending:false}).limit(300);if(error)throw error;return data||[];}
function earnName(a:any,e:any){if(e.earning_type==="DRIVER_ALLOWANCE")return e.source_role==="DRIVER_2"?phrase(a,"ព្រូឡាន","Driver Assistant"):phrase(a,"អ្នកបើកឡាន","Driver");if(e.earning_type==="MONTHLY_SALARY")return phrase(a,"ប្រាក់ខែ","Monthly Salary");if(e.earning_type==="SPECIAL_ALLOWANCE")return phrase(a,"ប្រាក់ឧបត្ថម្ភពិសេស","Special Allowance");if(e.earning_type==="SALES_INCENTIVE")return phrase(a,"ប្រាក់លើកទឹកចិត្តពីការលក់","Sales Incentive");return val(e.earning_type).replace(/_/g," ");}
async function earningMenu(chat:string,a:any,page=0,editId?:number){
 const all=await available(a);const s=await session(chat);const existing=new Set((s?.selected_earning_ids||[]).map(Number));const active=new Set(all.map((e:any)=>Number(e.earning_id)));const chosen=[...existing].filter(x=>active.has(x));
 const loc=await locationMap(),total:any={};for(const e of all)if(chosen.includes(Number(e.earning_id)))total[e.currency]=(total[e.currency]||0)+num(e.earning_amount);
 const pages=Math.max(1,Math.ceil(all.length/5));page=Math.max(0,Math.min(page,pages-1));
 let text="💵 <b>"+phrase(a,"ប្រាក់ចំណូលដែលអាចស្នើសុំបាន","Available Earnings")+"</b>\n"+phrase(a,"ថ្មីបំផុតមុន · ចុចដើម្បីជ្រើសរើស","Newest first · Tap to select")+"\n"+all.length+" "+phrase(a,"មុខ","entries")+" · "+(page+1)+"/"+pages+"\n";
 const rows:any[]=[];
 for(const e of all.slice(page*5,page*5+5)){
  const isSelected=chosen.includes(Number(e.earning_id));
  const label=(isSelected?"✅ ":"▫️ ")+earnName(a,e)+" | "+fmtDate(e.source_date)+" | "+val(loc[e.location_code]||"")+(e.batch_id?" | "+e.batch_id:"")+" | "+money(e.earning_amount,e.currency);
  rows.push([[label.slice(0,64),"v3:e:"+e.earning_id]]);
 }
 text+="\n"+phrase(a,"បានជ្រើសរើស៖ ","Selected: ")+chosen.length+" "+phrase(a,"មុខ","entries")+"\n"+phrase(a,"សរុប៖ ","Total: ")+(Object.keys(total).length?Object.entries(total).map(([k,v])=>money(v,k)).join(" / "):"$0.00");
 const controls:any[]=[];if(page>0)controls.push([phrase(a,"⬅️ មុន","⬅️ Previous"),"v3:ep:"+(page-1)]);if(page<pages-1)controls.push([phrase(a,"បន្ទាប់ ➡️","Next ➡️"),"v3:ep:"+(page+1)]);
 if(controls.length)rows.push(controls);
 rows.push([[phrase(a,"🗑 លុបជម្រើស","🗑 Clear"),"v3:ec"],[phrase(a,"✅ បញ្ចប់","✅ Finish"),"v3:finish"]]);
 await show(chat,await save(chat,{mode:"earn",page,selected_earning_ids:chosen}),text,kb([...rows,...nav(a)]),editId);
}
async function earningFinish(chat:string,a:any,editId?:number){
 const s=await session(chat),all=await available(a),chosen=all.filter((e:any)=>(s?.selected_earning_ids||[]).includes(Number(e.earning_id)));
 if(!chosen.length){await earningMenu(chat,a,s?.page||0,editId);return;}
 const currencies=[...new Set(chosen.map((e:any)=>e.currency))];if(currencies.length>1){await show(chat,s,phrase(a,"⚠️ សូមស្នើសុំប្រាក់ USD និង KHR ដាច់ដោយឡែក។","⚠️ Request USD and KHR separately."),kb(nav(a,"v3:earn")),editId);return;}
 const loc=await locationMap();const total=chosen.reduce((acc:number,x:any)=>acc+num(x.earning_amount),0);
 const t="📋 <b>"+phrase(a,"បញ្ជាក់សំណើសុំបើកប្រាក់","Confirm Earnings Request")+"</b>\n\n"+chosen.map((e:any)=>"• "+esc(earnName(a,e))+" · "+fmtDate(e.source_date)+" · "+esc(loc[e.location_code]||"")+(e.batch_id?" · "+esc(e.batch_id):"")+" — "+money(e.earning_amount,e.currency)).join("\n")+"\n\n<b>"+phrase(a,"សរុប","Total")+": "+money(total,currencies[0])+"</b>";
 await show(chat,await save(chat,{mode:"earn_confirm"}),t,kb([[[phrase(a,"➕ ជ្រើសរើសបន្ថែម","➕ Select More"),"v3:earn"],[phrase(a,"✅ ផ្ញើសំណើ","✅ Submit Request"),"v3:submit"]],...nav(a)]),editId);
}
async function requests(chat:string,a:any,history=false,editId?:number){
 const ids=await earnIds(a);
 const {data:r,error}=await db().from("staff_payment_requests").select("request_id,requested_at,requested_amount,approved_amount,currency,status,admin_note,expense_id").in("staff_id",ids).order("requested_at",{ascending:false}).limit(20);
 if(error)throw error;
 const list=(r||[]).filter((x:any)=>history?["PAID","APPROVED","REJECTED"].includes(val(x.status).toUpperCase()):!["PAID","REJECTED"].includes(val(x.status).toUpperCase()));
 const t=(history?"📜 ":"📨 ")+"<b>"+(history?phrase(a,"ប្រវត្តិបើកប្រាក់","Payment History"):phrase(a,"ស្ថានភាពសំណើ","Request Status"))+"</b>\n\n"+(list.length?list.map((x:any)=>"SPR-"+String(x.request_id).padStart(6,"0")+" · "+fmtDate(x.requested_at)+"\n"+money(x.requested_amount,x.currency)+" · "+esc(x.status)+(x.admin_note?"\n"+esc(x.admin_note):"")).join("\n\n"):phrase(a,"មិនមានសំណើទេ។","No requests found."));
 await show(chat,await save(chat,{mode:"menu"}),t,kb(nav(a)),editId);
}
async function route(update:any){
 const cb=update.callback_query;const m=cb?.message||update.message;
 if(!m||m.chat?.type!=="private"||m.from?.is_bot&&!cb)return false;
 const user=val(cb?.from?.id||m.from?.id),chat=val(m.chat?.id);
 if(user!==chat||!/^\d{5,20}$/.test(user))return false;
 const action=val(cb?.data);
 if(action&&!action.startsWith("v3:"))return false;
 const input=val(m.text);
 const start=/^\/start(?:@\w+)?$/i.test(input),staffCommand=/^\/(?:staff|assistant)(?:@\w+)?$/i.test(input);
 const a=await validAccount(user);
 if(!a){
  if(staffCommand||action.startsWith("v3:")){await tg("sendMessage",{chat_id:chat,text:"🔒 BIG BROTHER Staff Assistant requires Admin verification.\nYour Telegram User ID: "+user+"\nAsk your BIG BROTHER administrator to link this ID to your Staff ID."});return true;}
  return false;
 }
 if(!cb&&!start&&!staffCommand&&!/^\/language(?:@\w+)?$/i.test(input)&&!await session(user))return false;
 const editId=cb?Number(m.message_id):undefined;
 if(cb)await tg("answerCallbackQuery",{callback_query_id:cb.id}).catch(()=>{});
 if(start||staffCommand){if(!a.language_confirmed)await languageMenu(chat,a,editId);else await main(chat,a,editId);return true;}
 if(input.startsWith("/language")||action==="v3:language"){await languageMenu(chat,a,editId);return true;}
 if(action.startsWith("v3:lang:")){const l=action.endsWith(":en")?"en":"km";await db().from("bb_staff_assistant_accounts").update({language:l,language_confirmed:true,updated_at:new Date().toISOString()}).eq("telegram_user_id",user);await main(chat,{...a,language:l},editId);return true;}
 if(action==="v3:home"){await main(chat,a,editId);return true;}
 const modes=["customer","sales","ar","summary","last"];
 if(modes.some(x=>action==="v3:"+x)){await askCustomer(chat,a,action.slice(3),editId);return true;}
 if(action==="v3:invoice"){await show(chat,await save(chat,{mode:"query_invoice"}),phrase(a,"🧾 វាយលេខវិក្កយបត្រ ឬឈ្មោះអតិថិជន / កាលបរិច្ឆេទ\nឧ. 3301 ឬ សុវ / 16-09-26","🧾 Enter invoice number, or customer / invoice date\nE.g. 3301 or Sov / 16-09-26"),kb(nav(a)),editId);return true;}
 if(action.startsWith("v3:c:")){const rest=action.slice(5).split(":");await customerHome(chat,a,rest.slice(1).join(":"),rest[0],editId);return true;}
 if(action.startsWith("v3:i:")){await invoiceOpen(chat,a,action.slice(5),editId);return true;}
 if(action==="v3:summaryopen"||action==="v3:aropen"||action==="v3:salesopen"||action==="v3:lastopen"){
  const s=await session(user);if(!s?.customer_id){await main(chat,a,editId);return true;}
  const mode=action.slice(3).replace("open","");
  await customerHome(chat,a,s.customer_id,mode,editId);return true;
 }
 if(action==="v3:album"){await album(chat,a);return true;}
 if(action==="v3:photo"){const s=await session(user);if(s?.invoice_id)await sendPhotos(chat,a,[s.invoice_id]);return true;}
 if(action==="v3:earn"){await earningMenu(chat,a,(await session(user))?.page||0,editId);return true;}
 if(action.startsWith("v3:ep:")){await earningMenu(chat,a,Number(action.slice(6))||0,editId);return true;}
 if(action==="v3:ec"){await save(user,{selected_earning_ids:[]});await earningMenu(chat,a,0,editId);return true;}
 if(action.startsWith("v3:e:")){const id=Number(action.slice(5)),s=await session(user);const all=await available(a);if(!all.some((e:any)=>Number(e.earning_id)===id)){await earningMenu(chat,a,s?.page||0,editId);return true;}const chosen=new Set<number>((s?.selected_earning_ids||[]).map(Number));if(chosen.has(id))chosen.delete(id);else chosen.add(id);await save(user,{selected_earning_ids:[...chosen]});await earningMenu(chat,a,s?.page||0,editId);return true;}
 if(action==="v3:finish"){await earningFinish(chat,a,editId);return true;}
 if(action==="v3:submit"){
  // Do not create a second payment workflow. Financial submission requires the
  // separate, privileged Staff Relation bridge, installed only after verification.
  await show(chat,await session(user),phrase(a,"🔒 ការស្នើសុំតាម Telegram កំពុងរង់ចាំការភ្ជាប់សុវត្ថិភាពទៅ Staff Relation។ អ្នកអាចស្នើសុំតាម Staff Relation បានឥឡូវនេះ។","🔒 Telegram payment submission awaits the secure Staff Relation identity bridge. You can submit from Staff Relation now."),kb(nav(a,"v3:earn")),editId);return true;
 }
 if(action==="v3:requests"||action==="v3:history"){await requests(chat,a,action==="v3:history",editId);return true;}
 if(!cb&&input&&!input.startsWith("/")){
  const s=await session(user);
  if(s?.mode==="query_invoice"){await invoiceSearch(chat,a,input);return true;}
  if(val(s?.mode).startsWith("query_")){await customerSearch(chat,a,s.mode.slice(6),input);return true;}
 }
 return false;
}
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return new Response("Method not allowed",{status:405});
 if(val(req.headers.get("authorization"))!=="Bearer "+env("SUPABASE_SERVICE_ROLE_KEY"))return new Response("Unauthorized",{status:401});
 const {data:cfg,error}=await db().from("bb_telegram_inbound_config").select("secret").eq("config_key","telegram_main").maybeSingle();
 if(error||!cfg?.secret||val(req.headers.get("x-bb-forwarded-secret"))!==cfg.secret)return new Response("Unauthorized",{status:401});
 try{const update=await req.json();const handled=await route(update);return Response.json({ok:true,handled},{headers:{"cache-control":"no-store"}});}
 catch(e){console.error("Staff Assistant V3 failed:",e instanceof Error?e.name:"error");return Response.json({ok:false,handled:true},{status:500,headers:{"cache-control":"no-store"}});}
});
