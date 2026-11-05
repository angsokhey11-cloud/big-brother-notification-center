CREATE OR REPLACE FUNCTION public.bb_bank_session_review_now_v1(
 p_session uuid,p_chat text,p_thread bigint,p_user text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_s public.bb_bank_review_sessions%ROWTYPE;
 v_batch uuid;v_n integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Bank review server-only'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.bb_telegram_assistant_admins a WHERE a.telegram_user_id=p_user)
 THEN RAISE EXCEPTION 'Authorized Telegram admin required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('BB_BANK_REVIEW_'||p_user));
 SELECT * INTO v_s FROM public.bb_bank_review_sessions
 WHERE session_id=p_session AND source_chat_id=p_chat AND source_thread_id=p_thread
 FOR UPDATE;
 IF NOT FOUND OR v_s.status NOT IN ('collecting','reviewing')
 THEN RETURN jsonb_build_object('ok',false,'reason','no_active_session'); END IF;
 IF v_s.requested_by_telegram_user_id IS DISTINCT FROM p_user
   AND v_s.reviewer_telegram_user_id IS DISTINCT FROM p_user
 THEN RAISE EXCEPTION 'Only the session requester or assigned reviewer may start review'; END IF;
 SELECT b.batch_id INTO v_batch FROM public.bb_bank_transaction_review_batches b
 WHERE b.review_session_id=p_session LIMIT 1;
 IF v_batch IS NOT NULL THEN
 SELECT count(*) INTO v_n FROM public.bb_bank_new_invoice_review_drafts
 WHERE review_batch_id=v_batch;
 RETURN jsonb_build_object('ok',true,'batch_id',v_batch,'count',v_n,
   'reviewer',v_s.reviewer_telegram_user_id,'existing',true);
 END IF;
 IF v_s.status<>'collecting' OR v_s.expires_at<=now()
 THEN RETURN jsonb_build_object('ok',false,'reason','session_expired'); END IF;
 IF v_s.notice_count=0 THEN RETURN jsonb_build_object('ok',false,'reason','empty'); END IF;
 IF EXISTS(SELECT 1 FROM public.bb_bank_transaction_review_batches b
  WHERE b.reviewer_telegram_user_id=v_s.reviewer_telegram_user_id
    AND b.status IN ('reviewing','processing','partial') AND b.expires_at>now()
    AND b.review_session_id IS NOT NULL
    AND b.review_session_id IS DISTINCT FROM p_session)
 THEN RETURN jsonb_build_object('ok',false,'reason','finish_existing_review_first'); END IF;
 INSERT INTO public.bb_bank_transaction_review_batches(
  reviewer_telegram_user_id,source_chat_id,source_thread_id,review_session_id,
  expires_at
 ) VALUES(
  v_s.reviewer_telegram_user_id,p_chat,p_thread,p_session,now()+interval '24 hours'
 ) RETURNING batch_id INTO v_batch;
 UPDATE public.bb_bank_new_invoice_review_drafts d
 SET review_batch_id=v_batch,status='reviewing',
   reviewer_telegram_user_id=v_s.reviewer_telegram_user_id,
   updated_at=now(),expires_at=greatest(d.expires_at,now()+interval '24 hours')
 WHERE d.review_session_id=p_session AND d.status='candidate' AND d.review_batch_id IS NULL;
 GET DIAGNOSTICS v_n=ROW_COUNT;
 IF v_n<>v_s.notice_count THEN
   RAISE EXCEPTION 'Bank review session count changed; please check notice staging';
 END IF;
 UPDATE public.bb_bank_review_sessions
 SET status='reviewing',updated_at=now(),expires_at=now()+interval '24 hours'
 WHERE session_id=p_session;
 RETURN jsonb_build_object('ok',true,'batch_id',v_batch,'count',v_n,
  'reviewer',v_s.reviewer_telegram_user_id,'existing',false);
END $fn$;

