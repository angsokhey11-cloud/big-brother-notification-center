import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.49.10";
const db=()=>createClient(Deno.env.get("SUPABASE_URL")||"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",{auth:{persistSession:false}});
const clean=(s:unknown)=>String(s??"").trim();
async function tg(method:string,body:unknown){
 const r=await fetch("https://api.telegram.org/bot"+Deno.env.get("TELEGRAM_BOT_TOKEN")+"/"+method,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 const j=await r.json().catch(()=>null);
 if(!r.ok||j?.ok!==true)throw Error("Telegram API error: "+clean(j?.description).slice(0,120));
 return j.result;
}
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return Response.json({error:"POST required"},{status:405});
 const client=db();
 const {data:cfg,error:e}=await client.from("bb_telegram_inbound_config").select("secret").eq("config_key","telegram_main").maybeSingle();
 if(e||!cfg||!cfg.secret||clean(req.headers.get("X-Telegram-Bot-Api-Secret-Token"))!==cfg.secret)
  return Response.json({error:"Unauthorized"},{status:401});
 try{
   const {error:closeError}=await client.rpc("bb_invoice_photo_auto_close");
   if(closeError)throw closeError;
   const {data:rows,error:fetchError}=await client.from("bb_invoice_photo_review_batches")
      .select("batch_id,reviewer_telegram_user_id").eq("status","awaiting_review")
      .is("review_notice_sent_at",null).gt("expires_at",new Date().toISOString()).order("created_at").limit(15);
   if(fetchError)throw fetchError;
   let sent=0,failed=0;
   for(const b of rows||[]){
     // Conditional notice-claim prevents duplicated reminders when cron overlaps.
     const {data:claimed,error:claimError}=await client.from("bb_invoice_photo_review_batches")
       .update({review_notice_sent_at:new Date().toISOString()}).eq("batch_id",b.batch_id)
       .eq("status","awaiting_review").is("review_notice_sent_at",null).select("batch_id");
     if(claimError)throw claimError;
     if(!claimed?.length)continue;
     const {count}=await client.from("bb_invoice_photo_queue").select("queue_id",{head:true,count:"exact"}).eq("review_batch_id",b.batch_id);
     try{
       await tg("sendMessage",{
         chat_id:b.reviewer_telegram_user_id,
         text:"📸 BIG BROTHER — Invoice Photo Review\n\n"+Number(count||0)+" forwarded pictures are ready. Open the review screen, confirm each invoice number and date, then approve sending.\n\nNothing has been posted to the group yet.",
         reply_markup:{inline_keyboard:[[{text:"📋 Review Pictures",web_app:{url:"https://angsokhey11-cloud.github.io/big-brother-notification-center/invoice-photo-review.html"}}]]}
       });
       sent++;
     }catch(err){
       failed++;
       await client.from("bb_invoice_photo_review_batches").update({review_notice_sent_at:null})
         .eq("batch_id",b.batch_id).eq("status","awaiting_review");
       console.error("Review notice delivery failed",err instanceof Error?err.message:"unknown");
     }
   }
   return Response.json({ok:true,sent,failed});
 }catch(err){console.error("Invoice photo idle finalizer failed",err instanceof Error?err.message:"unknown");return Response.json({ok:false},{status:500});}
});