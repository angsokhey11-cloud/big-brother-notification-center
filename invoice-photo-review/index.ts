import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.49.10";
const cors={"access-control-allow-origin":"https://angsokhey11-cloud.github.io","access-control-allow-methods":"POST,OPTIONS","access-control-allow-headers":"content-type","cache-control":"no-store","vary":"Origin"};
const response=(obj:unknown,status=200)=>Response.json(obj,{status,headers:cors});
const val=(s:unknown)=>String(s??"").trim();
const db=()=>createClient(Deno.env.get("SUPABASE_URL")||"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",{auth:{persistSession:false}});
const bytes=new TextEncoder();
async function hmac(key:Uint8Array|ArrayBuffer,data:string){
 const k=await crypto.subtle.importKey("raw",key,"HMAC",false,["sign"]);
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
 const mime=file.headers.get("content-type")||"image/jpeg";
 if(!mime.startsWith("image/"))throw Error("Not an image");
 const content=await file.arrayBuffer();
 if(content.byteLength>20_000_000)throw Error("Picture is too large");
 return new Response(content,{status:200,headers:{...cors,"content-type":mime,"content-length":String(content.byteLength)}});
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
    const q=client.from("bb_invoice_photo_review_batches").select("batch_id,route_id,status,created_at,expires_at").eq("reviewer_telegram_user_id",user).in("route_id",routeIds).gt("expires_at",new Date().toISOString());
    const {data,error}=id?await q.eq("batch_id",id).maybeSingle():await q.in("status",["collecting","awaiting_review"]).order("created_at",{ascending:false}).limit(1).maybeSingle();
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