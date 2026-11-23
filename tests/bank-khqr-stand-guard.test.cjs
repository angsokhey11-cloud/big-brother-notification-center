// Regression: merchant QR stand remains constant; transaction hash changes.
const assert=require("node:assert/strict"),fs=require("node:fs");
const src=fs.readFileSync("bank-assistant/index.ts","utf8");
const helper=src.slice(src.indexOf("function safeNoticeReference("),src.indexOf("// Bank-independent Khmer KHQR credit notification"));
const parser=src.slice(src.indexOf("function parseKhmerKhqrNotice("),src.indexOf("// ACLEDA incoming Khmer notice"));
const js=(helper+parser).replaceAll("raw:string","raw").replaceAll("candidate:string","candidate").replaceAll("const months:Record<string,number>","const months");
const {safeNoticeReference,parseKhmerKhqrNotice}=new Function('const val=x=>String(x??"").trim();'+js+';return {safeNoticeReference,parseKhmerKhqrNotice}')();
const base="លោកអ្នកបានទទួលប្រាក់ចំនួន 37.00 ដុល្លារ  ពីឈ្មោះ WATHANA SOEURM ធនាគារ ABA Bank តាមការស្កេន  KHQR ថ្ងៃទី ១២ វិច្ឆិកា ២០២៦​ ម៉ោង ០៩:២១ព្រឹក នៅ Big Brother 5 , STAND:0001037221";
const first=parseKhmerKhqrNotice(base+" (Hash. 3d36ad9f).");
assert.equal(first.transactionId,"3D36AD9F");assert.equal(first.stand,"0001037221");
assert.equal(first.sender,"WATHANA SOEURM");assert.equal(first.amount,37);assert.equal(first.currency,"USD");assert.equal(first.receivedDate,"2026-11-12");
const second=parseKhmerKhqrNotice(base.replace("37.00","22.00")+" (Hash. 8aca991f).");
assert.equal(second.stand,first.stand);assert.equal(second.transactionId,"8ACA991F");
assert.notEqual(first.transactionId,second.transactionId);
const missing=parseKhmerKhqrNotice(base+".");assert.equal(missing.transactionId,"");assert.equal(missing.stand,"0001037221");
assert.equal(safeNoticeReference(base,"0001037221"),"");
assert.equal(safeNoticeReference(base,"3d36ad9f"),"3D36AD9F");
assert(src.includes('transaction_id:safeId'));
for(const [file,needle] of [["bank-transaction-bulk-review.html","STAND is merchant ID — enter the KHQR Hash instead"],["bank-transaction-batch-review.html","STAND identifies the merchant QR stand, not the payment"],["bank-new-invoice-review.html","STAND is the merchant QR stand, not the transaction"]])
 assert(fs.readFileSync(file,"utf8").includes(needle),file);
console.log("PASS KHQR Hash used, STAND excluded, different payments with same STAND stay distinct");
