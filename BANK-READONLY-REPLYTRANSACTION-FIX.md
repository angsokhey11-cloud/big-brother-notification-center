# Bank Assistant — read-only /replytransaction latest notice

## Fix
- Previously only Telegram reply_to_message.text/caption was accepted. A standalone /replytransaction or incomplete Telegram quote produced an unreadable text error.
- Now admin may forward or paste a bank text notification in a mapped Bank Assistant topic and send /replytransaction within 20 minutes.
- Exact Telegram replies still take priority. If quoted text is missing, the latest validated text notice from that admin/topic is used.
- One structured JSON notice per admin/topic; no raw Telegram payloads stored. Newer message IDs cannot be overwritten by out-of-order forwards.
- Table is RLS-protected, service-role-only and expires after 20 minutes. Native pg_cron deletes expired rows at 3 AM Cambodia daily.
- Read-only command never inserts into the bank review queue, temporary review drafts, Bank Register or payments. Existing /starttransactionsreview and /reviewtransaction stay unchanged.
- Photos without captions remain unsupported; this feature does not add OCR.

## Verification
- Actual ABA PayWay screenshot parsed: sender CHEA KIMLANG, USD 52.80, reference 179394513723930, date 2026-11-06.
- Existing ACLEDA Khmer parser recognized KHR transfer and sender.
- Rolled-back PostgreSQL test verified ordering, twenty-minute expiration and no queue/draft records.
- On live Telegram, forward/paste the notice again after deploying (old uncached text is not recoverable), then use /replytransaction@bb_ntcbot without selecting Reply.