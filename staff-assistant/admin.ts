// Staff Assistant V3 Admin-only verified private Telegram identity management.
// Does not store chat messages, message history, photos or screenshots.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2";
const env=(k:string)=>Deno.env.get(k)||"";
const clean=(x:unknown)=>String(x??"").trim();
const headers={"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":"https://angsokhey11-cloud.github.io","access-control-allow-headers":"authorization,apikey,content-type,x-client-info","access-control-allow-methods":"POST,OPTIONS"};
const send=(b:any,status=200)=>Response.json(b,{status,headers});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return send({error:"POST required"},405);
 try{
  const url=env("SUPABASE_URL"),anon=env("SUPABASE_ANON_KEY"),service=env("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader=req.headers.get("authorization")||"";
  const userClient=createClient(url,anon,{global:{headers:{Authorization:authHeader}},auth:{persistSession:false}});
  const {data:auth,error:userError}=await userClient.auth.getUser(authHeader.replace(/^Bearer\s+/i,""));
  if(userError||!auth?.user)return send({error:"BIG BROTHER login required"},401);
  const {data:access,error:accessError}=await userClient.rpc("bb_current_access_profile");
  if(accessError||access?.user?.isAdmin!==true)return send({error:"Admin only"},403);
  const db=createClient(url,service,{auth:{persistSession:false}});
  const body=await req.json();const action=clean(body.action);
  if(action==="list"){
   const [ac,staff]=await Promise.all([db.from("bb_staff_assistant_accounts").select("telegram_user_id,staff_id,language,language_confirmed,active,verified_at,updated_at").order("updated_at",{ascending:false}),db.from("staff").select("staff_id,staff_name,status").order("staff_name")]);
   if(ac.error||staff.error)throw Error("Unable to load staff mappings");
   return send({ok:true,mappings:ac.data||[],staff:(staff.data||[]).filter((x:any)=>clean(x.status).toLowerCase()==="active")});
  }
  if(action==="save"){
   const telegram=clean(body.telegram_user_id),staffId=clean(body.staff_id);
   if(!/^[0-9]{5,20}$/.test(telegram)||!staffId||staffId.length>80)return send({error:"Valid private Telegram User ID and Staff ID required"},400);
   const {data:staff}=await db.from("staff").select("staff_id,status").eq("staff_id",staffId).maybeSingle();
   if(!staff||clean(staff.status).toLowerCase()!=="active")return send({error:"Active staff not found"},400);
   const {data:duplicate}=await db.from("bb_staff_assistant_accounts").select("telegram_user_id").eq("staff_id",staffId).eq("active",true).neq("telegram_user_id",telegram).limit(1);
   if(duplicate?.length)return send({error:"This staff account already has a verified private Telegram mapping. Disable it first."},409);
   const r=await fetch("https://api.telegram.org/bot"+env("TELEGRAM_BOT_TOKEN")+"/getChat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:telegram})});
   const json=await r.json().catch(()=>({ok:false}));
   if(!r.ok||!json.ok||json.result?.type!=="private"||clean(json.result.id)!==telegram)return send({error:"Telegram ID could not be verified as an existing private chat. The staff member must open the bot and send /start first."},400);
   const {data:existing}=await db.from("bb_staff_assistant_accounts").select("staff_id,language,language_confirmed").eq("telegram_user_id",telegram).maybeSingle();
   if(existing&&existing.staff_id!==staffId)return send({error:"This Telegram account is already linked to another staff member. Revoke it first."},409);
   const record={telegram_user_id:telegram,staff_id:staffId,language:existing?.language||"km",language_confirmed:existing?.language_confirmed||false,active:true,verified_by:auth.user.id,verified_at:new Date().toISOString(),updated_at:new Date().toISOString()};
   const {error}=await db.from("bb_staff_assistant_accounts").upsert(record,{onConflict:"telegram_user_id"});
   if(error)throw error;
   return send({ok:true,message:"Private Staff Assistant mapping verified"});
  }
  if(action==="revoke"){
   const telegram=clean(body.telegram_user_id);
   if(!/^[0-9]{5,20}$/.test(telegram))return send({error:"Invalid Telegram User ID"},400);
   const {error}=await db.from("bb_staff_assistant_accounts").update({active:false,updated_at:new Date().toISOString()}).eq("telegram_user_id",telegram);
   if(error)throw error;
   await db.from("bb_staff_assistant_sessions").delete().eq("telegram_user_id",telegram);
   return send({ok:true,message:"Private access revoked"});
  }
  return send({error:"Unknown action"},400);
 }catch(e){console.error("Staff Assistant admin failed:",e instanceof Error?e.name:"error");return send({error:"Staff Assistant admin operation failed"},500);}
});
