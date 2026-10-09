import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.10";
const clean=(v:unknown)=>String(v??"").trim();
const headers={"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":"https://angsokhey11-cloud.github.io","access-control-allow-headers":"authorization,apikey,content-type,x-client-info","access-control-allow-methods":"POST,OPTIONS"};
const send=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers});
const chatOk=(v:string)=>/^-?[0-9]{5,20}$/.test(v);
const validThread=(v:number)=>Number.isSafeInteger(v)&&v>=0;
const validId=(v:number)=>Number.isSafeInteger(v)&&v>0;
const validPrivateUser=(v:string)=>/^[0-9]{5,20}$/.test(v);
const db=()=>createClient(Deno.env.get("SUPABASE_URL")||"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",{auth:{persistSession:false}});
const tg=async(method:string,data:Record<string,unknown>)=>{
 const token=Deno.env.get("TELEGRAM_BOT_TOKEN");
 if(!token)throw Error("Telegram bot token not configured");
 const r=await fetch("https://api.telegram.org/bot"+token+"/"+method,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)});
 const j=await r.json().catch(()=>({}));
 if(!r.ok||!j.ok)throw Error(clean(j.description)||"Telegram delivery failed");
 return j.result;
};
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return send({error:"POST required"},405);
 const jwt=req.headers.get("authorization")||"";
 if(!jwt.startsWith("Bearer "))return send({error:"Sign in required"},401);
 const url=Deno.env.get("SUPABASE_URL")||"",anon=Deno.env.get("SUPABASE_ANON_KEY")||"",service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 if(!url||!anon||!service)return send({error:"Server configuration unavailable"},503);
 const auth=createClient(url,anon,{global:{headers:{Authorization:jwt}},auth:{persistSession:false}});
 const {data:{user},error}=await auth.auth.getUser(jwt.slice(7));
 if(error||!user)return send({error:"Sign in required"},401);
 const client=db();
 const {data:profile,error:profileError}=await client.from("app_users").select("role,active").eq("user_id",user.id).maybeSingle();
 if(profileError||!profile?.active||clean(profile.role).toLowerCase()!=="admin")return send({error:"Admin access required"},403);
 try{
  const body=await req.json().catch(()=>({}));
  const action=clean(body.action);
  if(action==="list"){
    const [routes,destinations,queue]=await Promise.all([
      client.from("bb_invoice_photo_routes").select("*").order("route_id"),
      client.from("bb_invoice_photo_destinations").select("*").order("destination_id"),
      client.from("bb_invoice_photo_queue").select("queue_id",{count:"exact",head:true})
    ]);
    if(routes.error||destinations.error||queue.error)throw Error("Could not load organizer routing");
    return send({ok:true,routes:routes.data||[],destinations:destinations.data||[],queued:queue.count||0,processor_connected:false});
  }
  if(action==="route_save"){
    const id=body.route_id==null||body.route_id===""?null:Number(body.route_id);
    const label=clean(body.route_label),chat=clean(body.source_chat_id),thread=Number(body.source_thread_id||0),idle=Number(body.idle_seconds||60),reviewer=clean(body.reviewer_telegram_user_id);
    if(id!==null&&!validId(id))return send({error:"Invalid route ID"},400);
    if(!label||label.length>120||!chatOk(chat)||!validThread(thread)||!Number.isSafeInteger(idle)||idle<15||idle>600||!validPrivateUser(reviewer))return send({error:"Source mapping requires a valid private Telegram reviewer User ID (5–20 digits)."},400);
    // Save sources inactive until the separate image processor is installed and tested.
    const payload={route_label:label,source_chat_id:chat,source_thread_id:thread,idle_seconds:idle,reviewer_telegram_user_id:reviewer,active:false,updated_at:new Date().toISOString(),updated_by:user.id};
    const result=id===null
      ?await client.from("bb_invoice_photo_routes").insert(payload).select("route_id")
      :await client.from("bb_invoice_photo_routes").update(payload).eq("route_id",id).select("route_id");
    if(result.error)return send({error:"Unable to save source. Check if this group/topic is already mapped."},409);
    if(!result.data?.length)return send({error:"Source mapping not found"},404);
    return send({ok:true,route_id:result.data[0].route_id,activated:false});
  }
  if(action==="route_delete"){
    const id=Number(body.route_id);
    if(!validId(id))return send({error:"Invalid source mapping"},400);
    const {error}=await client.from("bb_invoice_photo_routes").delete().eq("route_id",id);
    if(error)throw Error("Unable to delete mapping");
    return send({ok:true});
  }
  if(action==="reviewer_test"){
    const id=Number(body.route_id);
    if(!validId(id))return send({error:"Save source and reviewer before testing"},400);
    const {data:route,error}=await client.from("bb_invoice_photo_routes").select("route_label,reviewer_telegram_user_id").eq("route_id",id).maybeSingle();
    if(error||!route)return send({error:"Source mapping not found"},404);
    const reviewer=clean(route.reviewer_telegram_user_id);
    if(!validPrivateUser(reviewer))return send({error:"No private reviewer configured"},400);
    await tg("sendMessage",{chat_id:reviewer,text:"✅ BIG BROTHER — Invoice Photo Organizer\nPrivate correction chat test successful for: "+route.route_label+"\nWhen an invoice is unclear, only this private chat will receive the verification question.\nNo invoice or accounting records were sent."});
    return send({ok:true});
  }
  if(action==="destination_save"){
    const id=body.destination_id==null||body.destination_id===""?null:Number(body.destination_id);
    const route=Number(body.route_id),label=clean(body.destination_label),chat=clean(body.telegram_chat_id),thread=Number(body.telegram_thread_id||0);
    if((id!==null&&!validId(id))||!validId(route)||!label||label.length>120||!chatOk(chat)||!validThread(thread)||(thread>0&&!chat.startsWith("-")))return send({error:"Invalid destination. Private chats require Topic ID 0."},400);
    const {data:parent,error:parentError}=await client.from("bb_invoice_photo_routes").select("route_id").eq("route_id",route).maybeSingle();
    if(parentError||!parent)return send({error:"Source route not found"},404);
    const payload={route_id:route,destination_label:label,telegram_chat_id:chat,telegram_thread_id:thread,active:body.active!==false,updated_at:new Date().toISOString()};
    const result=id===null
     ?await client.from("bb_invoice_photo_destinations").insert(payload).select("destination_id")
     :await client.from("bb_invoice_photo_destinations").update(payload).eq("destination_id",id).eq("route_id",route).select("destination_id");
    if(result.error)return send({error:"Unable to save destination. Check if it is already mapped."},409);
    if(!result.data?.length)return send({error:"Destination not found"},404);
    return send({ok:true,destination_id:result.data[0].destination_id});
  }
  if(action==="destination_delete"){
    const id=Number(body.destination_id);
    if(!validId(id))return send({error:"Invalid destination"},400);
    const {error}=await client.from("bb_invoice_photo_destinations").delete().eq("destination_id",id);
    if(error)throw Error("Unable to delete destination");
    return send({ok:true});
  }
  if(action==="destination_test"){
    const id=Number(body.destination_id);
    if(!validId(id))return send({error:"Invalid destination"},400);
    const {data:r,error}=await client.from("bb_invoice_photo_destinations").select("destination_label,telegram_chat_id,telegram_thread_id").eq("destination_id",id).maybeSingle();
    if(error||!r)return send({error:"Destination not found"},404);
    const target:Record<string,unknown>={chat_id:r.telegram_chat_id,text:"✅ BIG BROTHER — Invoice Photo Organizer\nDestination test successful: "+r.destination_label+"\nNo invoice pictures or accounting data were sent."};
    if(Number(r.telegram_thread_id)>0)target.message_thread_id=r.telegram_thread_id;
    await tg("sendMessage",target);
    return send({ok:true});
  }
  return send({error:"Unknown action"},400);
 }catch(err){
  console.error("Invoice photo routing error",err instanceof Error?err.name:"unknown");
  return send({error:err instanceof Error?err.message:"Request failed"},500);
 }
});