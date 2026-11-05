-- BIG BROTHER: explicit, ephemeral Bank Assistant review sessions.
-- No automatic bank registration. Read-only collection and authorized manual review.
CREATE TABLE IF NOT EXISTS public.bb_bank_review_sessions (
 session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_chat_id text NOT NULL,
 source_thread_id bigint NOT NULL DEFAULT 0,
 requested_by_telegram_user_id text NOT NULL,
 reviewer_telegram_user_id text NOT NULL,
 status text NOT NULL DEFAULT 'collecting' CHECK(status IN ('collecting','reviewing')),
 prompt_message_id bigint,
 notice_count integer NOT NULL DEFAULT 0 CHECK(notice_count BETWEEN 0 AND 100),
 total_usd numeric NOT NULL DEFAULT 0,
 total_khr numeric NOT NULL DEFAULT 0,
 started_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);
CREATE UNIQUE INDEX IF NOT EXISTS bb_bank_one_collecting_session_per_topic
 ON public.bb_bank_review_sessions(source_chat_id,source_thread_id)
 WHERE status='collecting';
ALTER TABLE public.bb_bank_review_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bb_bank_review_sessions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.bb_bank_review_sessions TO service_role;

ALTER TABLE public.bb_bank_new_invoice_review_drafts
 ADD COLUMN IF NOT EXISTS review_session_id uuid
 REFERENCES public.bb_bank_review_sessions(session_id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS bb_bank_review_drafts_session
 ON public.bb_bank_new_invoice_review_drafts(review_session_id)
 WHERE review_session_id IS NOT NULL;

ALTER TABLE public.bb_bank_transaction_review_batches
 ADD COLUMN IF NOT EXISTS review_session_id uuid
 REFERENCES public.bb_bank_review_sessions(session_id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bb_bank_review_unique_session_batch
 ON public.bb_bank_transaction_review_batches(review_session_id)
 WHERE review_session_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.bb_bank_session_begin_v1(
 p_chat text,p_thread bigint,p_user text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_s public.bb_bank_review_sessions%ROWTYPE;
 v_reviewer text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Bank session server-only'; END IF;
 IF p_chat IS NULL OR p_user !~ '^[0-9]{5,20}$' OR p_thread IS NULL OR p_thread<0
 OR NOT EXISTS(SELECT 1 FROM public.bb_telegram_assistant_admins a WHERE a.telegram_user_id=p_user)
 THEN RAISE EXCEPTION 'Authorized Telegram admin required to start session'; END IF;
 SELECT r.reviewer_telegram_user_id INTO v_reviewer
 FROM public.bb_bank_review_personal_routes r
 WHERE r.source_chat_id=p_chat AND r.source_thread_id=p_thread AND r.active=true;
 IF v_reviewer IS NULL THEN RAISE EXCEPTION 'Bank topic has no mapped reviewer'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.bb_telegram_assistant_routes r WHERE r.assistant_key='bank_assistant' AND r.telegram_chat_id=p_chat AND r.telegram_thread_id=p_thread AND r.active
   UNION ALL SELECT 1 FROM public.bb_telegram_assistant_group_routes r WHERE r.assistant_key='bank_assistant' AND r.telegram_chat_id=p_chat AND r.telegram_thread_id=p_thread AND r.active)
 THEN RAISE EXCEPTION 'Inactive Bank Assistant topic'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('BB_BANK_SESSION_'||p_chat||':'||p_thread));
 -- Only abandoned collection data may be discarded automatically;
 -- reviewing/processing bank approvals are NEVER automatically deleted here.
 DELETE FROM public.bb_bank_review_sessions
 WHERE source_chat_id=p_chat AND source_thread_id=p_thread
   AND status='collecting' AND expires_at<=now();
 SELECT * INTO v_s FROM public.bb_bank_review_sessions
 WHERE source_chat_id=p_chat AND source_thread_id=p_thread AND status='collecting'
 FOR UPDATE;
 IF FOUND THEN
   RETURN jsonb_build_object('session_id',v_s.session_id,'existing',true,'count',v_s.notice_count,
    'total_usd',v_s.total_usd,'total_khr',v_s.total_khr,'prompt_message_id',v_s.prompt_message_id);
 END IF;
 INSERT INTO public.bb_bank_review_sessions(source_chat_id,source_thread_id,requested_by_telegram_user_id,reviewer_telegram_user_id)
 VALUES(p_chat,p_thread,p_user,v_reviewer) RETURNING * INTO v_s;
 RETURN jsonb_build_object('session_id',v_s.session_id,'existing',false,'count',0,
  'total_usd',0,'total_khr',0,'prompt_message_id',null);
END $fn$;

CREATE OR REPLACE FUNCTION public.bb_bank_session_stage_v1(
 p_session uuid,p_chat text,p_thread bigint,p_user text,
 p_message_id bigint,p_notice jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_s public.bb_bank_review_sessions%ROWTYPE;
 v_rows integer;
 v_amount numeric;
 v_currency text;
 v_date date;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Bank staging server-only'; END IF;
 IF p_session IS NULL OR p_message_id IS NULL OR p_message_id<=0 OR p_notice IS NULL THEN
    RAISE EXCEPTION 'Invalid bank notification context'; END IF;
 SELECT * INTO v_s FROM public.bb_bank_review_sessions
 WHERE session_id=p_session AND source_chat_id=p_chat AND source_thread_id=p_thread
 FOR UPDATE;
 IF NOT FOUND OR v_s.status<>'collecting' OR v_s.expires_at<=now()
 OR v_s.requested_by_telegram_user_id IS DISTINCT FROM p_user
 THEN RETURN jsonb_build_object('accepted',false,'reason','no_active_session'); END IF;
 IF v_s.notice_count>=100 THEN
 RETURN jsonb_build_object('accepted',false,'reason','limit_reached','count',v_s.notice_count);
 END IF;
 v_amount:=CASE WHEN coalesce(p_notice->>'amount','') ~ '^[0-9]{1,12}(\.[0-9]{1,4})?$'
   THEN (p_notice->>'amount')::numeric ELSE NULL END;
 v_currency:=upper(coalesce(p_notice->>'currency',''));
 IF v_currency NOT IN ('USD','KHR') THEN v_currency:=NULL; END IF;
 v_date:=CASE WHEN coalesce(p_notice->>'received_date','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   THEN (p_notice->>'received_date')::date ELSE NULL END;
 INSERT INTO public.bb_bank_new_invoice_review_drafts(
   source_chat_id,source_thread_id,source_message_id,review_session_id,
   sender_name,transaction_id,amount,currency,received_date,bank_channel,
   expires_at
 ) VALUES(
   p_chat,p_thread,p_message_id,p_session,
   nullif(left(trim(coalesce(p_notice->>'sender','')),140),''),
   nullif(left(trim(coalesce(p_notice->>'transaction_id','')),160),''),
   v_amount,v_currency,v_date,
   nullif(left(trim(coalesce(p_notice->>'bank_channel','')),120),''),
   greatest(v_s.expires_at,now()+interval '24 hours')
 )
 ON CONFLICT(source_chat_id,source_thread_id,source_message_id) DO NOTHING;
 GET DIAGNOSTICS v_rows=ROW_COUNT;
 IF v_rows>0 THEN
   UPDATE public.bb_bank_review_sessions
   SET notice_count=notice_count+1,
       total_usd=total_usd+CASE WHEN v_currency='USD' THEN coalesce(v_amount,0) ELSE 0 END,
       total_khr=total_khr+CASE WHEN v_currency='KHR' THEN coalesce(v_amount,0) ELSE 0 END,
       updated_at=now()
   WHERE session_id=p_session
   RETURNING * INTO v_s;
 END IF;
 RETURN jsonb_build_object('accepted',true,'new',v_rows>0,'count',v_s.notice_count,
   'total_usd',v_s.total_usd,'total_khr',v_s.total_khr,'session_id',v_s.session_id,
   'prompt_message_id',v_s.prompt_message_id);
END $fn$;

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

CREATE OR REPLACE FUNCTION public.bb_bank_session_cleanup_v1(
 p_batch_id uuid,p_reviewer text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_session uuid; v_status text; v_deleted integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Bank cleanup server-only'; END IF;
 SELECT b.review_session_id,b.status INTO v_session,v_status
 FROM public.bb_bank_transaction_review_batches b
 WHERE b.batch_id=p_batch_id AND b.reviewer_telegram_user_id=p_reviewer
 FOR UPDATE;
 IF v_session IS NULL OR v_status NOT IN ('completed','cancelled') THEN
   RETURN jsonb_build_object('cleaned',false,'reason','not_terminal_session_batch');
 END IF;
 IF v_status='completed' AND EXISTS(
 SELECT 1 FROM public.bb_bank_new_invoice_review_drafts d
 WHERE d.review_batch_id=p_batch_id AND d.status NOT IN('registered','discarded'))
 THEN RAISE EXCEPTION 'Unfinished bank review rows cannot be cleaned'; END IF;
 IF v_status='cancelled' AND EXISTS(
 SELECT 1 FROM public.bb_bank_new_invoice_review_drafts d
 WHERE d.review_batch_id=p_batch_id AND d.registered_transaction_id IS NOT NULL)
 THEN RAISE EXCEPTION 'Cancelled batch has registered references; requires audit'; END IF;
 DELETE FROM public.bb_bank_new_invoice_review_drafts
 WHERE review_batch_id=p_batch_id AND review_session_id=v_session;
 GET DIAGNOSTICS v_deleted=ROW_COUNT;
 DELETE FROM public.bb_bank_transaction_review_batches WHERE batch_id=p_batch_id;
 DELETE FROM public.bb_bank_review_sessions WHERE session_id=v_session AND status='reviewing';
 RETURN jsonb_build_object('cleaned',true,'drafts_deleted',v_deleted,
   'bank_register_unchanged',true,'payments_unchanged',true);
END $fn$;

REVOKE ALL ON FUNCTION public.bb_bank_session_begin_v1(text,bigint,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bb_bank_session_stage_v1(uuid,text,bigint,text,bigint,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bb_bank_session_review_now_v1(uuid,text,bigint,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bb_bank_session_cleanup_v1(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bb_bank_session_begin_v1(text,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bb_bank_session_stage_v1(uuid,text,bigint,text,bigint,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.bb_bank_session_review_now_v1(uuid,text,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bb_bank_session_cleanup_v1(uuid,text) TO service_role;
