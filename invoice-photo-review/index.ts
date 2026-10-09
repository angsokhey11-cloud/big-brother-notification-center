import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.49.10";
const cors={"access-control-allow-origin":"https://angsokhey11-cloud.github.io","access-control-allow-methods":"POST,OPTIONS","access-control-allow-headers":"content-type","cache-control":"no-store","vary":"Origin"};
const response=(obj:unknown,status=200)=>Response.json(obj,{status,headers:cors});
const val=(s:unknown)=>String(s??"").trim();
const db=()=>createClient(Deno.env.get("SUPABASE_URL")||"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",{auth:{persistSession:false}});
const bytes=new TextEncoder();
async function hmac(key:Uint8Array|ArrayBuffer,data:string){
 const k=await crypto.subtle.importKey("raw",key,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 return new Uint8Array(await crypto.subtle.sign("HMAC",k,bytes.encode(data)));
}
function hex(a:Uint8Array){return Array.from(a,b=>b.toString(16).padStart(2,"0")).join("");}
function eqhex(a:string,b:string){if(a.length!==b.length)return false;let v=0;for(let i=0;i<a.length;i++)v|=a.charCodeAt(i)^b.charCodeAt(i);return v===0;}
async function telegramUser(raw:string):Promise<string>{
 const token=Deno.env.get("TELEGRAM_BOT_TOKEN");
 if(!token||!raw||raw.length>10000)throw Error("Telegram authorization required");
 const p=new URLSearchParams(raw),hash=val(p.get("hash"));
 if(!/^[a-fA-F0-9]{64}$/.test(hash))throw Error("Invalid Telegram authorization");
 p.delete("hash");
 const sorted=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+"="+v).join("\n");
 // Telegram Mini App HMAC: key = HMAC_SHA256('WebAppData', bot_token).
 const secret=await hmac(bytes.encode("WebAppData"),token);
 const digest=hex(await hmac(secret,sorted));
 if(!eqhex(digest,hash.toLowerCase()))throw Error("Telegram signature mismatch");
 const date=Number(p.get("auth_date")),now=Math.floor(Date.now()/1000);
 if(!Number.isSafeInteger(date)||date>now+120||date<now-3600)throw Error("Telegram session expired. Reopen the review from your private bot chat.");
 let u:any;try{u=JSON.parse(val(p.get("user")));}catch{throw Error("Telegram user missing");}
 const id=val(u?.id);
 if(!/^[0-9]{5,20}$/.test(id)||u?.is_bot===true)throw Error("Telegram user invalid");
 return id;
}
async function tgFile(fileId:string):Promise<Response>{
 const token=Deno.env.get("TELEGRAM_BOT_TOKEN")||"";
 const r=await fetch("https://api.telegram.org/bot"+token+"/getFile?file_id="+encodeURIComponent(fileId));
 const j=await r.json().catch(()=>null);
 if(!r.ok||j?.ok!==true||!j.result?.file_path)throw Error("Telegram picture unavailable");
 if(Number(j.result.file_size||0)>20_000_000)throw Error("Picture is too large");
 const file=await fetch("https://api.telegram.org/file/bot"+token+"/"+j.result.file_path);
 if(!file.ok)throw Error("Unable to retrieve Telegram picture");
 // Telegram's file endpoint can return application/octet-stream for real photos.
 // Determine the media type from verified image bytes, never an unreliable HTTP label.
 const declaredSize=Number(file.headers.get("content-length")||0);
 if(declaredSize>20_000_000)throw Error("Picture is too large");
 const content=await file.arrayBuffer();
 if(content.byteLength===0||content.byteLength>20_000_000)throw Error("Picture is too large or empty");
 const b=new Uint8Array(content);
 let mime:string|null=null;
 if(b.length>=3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)mime="image/jpeg";
 else if(b.length>=8&&b[0]===0x89&&b[1]===0x50&&b[2]===0x4e&&b[3]===0x47&&b[4]===0x0d&&b[5]===0x0a&&b[6]===0x1a&&b[7]===0x0a)mime="image/png";
 else if(b.length>=12&&b[0]===0x52&&b[1]===0x49&&b[2]===0x46&&b[3]===0x46&&b[8]===0x57&&b[9]===0x45&&b[10]===0x42&&b[11]===0x50)mime="image/webp";
 if(!mime){
  // Log metadata only, never original photo pixels, file ID, token, or URL.
  console.warn("Invoice photo binary signature unsupported",{
   declaredType:(file.headers.get("content-type")||"unknown").slice(0,80),
   bytes:b.length
  });
  throw Error("Telegram returned unsupported image data. Please contact admin.");
 }
 return new Response(content,{status:200,headers:{...cors,"content-type":mime,"content-length":String(content.byteLength),"x-content-type-options":"nosniff"}});
}
const botToken=()=>Deno.env.get("TELEGRAM_BOT_TOKEN")||"";
const tg=async(method:string,data:Record<string,unknown>)=>{
 const res=await fetch("https://api.telegram.org/bot"+botToken()+"/"+method,{
  method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)
 });
 const b=await res.json().catch(()=>null);
 if(!res.ok||b?.ok!==true)throw Error("Telegram "+method+" failed: "+val(b?.description).slice(0,140));
 return b.result;
};
const sortInvoice=(a:any,b:any)=>val(a.invoice_date).localeCompare(val(b.invoice_date))||
 // BigInt preserves numeric ordering and leading zeros stay intact as strings.
 (BigInt(val(a.invoice_no))<BigInt(val(b.invoice_no))?-1:BigInt(val(a.invoice_no))>BigInt(val(b.invoice_no))?1:0)||
 Number(a.source_message_id)-Number(b.source_message_id);
// Human-confirmed invoice range report for private Telegram completion.
// Range difference is last minus first (user-facing convention); it is NOT an
// inclusive count. Skip positions are absent serial offsets from first,
// for example 2225 in range 2220–2233 is position "05".
// A gap over 20 numbers starts a separate paper-book range on the same date.
function invoiceRangeReport(rows:any[]):string[]{
 const byDate=new Map<string,any[]>();
 for(const r of rows){
  const date=val(r.invoice_date),no=val(r.invoice_no);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{1,16}$/.test(no))continue;
  if(!byDate.has(date))byDate.set(date,[]);
  byDate.get(date)!.push(r);
 }
 const months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
 const pretty=(d:string)=>{
  const [y,m,day]=d.split("-");
  return day+"-"+(months[Number(m)-1]||m)+"-"+y;
 };
 const lines:string[]=["📊 BIG BROTHER — INVOICE RANGE SUMMARY",
   "Confirmed invoice photos: "+rows.length,""];
 for(const date of [...byDate.keys()].sort()){
  const sorted=byDate.get(date)!.slice().sort((a,b)=>{
   const d=BigInt(a.invoice_no)-BigInt(b.invoice_no);
   return d<0n?-1:d>0n?1:Number(a.source_message_id||0)-Number(b.source_message_id||0);
  });
  lines.push("📅 "+pretty(date)+" — "+sorted.length+" invoice"+(sorted.length===1?"":"s"));
  const groups:{first:string,last:string,start:bigint,end:bigint,count:number,numbers:Set<string>}[]=[];
  for(const row of sorted){
   const number=BigInt(row.invoice_no);
   const current=groups[groups.length-1];
   if(!current||number-current.end>20n){
    groups.push({first:row.invoice_no,last:row.invoice_no,start:number,end:number,count:1,numbers:new Set([number.toString()])});
   }else{
    current.last=row.invoice_no;
    current.end=number;
    current.count++;
    current.numbers.add(number.toString());
   }
  }
  for(const [i,group] of groups.entries()){
   const skipped:string[]=[];
   for(let n=group.start+1n;n<group.end;n++){
    if(!group.numbers.has(n.toString()))skipped.push(String(n-group.start).padStart(2,"0"));
   }
   lines.push("  Range "+(i+1)+": "+group.first+"–"+group.last+" = "+String(group.end-group.start));
   lines.push("  "+group.count+" reviewed invoice"+(group.count===1?"":"s")+" · Skip "+(skipped.length?skipped.join(", "):"None"));
  }
  lines.push("");
 }
 lines.push("Range = last − first; skips are missing positions counted from the first number.");
 return lines;
}
function telegramReportChunks(lines:string[],max=3500):string[]{
 const chunks:string[]=[];let chunk="";
 for(const line of lines){
  if(line.length>max){
   if(chunk){chunks.push(chunk.trimEnd());chunk="";}
   // Overflow protection for very large missing-number lists.
   for(let pos=0;pos<line.length;pos+=max)chunks.push(line.slice(pos,pos+max));
   continue;
  }
  if(chunk.length+line.length+1>max){chunks.push(chunk.trimEnd());chunk="";}
  chunk+=line+"\n";
 }
 if(chunk.trim())chunks.push(chunk.trimEnd());
 return chunks;
}

async function deliverBatch(batchId:string,reviewer:string){
 const client=db();
 const {data:batch,error:be}=await client.from("bb_invoice_photo_review_batches").select("*")
  .eq("batch_id",batchId).eq("reviewer_telegram_user_id",reviewer).maybeSingle();
 if(be||!batch||!["approved","delivering","failed"].includes(batch.status))throw Error("Approved review batch not available");
 const {data:photos,error:pe}=await client.from("bb_invoice_photo_queue").select("queue_id,source_message_id,telegram_file_id,invoice_no,invoice_date,review_state")
   .eq("review_batch_id",batchId).order("source_message_id").limit(300);
 if(pe||!photos?.length)throw Error("No invoice photos in this batch");
 if(photos.some((x:any)=>x.review_state!=="confirmed"||!x.invoice_no||!x.invoice_date))
   throw Error("Unverified pictures cannot be delivered");
 const ordered=[...photos].sort(sortInvoice);
 const {data:destinations,error:de}=await client.from("bb_invoice_photo_destinations")
  .select("destination_id,destination_label,telegram_chat_id,telegram_thread_id,active")
  .eq("route_id",batch.route_id).eq("active",true).order("destination_id");
 if(de||!destinations?.length)throw Error("No delivery destinations configured");
 const privateOk=destinations.some((x:any)=>val(x.telegram_chat_id)===reviewer&&Number(x.telegram_thread_id)===0);
 const groupOk=destinations.some((x:any)=>val(x.telegram_chat_id).startsWith("-"));
 if(!privateOk||!groupOk)throw Error("Both a group/topic and your private chat must be mapped before delivery");
 const albums:Array<any[]>=[];
 for(let i=0;i<ordered.length;i+=10)albums.push(ordered.slice(i,i+10));
 for(const d of destinations){
  for(let i=0;i<albums.length;i++){
   const {error:insertError}=await client.from("bb_invoice_photo_delivery_albums")
    .upsert({batch_id:batchId,destination_id:d.destination_id,album_index:i,status:"pending"},
       {onConflict:"batch_id,destination_id,album_index",ignoreDuplicates:true});
   if(insertError)throw insertError;
  }
 }
 const {error:inProgress}=await client.from("bb_invoice_photo_review_batches")
  .update({status:"delivering",delivery_started_at:new Date().toISOString(),delivery_error:null})
  .eq("batch_id",batchId);
 if(inProgress)throw inProgress;
 let sent=0,failed=0,ambiguous=0;
 for(const d of destinations){
  for(let i=0;i<albums.length;i++){
   const {data:row,error:readError}=await client.from("bb_invoice_photo_delivery_albums")
    .select("status").eq("batch_id",batchId).eq("destination_id",d.destination_id).eq("album_index",i).single();
   if(readError)throw readError;
   if(row.status==="sent")continue;
   if(row.status==="sending"){ambiguous++;continue;}
   const {data:claimed,error:claimErr}=await client.from("bb_invoice_photo_delivery_albums")
     .update({status:"sending",error_text:null,updated_at:new Date().toISOString()})
     .eq("batch_id",batchId).eq("destination_id",d.destination_id).eq("album_index",i)
     .in("status",["pending","failed"]).select("status");
   if(claimErr)throw claimErr;
   if(!claimed?.length){ambiguous++;continue;}
   const parts=albums[i];
   const dst:Record<string,unknown>={chat_id:d.telegram_chat_id};
   if(Number(d.telegram_thread_id)>0)dst.message_thread_id=d.telegram_thread_id;
   let telegramAccepted=false;
   try{
    // Original Telegram photo IDs: no redrawing, no cropping risk, no image blobs persisted.
    const caption=(x:any)=>"🧾 "+val(x.invoice_no)+" • "+val(x.invoice_date);
    let result:any;
    if(parts.length===1)result=await tg("sendPhoto",{...dst,photo:parts[0].telegram_file_id,caption:caption(parts[0])});
    else result=await tg("sendMediaGroup",{...dst,media:parts.map((x:any)=>({type:"photo",media:x.telegram_file_id,caption:caption(x)}))});
    telegramAccepted=true;
    const mids=(Array.isArray(result)?result:[result]).map((x:any)=>x?.message_id).filter((x:any)=>Number.isSafeInteger(x));
    const {error:okError}=await client.from("bb_invoice_photo_delivery_albums")
      .update({status:"sent",telegram_message_ids:mids,updated_at:new Date().toISOString()})
      .eq("batch_id",batchId).eq("destination_id",d.destination_id).eq("album_index",i);
    if(okError)throw okError;
    sent++;
   }catch(e){
    failed++;
    const message=e instanceof Error?e.message:"Unable to send album";
    // A transport timeout can be ambiguous: mark as sending, do not automatically duplicate.
    const uncertain=telegramAccepted||/fetch failed|network|timeout|connection|internal server/i.test(message);
    await client.from("bb_invoice_photo_delivery_albums").update({status:uncertain?"sending":"failed",error_text:message.slice(0,200),updated_at:new Date().toISOString()})
     .eq("batch_id",batchId).eq("destination_id",d.destination_id).eq("album_index",i);
    console.error("Invoice album delivery failed",message);
    if(uncertain)ambiguous++;
   }
  }
 }
 const {data:pending,error:pendingError}=await client.from("bb_invoice_photo_delivery_albums")
  .select("status").eq("batch_id",batchId).neq("status","sent");
 if(pendingError)throw pendingError;
 if(!pending?.length){
  // Drop all private processing metadata on verified delivery to all targets.
  // The report goes only to the mapped private reviewer, never to staff groups.
  // Do not turn an already-successful album delivery into an error if the
  // informational text can't be posted; never resend already-delivered albums.
  for(const chunk of telegramReportChunks(invoiceRangeReport(ordered))){
   try{await tg("sendMessage",{chat_id:reviewer,text:chunk});}
   catch(e){console.warn("Private invoice range summary message failed",e instanceof Error?e.name:"unknown");}
  }
  await tg("sendMessage",{chat_id:reviewer,text:"✅ BIG BROTHER — Invoice photo albums delivered to your mapped group/topic and private chat. Temporary review files are now cleared."}).catch(()=>{});
  const {error:cleanup}=await client.from("bb_invoice_photo_review_batches").delete().eq("batch_id",batchId);
  if(cleanup)throw cleanup;
  return {ok:true,completed:true,sent};
 }
 await client.from("bb_invoice_photo_review_batches").update({
    status:"failed",delivery_error:ambiguous?
       "At least one album delivery is uncertain. Contact admin before resending.":
       failed+" album delivery attempts failed; successful albums will not be resent."
 }).eq("batch_id",batchId);
 await tg("sendMessage",{chat_id:reviewer,text:"⚠️ BIG BROTHER invoice delivery needs attention. Some destinations failed. Previously delivered albums will not be sent again. Reopen /review to check details."}).catch(()=>{});
 return {ok:false,completed:false,sent,failed,ambiguous};
}

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return response({error:"POST required"},405);
 try{
  const body=await req.json().catch(()=>({}));
  const user=await telegramUser(val(body.init_data)),client=db();
  const {data:admin,error:adminError}=await client.from("bb_telegram_assistant_admins").select("telegram_user_id").eq("telegram_user_id",user).maybeSingle();
  if(adminError||!admin)return response({error:"Private reviewer access required"},403);
  const {data:routes,error:routeError}=await client.from("bb_invoice_photo_routes").select("route_id,route_label,reviewer_telegram_user_id").eq("reviewer_telegram_user_id",user).eq("source_chat_id",user).eq("source_thread_id",0).eq("intake_mode","private_forward_only").eq("review_mode","manual_all").limit(10);
  if(routeError||!routes?.length)return response({error:"No private reviewer mapping found"},403);
  const routeIds=routes.map((r:any)=>r.route_id);
  const action=val(body.action);
  const getBatch=async(batchId:unknown)=>{
    const id=val(batchId);
    const q=client.from("bb_invoice_photo_review_batches").select("batch_id,route_id,status,created_at,expires_at,delivery_error").eq("reviewer_telegram_user_id",user).in("route_id",routeIds).gt("expires_at",new Date().toISOString());
    const {data,error}=id?await q.eq("batch_id",id).maybeSingle():await q.in("status",["collecting","awaiting_review","approved","delivering","failed"]).order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(error)throw error;
    if(!data)throw Error("No active review batch found");
    return data;
  };
  if(action==="load"){
    let batch;
    try{batch=await getBatch(body.batch_id);}catch(e){return response({ok:true,empty:true,reason:e instanceof Error?e.message:"No review tasks"});}
    const {data,error}=await client.from("bb_invoice_photo_queue").select("queue_id,source_message_id,review_state,invoice_no,invoice_date,received_at").eq("review_batch_id",batch.batch_id).order("source_message_id",{ascending:true}).limit(300);
    if(error)throw error;
    return response({ok:true,batch,items:data||[],delivery_connected:false});
  }
  if(action==="approve"||action==="retry"){
    const batch=await getBatch(body.batch_id);
    if(action==="approve"&&batch.status!=="awaiting_review")return response({error:"Review batch is not awaiting approval"},409);
    if(action==="retry"&&batch.status!=="failed")return response({error:"Only failed delivery attempts may be retried"},409);
    if(action==="retry"){
      const {data:uncertain,error:ue}=await client.from("bb_invoice_photo_delivery_albums")
        .select("album_index").eq("batch_id",batch.batch_id).eq("status","sending").limit(1);
      if(ue)throw ue;
      if(uncertain?.length)return response({error:"At least one Telegram delivery result is uncertain. Ask admin to verify before retrying; we must not risk duplicate invoice albums."},409);
    }
    const {data:photos,error:pe}=await client.from("bb_invoice_photo_queue")
      .select("review_state,invoice_no,invoice_date,confirmed_by_telegram_user_id")
      .eq("review_batch_id",batch.batch_id);
    if(pe)throw pe;
    if(!photos?.length||photos.some((x:any)=>x.review_state!=="confirmed"||!x.invoice_no||!x.invoice_date||x.confirmed_by_telegram_user_id!==user))
      return response({error:"Every invoice number and date must be confirmed by you before sending"},409);
    const {data:destinations,error:de}=await client.from("bb_invoice_photo_destinations")
      .select("telegram_chat_id,telegram_thread_id").eq("route_id",batch.route_id).eq("active",true);
    if(de)throw de;
    if(!destinations?.some((x:any)=>val(x.telegram_chat_id)===user&&Number(x.telegram_thread_id)===0)
     ||!destinations?.some((x:any)=>val(x.telegram_chat_id).startsWith("-")))
       return response({error:"Map both your group/topic and private chat before approving"},409);
    if(action==="approve"){
      const {data:approved,error:ae}=await client.from("bb_invoice_photo_review_batches")
        .update({status:"approved",approved_at:new Date().toISOString(),approved_by_telegram_user_id:user})
        .eq("batch_id",batch.batch_id).eq("status","awaiting_review").select("batch_id");
      if(ae)return response({error:ae.message},409);
      if(!approved?.length)return response({error:"Batch already approved or changed"},409);
    }
    // Delivery is awaited for small collections and retains per-album status for safe retries.
    const outcome=await deliverBatch(batch.batch_id,user);
    return response(outcome,outcome.ok?200:207);
  }
  if(!["save","photo"].includes(action))return response({error:"Unsupported operation"},400);
  const batch=await getBatch(body.batch_id);
  if(!["collecting","awaiting_review"].includes(batch.status))return response({error:"Batch is not editable"},409);
  const itemId=Number(body.queue_id);
  if(!Number.isSafeInteger(itemId)||itemId<=0)return response({error:"Invalid invoice item"},400);
  const {data:item,error:itemError}=await client.from("bb_invoice_photo_queue").select("queue_id,telegram_file_id").eq("review_batch_id",batch.batch_id).eq("route_id",batch.route_id).eq("queue_id",itemId).maybeSingle();
  if(itemError||!item)return response({error:"Invoice picture not found"},404);
  if(action==="photo")return await tgFile(item.telegram_file_id);
  if(batch.status!=="awaiting_review")return response({error:"Wait until photo collection has finished"},409);
  const no=val(body.invoice_no),date=val(body.invoice_date);
  if(!/^[0-9]{1,16}$/.test(no))return response({error:"Enter a numeric invoice number (keep leading zeros)"},400);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return response({error:"Choose an invoice date"},400);
  const valid=new Date(date+"T00:00:00Z");
  if(!Number.isFinite(valid.getTime())||valid.toISOString().slice(0,10)!==date)return response({error:"Invalid invoice date"},400);
  const {data:updated,error:upError}=await client.from("bb_invoice_photo_queue")
    .update({invoice_no:no,invoice_date:date,review_state:"confirmed",confirmed_by_telegram_user_id:user,confirmed_at:new Date().toISOString()})
    .eq("queue_id",itemId).eq("review_batch_id",batch.batch_id).select("queue_id,invoice_no,invoice_date,review_state").maybeSingle();
  if(upError)throw upError;
  if(!updated)return response({error:"Item was changed or expired"},409);
  return response({ok:true,item:updated});
 }catch(e){console.error("Private invoice review API failed",e instanceof Error?e.name:"unknown");return response({error:e instanceof Error?e.message:"Unable to process review request"},400);}
});