-- BIG BROTHER Bank Assistant: safe scheduled retention, 05-Nov-2026.
-- 03:00 Asia/Phnom_Penh daily = 20:00 UTC (server cron.timezone=GMT).
-- Protect ALL in-progress reviews, and NEVER DELETE bank balances, payments, A/R or audits.
-- Preview with SELECT public.bb_bank_review_safe_cleanup_v1(false);
-- Cron invokes SELECT public.bb_bank_review_safe_cleanup_v1(true);

CREATE OR REPLACE FUNCTION public.bb_bank_review_safe_cleanup_v1(p_execute boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
 v_cutoff timestamptz := now() - interval '48 hours';
 v_queue_cutoff timestamptz := now() - interval '7 days';
 v_terminal_drafts integer := 0;
 v_orphan_candidates integer := 0;
 v_terminal_batches integer := 0;
 v_expired_collections integer := 0;
 v_expired_review_sessions integer := 0;
 v_collection_drafts integer := 0;
 v_stale_queue integer := 0;
 v_n integer;
BEGIN
 -- Runs only as database owner through pg_cron, never the web app or Telegram user.
 IF current_user <> 'postgres' THEN
   RAISE EXCEPTION 'Bank retention is restricted to the database scheduler';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtext('BB_BANK_REVIEW_SAFE_RETENTION_V1'));

 -- Delete old FINISHED draft records only when no live batch uses them.
 -- A registered draft is eligible only if its reference is in the real Bank Register.
 -- This removes *only* temporary draft rows, never the accounting record.
 SELECT count(*) INTO v_terminal_drafts
 FROM public.bb_bank_new_invoice_review_drafts d
 WHERE d.status IN ('registered','discarded')
   AND d.updated_at < v_cutoff
   AND (d.review_batch_id IS NULL
     OR EXISTS (
       SELECT 1 FROM public.bb_bank_transaction_review_batches b
       WHERE b.batch_id=d.review_batch_id AND b.status IN ('completed','cancelled')
     ))
   AND (
     (d.status='discarded' AND d.registered_transaction_id IS NULL)
     OR (d.status='registered' AND d.registered_transaction_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.bb_verified_bank_transactions r
         WHERE upper(btrim(r.transaction_id))=upper(btrim(d.registered_transaction_id))
       ))
   );

 -- Unassigned candidates already expired for 48h; no selected customer or review batch.
 SELECT count(*) INTO v_orphan_candidates
 FROM public.bb_bank_new_invoice_review_drafts d
 WHERE d.status='candidate' AND d.review_batch_id IS NULL
   AND d.review_session_id IS NULL AND d.expires_at < v_cutoff;

 -- A completed/cancelled review batch may be removed only when its draft rows are gone.
 SELECT count(*) INTO v_terminal_batches
 FROM public.bb_bank_transaction_review_batches b
 WHERE b.status IN ('completed','cancelled') AND b.updated_at < v_cutoff
 AND NOT EXISTS (
   SELECT 1 FROM public.bb_bank_new_invoice_review_drafts d
   WHERE d.review_batch_id=b.batch_id
     AND NOT (
       d.status='discarded' AND d.registered_transaction_id IS NULL AND d.updated_at < v_cutoff
       OR d.status='registered' AND d.registered_transaction_id IS NOT NULL
          AND d.updated_at<v_cutoff AND EXISTS (
            SELECT 1 FROM public.bb_verified_bank_transactions r
            WHERE upper(btrim(r.transaction_id))=upper(btrim(d.registered_transaction_id))
          )
     )
 );

 -- Expired collections can be discarded 48h after expiry, but ONLY when nobody
 -- has advanced them to a registered/under-review transaction.
 SELECT count(*) INTO v_expired_collections
 FROM public.bb_bank_review_sessions s
 WHERE s.status='collecting' AND s.expires_at < v_cutoff
 AND NOT EXISTS(
   SELECT 1 FROM public.bb_bank_transaction_review_batches b
   WHERE b.review_session_id=s.session_id
 )
 AND NOT EXISTS(
   SELECT 1 FROM public.bb_bank_new_invoice_review_drafts d
   WHERE d.review_session_id=s.session_id
     AND d.status NOT IN ('candidate','discarded')
 );

 SELECT count(*) INTO v_collection_drafts
 FROM public.bb_bank_new_invoice_review_drafts d
 JOIN public.bb_bank_review_sessions s ON s.session_id=d.review_session_id
 WHERE s.status='collecting' AND s.expires_at < v_cutoff
   AND NOT EXISTS(
     SELECT 1 FROM public.bb_bank_transaction_review_batches b
     WHERE b.review_session_id=s.session_id
   )
   AND NOT EXISTS(
     SELECT 1 FROM public.bb_bank_new_invoice_review_drafts x
     WHERE x.review_session_id=s.session_id
       AND x.status NOT IN ('candidate','discarded')
   );

 -- Never silently delete a reviewing/processing batch.
 -- An expired session can go only when it has NO linked review or drafts left.
 SELECT count(*) INTO v_expired_review_sessions
 FROM public.bb_bank_review_sessions s
 WHERE s.status='reviewing' AND s.expires_at < v_cutoff
 AND NOT EXISTS(
   SELECT 1 FROM public.bb_bank_transaction_review_batches b
   WHERE b.review_session_id=s.session_id
 )
 AND NOT EXISTS(
   SELECT 1 FROM public.bb_bank_new_invoice_review_drafts d
   WHERE d.review_session_id=s.session_id
 );

 -- The old FIFO queue is no longer used for the explicit-session review path.
 -- Keep a separate seven-day safeguard against retaining abandoned raw messages.
 SELECT count(*) INTO v_stale_queue FROM public.bb_bank_assistant_queue q
 WHERE q.received_at < v_queue_cutoff;

 IF NOT p_execute THEN
   RETURN jsonb_build_object(
     'mode','preview','cutoff_hours',48,'queue_cutoff_days',7,
     'eligible_terminal_drafts',v_terminal_drafts,
     'eligible_expired_candidates',v_orphan_candidates,
     'eligible_terminal_batches_after_draft_cleanup',v_terminal_batches,
     'eligible_expired_collections',v_expired_collections,
     'eligible_expired_collection_drafts',v_collection_drafts,
     'eligible_empty_review_sessions',v_expired_review_sessions,
     'eligible_stale_queue',v_stale_queue
   );
 END IF;

 DELETE FROM public.bb_bank_new_invoice_review_drafts d
 WHERE d.status IN ('registered','discarded')
   AND d.updated_at<v_cutoff
   AND (d.review_batch_id IS NULL OR EXISTS(
     SELECT 1 FROM public.bb_bank_transaction_review_batches b
     WHERE b.batch_id=d.review_batch_id AND b.status IN('completed','cancelled')
   ))
   AND (
     (d.status='discarded' AND d.registered_transaction_id IS NULL)
     OR (d.status='registered' AND d.registered_transaction_id IS NOT NULL
       AND EXISTS(
         SELECT 1 FROM public.bb_verified_bank_transactions r
         WHERE upper(btrim(r.transaction_id))=upper(btrim(d.registered_transaction_id))
       ))
   );
 GET DIAGNOSTICS v_terminal_drafts=ROW_COUNT;

 DELETE FROM public.bb_bank_new_invoice_review_drafts d
 WHERE d.status='candidate' AND d.review_batch_id IS NULL
  AND d.review_session_id IS NULL AND d.expires_at < v_cutoff;
 GET DIAGNOSTICS v_orphan_candidates=ROW_COUNT;

 DELETE FROM public.bb_bank_transaction_review_batches b
 WHERE b.status IN ('completed','cancelled') AND b.updated_at < v_cutoff
 AND NOT EXISTS(
   SELECT 1 FROM public.bb_bank_new_invoice_review_drafts d
   WHERE d.review_batch_id=b.batch_id
 );
 GET DIAGNOSTICS v_terminal_batches=ROW_COUNT;

 -- ON DELETE CASCADE removes *only* candidate/discarded notices for the expired
 -- collecting session. Registered/under-review notices block this removal.
 DELETE FROM public.bb_bank_review_sessions s
 WHERE s.status='collecting' AND s.expires_at < v_cutoff
 AND NOT EXISTS(
   SELECT 1 FROM public.bb_bank_transaction_review_batches b
   WHERE b.review_session_id=s.session_id
 )
 AND NOT EXISTS(
   SELECT 1 FROM public.bb_bank_new_invoice_review_drafts d
   WHERE d.review_session_id=s.session_id
     AND d.status NOT IN('candidate','discarded')
 );
 GET DIAGNOSTICS v_expired_collections=ROW_COUNT;

 DELETE FROM public.bb_bank_review_sessions s
 WHERE s.status='reviewing' AND s.expires_at < v_cutoff
 AND NOT EXISTS(
   SELECT 1 FROM public.bb_bank_transaction_review_batches b
   WHERE b.review_session_id=s.session_id
 )
 AND NOT EXISTS(
   SELECT 1 FROM public.bb_bank_new_invoice_review_drafts d
   WHERE d.review_session_id=s.session_id
 );
 GET DIAGNOSTICS v_expired_review_sessions=ROW_COUNT;

 DELETE FROM public.bb_bank_assistant_queue q WHERE q.received_at < v_queue_cutoff;
 GET DIAGNOSTICS v_stale_queue=ROW_COUNT;

 RETURN jsonb_build_object(
   'mode','cleanup','cutoff_hours',48,'queue_cutoff_days',7,
   'deleted_terminal_drafts',v_terminal_drafts,
   'deleted_expired_candidates',v_orphan_candidates,
   'deleted_terminal_batches',v_terminal_batches,
   'deleted_expired_collections',v_expired_collections,
   'deleted_collection_drafts_via_cascade',v_collection_drafts,
   'deleted_empty_review_sessions',v_expired_review_sessions,
   'deleted_stale_queue',v_stale_queue,
   'permanent_accounting_records_changed',false
 );
END;
$fn$;

REVOKE ALL ON FUNCTION public.bb_bank_review_safe_cleanup_v1(boolean)
 FROM PUBLIC,anon,authenticated,service_role;

-- Replace the two old unsafe TTL jobs that deleted by expiry alone.
-- These unschedules are idempotent if an earlier migration already removed them.
SELECT cron.unschedule(j.jobid)
FROM cron.job j
WHERE j.jobname IN (
  'bb_bank_new_invoice_review_ttl',
  'bb_bank_transaction_review_batch_ttl'
);

-- Cron is configured for GMT in this Supabase project.
-- 20:00 UTC = 03:00 the following morning in Cambodia.
SELECT cron.schedule(
 'bb-bank-review-safe-retention-daily-3am-kh',
 '0 20 * * *',
 'select public.bb_bank_review_safe_cleanup_v1(true);'
);
