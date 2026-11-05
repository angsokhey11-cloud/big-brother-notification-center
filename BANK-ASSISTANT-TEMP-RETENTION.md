# BIG BROTHER — Bank Assistant Temporary Data Retention

**Cloud Supabase DEV** · Scheduled database cleanup · Effective 05-Nov-2026

## Schedule

- Supabase `pg_cron` job: `bb-bank-review-safe-retention-daily-3am-kh`
- Schedule: `0 20 * * *` (database cron timezone **GMT/UTC**)
- Cambodia local time: **03:00 AM daily** (UTC+07:00).
- SQL: `select public.bb_bank_review_safe_cleanup_v1(true);`
- No Telegram polling or Edge Function HTTP requests; work runs entirely in PostgreSQL.
- Idempotent scheduled job by name. Can preview eligible records safely by:
  ```sql
  select public.bb_bank_review_safe_cleanup_v1(false);
  ```
- The dry-run is read-only. Real purging runs only in the nightly schedule or when a database administrator explicitly passes `true`.

## Protection rules

| Temporary table / record | Safe cleanup eligibility |
|---|---|
| Legacy/scoped review draft marked **discarded** | After 48 hours, only if not linked to an open review and no registered reference |
| Review draft marked **registered** | After 48 hours, only when its registered transaction ID is verified in permanent Bank Register and no open batch references it |
| Orphan unreviewed candidate | 48 hours **after its expiry**, with no session and no review batch |
| Terminal review batch (completed/cancelled) | After 48 hours, **only when no draft records remain** |
| Abandoned **collecting** session | 48 hours after expiry, only if no active review batch and no reviewing/registered entries; its candidate drafts are removed by FK cascade |
| Empty, expired **reviewing** session | After 48 hours beyond expiry, **only if no linked drafts or batches remain** |
| Obsolete FIFO raw bank notices | After 7 days |
| Review still `reviewing`, `processing`, or `partial` | **Never removed automatically**, even if expired |
| Real Bank Register, customer balance, payments, A/R, invoices, audit history, payer directory | **Never touched by this cleanup** |

Existing completed explicit-session reviews already clean their own notices immediately after a verified terminal state; this daily schedule is a fallback and cleans old *legacy* review history.

## Old jobs replaced

The earlier jobs
- `bb_bank_new_invoice_review_ttl` (every 15 minutes; erased drafts simply after expiry)
- `bb_bank_transaction_review_batch_ttl` (every 6 hours; erased review batches simply after expiry)

were unscheduled because they could erase pending approval context. The new daily job is guarded by **status** as well as **age**. The old inactive FIFO recovery job remains disabled.

## Deployment and verification

- Migration: `bank-assistant/sql/20261105_safe_bank_review_retention_cron_v1.sql`
- Installed extension: `pg_cron` 1.6.4.
- Job created active with database owner role `postgres`. Anonymous, authenticated and service-role API users cannot invoke the cleanup function.
- Verified preview of real database: **zero eligible** records on deployment date; nine terminal legacy drafts and one cancelled legacy batch are newer than 48 hours and remain for now.
- Verified transaction-rolled-back simulation with: aged terminal discarded + registered drafts, cancelled batch, expired collecting session with candidate notice, expired orphan candidate, and an old **reviewing** batch/draft. The completed/abandoned data was deleted, unfinished review remained, and Bank Register count was unchanged.
- PostgreSQL VACUUM/autovacuum recycles physical page space over time; deleting rows does not necessarily shrink data files immediately. Only live rows and related indexes are cleaned by this job.
- Current Bank Register contained 214 records when scheduling was activated; **none were modified by testing**.

## Monitoring SQL

```sql
select jobid,jobname,schedule,active,username
from cron.job
where jobname='bb-bank-review-safe-retention-daily-3am-kh';

select j.jobname,r.start_time,r.end_time,r.status,r.return_message
from cron.job_run_details r
join cron.job j on j.jobid=r.jobid
where j.jobname='bb-bank-review-safe-retention-daily-3am-kh'
order by r.start_time desc
limit 10;

select public.bb_bank_review_safe_cleanup_v1(false);
```

**Do not manually empty these tables.** Always verify statuses and permanent Bank Register references before removing terminal drafts. In-progress approvals are intentionally held for admin action rather than auto-deleted.
