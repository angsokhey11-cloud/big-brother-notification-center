// BIG BROTHER Staff Assistant V3: ephemeral customer receivable summary pictures.
// Generates Telegram-ready PNGs in memory. No DB storage, message archive, or external image-rendering API.
import React from "npm:react@18.3.1";
import { ImageResponse } from "npm:@vercel/og@0.6.2";
type Invoice={invoice_id:string;invoice_no:string;invoice_date:string;due_date?:string|null;grand_total:number;amount_paid:number;outstanding:number;currency:string};
type Customer={customer_name:string;phone?:string|null;address?:string|null};
const n=(x:unknown)=>Number(x||0);
const str=(x:unknown)=>String(x??"").trim();
const money=(x:unknown,c:unknown)=>str(c).toUpperCase()==="KHR"?"៛"+n(x).toLocaleString("en-US",{maximumFractionDigits:0}):"$"+n(x).toFixed(2);
const date=(x:unknown)=>{const a=str(x).slice(0,10).split("-");return a.length===3?a[2]+"-"+(["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(a[1])-1]||a[1])+"-"+a[0]:"—"};
const h=React.createElement;
const flex=(style:any,...children:any[])=>h("div",{style:{display:"flex",...style}},...children);
const col="#173e73",muted="#607189";
let fontCache:Promise<ArrayBuffer|null>|undefined;
async function getFont(){
 if(!fontCache)fontCache=(async()=>{try{
  // Public static font asset; NO customer data in this font request.
  const r=await fetch("https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskhmer/NotoSansKhmer%5Bwdth%2Cwght%5D.ttf",{signal:AbortSignal.timeout(9000)});
  if(r.ok)return await r.arrayBuffer();
 }catch(_){}return null;})();
 return fontCache;
}
export function outstandingTotals(rows:Invoice[]){
 const by:Record<string,number>={};
 for(const row of rows){const c=str(row.currency)||"USD";by[c]=(by[c]||0)+n(row.outstanding);}
 return Object.entries(by).map(([c,value])=>money(value,c)).join(" / ")||"$0.00";
}
async function renderPage(c:Customer,location:string,rows:Invoice[],page:number,pages:number,count:number,total:string):Promise<Uint8Array>{
 const face=await getFont(),family=face?"Khmer":"sans-serif";
 const widths=[37,110,130,130,160,145,170];
 const cell=(value:string,width:number,bold=false,end=false)=>flex({width,flexShrink:0,padding:"0 6px",justifyContent:end?"flex-end":"flex-start",alignItems:"center",overflow:"hidden",fontWeight:bold?700:400,fontSize:15,color:bold?col:"#324d65"},value);
 const th=["#","Invoice No","Date","Due Date","Grand Total","Paid","Outstanding"];
 const headRow=flex({backgroundColor:col,height:48,alignItems:"center",borderRadius:6,width:"100%"},
  ...th.map((v,i)=>flex({width:widths[i],flexShrink:0,padding:"0 6px",justifyContent:i>3?"flex-end":"flex-start",fontSize:14,fontWeight:700,color:"#fff"},v)));
 const table=rows.map((r,i)=>flex({height:48,alignItems:"center",backgroundColor:i%2===0?"#f3f7fc":"#ffffff",borderBottom:"1px solid #dfe8f1"},
  cell(String(page*15+i+1),widths[0]),cell(str(r.invoice_no),widths[1],true),cell(date(r.invoice_date),widths[2]),
  cell(r.due_date?date(r.due_date):"—",widths[3]),cell(money(r.grand_total,r.currency),widths[4],false,true),
  cell(money(r.amount_paid,r.currency),widths[5],false,true),cell(money(r.outstanding,r.currency),widths[6],true,true)));
 const title=flex({width:"100%",justifyContent:"space-between",paddingBottom:18,borderBottom:"3px solid #3674b5"},
  flex({flexDirection:"column"},h("div",{style:{color:col,fontSize:37,fontWeight:800}},"BIG BROTHER"),
   h("div",{style:{fontSize:15,color:muted}},"Ready to be your partner"),
   h("div",{style:{marginTop:10,fontSize:14,color:muted}},"Phnom Penh, Cambodia")),
  flex({flexDirection:"column",alignItems:"flex-end",fontSize:15,color:muted},
   h("div",null,"Summary Date: "+new Date().toLocaleDateString("en-GB",{timeZone:"Asia/Phnom_Penh",day:"2-digit",month:"short",year:"numeric"}).replace(/ /g,"-")),
   h("div",null,"Open Invoices: "+count),h("div",null,"Page "+(page+1)+" / "+pages)));
 const custBox=(caption:string,main:string,other:string,size=22)=>flex({width:"50%",flexDirection:"column",padding:18,backgroundColor:"#eef5fc",borderRadius:8},
  h("div",{style:{color:muted,fontSize:14}},caption),h("div",{style:{color:col,fontSize:size,fontWeight:700,marginTop:7}},main),
  h("div",{style:{color:muted,fontSize:15,marginTop:7}},other));
 const canvas=flex({flexDirection:"column",width:1000,height:1414,padding:"55px 48px",backgroundColor:"#ffffff",fontFamily:family,color:col},
  title,
  flex({width:"100%",justifyContent:"center",padding:"26px 0"},h("div",{style:{fontSize:26,fontWeight:800}},"CUSTOMER INVOICE SUMMARY")),
  flex({width:"100%",gap:14,marginBottom:24},
   custBox("Customer",str(c.customer_name),location),
   custBox("Customer Contact",str(c.phone)||"—",str(c.address)||"—",17)),
  headRow,...table,
  flex({marginTop:"auto",flexDirection:"column",width:"100%"},
   flex({alignItems:"center",justifyContent:"space-between",width:"100%",minHeight:72,padding:"15px 20px",backgroundColor:"#eaf3ff",borderRadius:6},
    h("div",{style:{color:col,fontSize:18,fontWeight:800}},"TOTAL OUTSTANDING"),
    h("div",{style:{color:col,fontSize:23,fontWeight:800}},total)),
   flex({justifyContent:"space-between",width:"100%",borderTop:"1px solid #dae3ed",paddingTop:16,marginTop:24,fontSize:13,color:muted},
    h("div",null,"Summary of current open customer receivables."),h("div",null,"BIG BROTHER"))));
 const options:any={width:1000,height:1414};
 if(face)options.fonts=[{name:"Khmer",data:face,weight:400,style:"normal"}];
 const response=new ImageResponse(canvas as any,options);
 if(!response.ok)throw Error("Summary PNG renderer returned an error");
 return new Uint8Array(await response.arrayBuffer());
}
export async function renderReceivableSummary(c:Customer,location:string,rows:Invoice[]){
 const total=outstandingTotals(rows),pages=Math.max(1,Math.ceil(rows.length/15)),images:Uint8Array[]=[];
 for(let p=0;p<pages;p++)images.push(await renderPage(c,location,rows.slice(p*15,(p+1)*15),p,pages,rows.length,total));
 return {images,total};
}
export type ImageItem={png?:Uint8Array;url?:string;caption?:string};
export async function deliverPhotos(chat:string,token:string,items:ImageItem[]){
 const api="https://api.telegram.org/bot"+token+"/";
 async function send(method:string,body:any,multipart=false){
  const r=await fetch(api+method,{method:"POST",...(multipart?{body}:{headers:{"content-type":"application/json"},body:JSON.stringify(body)})});
  const d=await r.json().catch(()=>({ok:false,description:"Telegram API error"}));
  if(!r.ok||d.ok!==true)throw Error("Telegram "+method+": "+str(d.description).slice(0,110));
 }
 for(let start=0;start<items.length;start+=10){
  const chunk=items.slice(start,start+10);
  if(chunk.length===1){
   const x=chunk[0];
   if(x.url){await send("sendPhoto",{chat_id:chat,photo:x.url,caption:x.caption||undefined});continue;}
   const form=new FormData();form.append("chat_id",chat);
   form.append("photo",new Blob([x.png!],{type:"image/png"}),"customer-summary.png");
   if(x.caption)form.append("caption",x.caption);
   await send("sendPhoto",form,true);
   continue;
  }
  const group=chunk.map((x,i)=>({type:"photo",media:x.png?"attach://image"+i:x.url, ...(x.caption?{caption:x.caption}:{})}));
  const form=new FormData();form.append("chat_id",chat);form.append("media",JSON.stringify(group));
  chunk.forEach((x,i)=>{if(x.png)form.append("image"+i,new Blob([x.png],{type:"image/png"}),"summary-"+(start+i+1)+".png")});
  await send("sendMediaGroup",form,true);
 }
}
