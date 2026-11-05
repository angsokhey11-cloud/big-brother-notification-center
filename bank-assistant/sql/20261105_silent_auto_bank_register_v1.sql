-- BIG BROTHER Bank Assistant V2: safe, atomic registration of uniquely identified bank notices.
-- SERVER ONLY. NO invoice payments, receivable clears, bank allocations, or exchange conversion.
-- The admin who configured the exact Telegram review route authorizes the bot action;
-- the actual Telegram command initiator is stored in the audit record.
CREATE OR REPLACE FUNCTION public.bb_bank_assistant_auto_register_v1(
 p_draft_id uuid, p_chat text, p_thread bigint, p_reviewer text, p_command_user text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $func$
DECLARE
 d public.bb_bank_new_invoice_review_drafts%ROWTYPE;
 v_route public.bb_bank_review_personal_routes%ROWTYPE;
 v_id bigint;
 v_customer text;
 v_name text;
 v_identities integer;
 v_customers integer;
 v_tid text;
 v_amount numeric;
 v_currency text;
 v_bank text;
 v_norm text;
 v_review text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
   RAISE EXCEPTION 'Bank Assistant server-only registration';
 END IF;
 IF p_draft_id IS NULL OR nullif(btrim(coalesce(p_chat,'')),'') IS NULL
    OR p_thread IS NULL OR p_thread < 0
    OR p_reviewer !~ '^[0-9]{5,20}$'
    OR p_command_user !~ '^[0-9]{5,20}$' THEN
   RAISE EXCEPTION 'Invalid Telegram batch registration context';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.bb_telegram_assistant_admins a
               WHERE a.telegram_user_id=p_command_user)
    OR NOT EXISTS(SELECT 1 FROM public.bb_telegram_assistant_admins a
                  WHERE a.telegram_user_id=p_reviewer) THEN
   RAISE EXCEPTION 'Telegram administrator authorization required';
 END IF;
 SELECT r.* INTO v_route
 FROM public.bb_bank_review_personal_routes r
 JOIN public.app_users a ON a.user_id=r.updated_by AND a.active
   AND lower(a.role)='admin'
 WHERE r.source_chat_id=p_chat AND r.source_thread_id=p_thread
   AND r.reviewer_telegram_user_id=p_reviewer AND r.active=true;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Authorized admin-managed bank review route required';
 END IF;
 IF NOT EXISTS(
   SELECT 1 FROM public.bb_telegram_assistant_routes r
   WHERE r.assistant_key='bank_assistant'
     AND r.telegram_chat_id=p_chat AND r.telegram_thread_id=p_thread AND r.active
   UNION ALL SELECT 1 FROM public.bb_telegram_assistant_group_routes r
   WHERE r.assistant_key='bank_assistant'
     AND r.telegram_chat_id=p_chat AND r.telegram_thread_id=p_thread AND r.active
 ) THEN RAISE EXCEPTION 'Bank topic is not active'; END IF;

 SELECT * INTO d
 FROM public.bb_bank_new_invoice_review_drafts x
 WHERE x.draft_id=p_draft_id
   AND x.source_chat_id=p_chat AND x.source_thread_id=p_thread
 FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
 IF d.status='registered' THEN RETURN jsonb_build_object('outcome','already_processed'); END IF;
 IF d.status='discarded' THEN RETURN jsonb_build_object('outcome','already_processed'); END IF;
 IF d.status IS DISTINCT FROM 'candidate' OR d.review_batch_id IS NOT NULL
    OR d.expires_at <= now() THEN
    RETURN jsonb_build_object('outcome','review','reason','not_available');
 END IF;

 v_tid := upper(btrim(coalesce(d.transaction_id,'')));
 v_amount := d.amount;
 v_currency := upper(btrim(coalesce(d.currency,'')));
 v_norm := lower(regexp_replace(translate(btrim(coalesce(d.sender_name,'')), '.,-_', '    '), '\s+', ' ', 'g'));
 IF v_tid !~ '^[A-Z0-9-]{5,80}$' THEN
   RETURN jsonb_build_object('outcome','review','reason','missing_transaction_id');
 END IF;

 -- Idempotency across every recognized Bank Register / payment source.
 -- Lock the transaction ID even if Telegram delivers simultaneous re-forwards.
 PERFORM pg_advisory_xact_lock(hashtext('BB_BANK_TX_'||v_tid));
 IF EXISTS(SELECT 1 FROM public.bb_verified_bank_transactions b
           WHERE upper(btrim(b.transaction_id))=v_tid)
    OR EXISTS(SELECT 1 FROM public.payments p
           WHERE upper(btrim(coalesce(p.transaction_id,'')))=v_tid)
    OR EXISTS(SELECT 1 FROM public.company_deposits c
           WHERE upper(btrim(coalesce(c.collection_transaction_id,'')))=v_tid)
    OR EXISTS(SELECT 1 FROM public.bb_cancelled_bank_transaction_ids x
           WHERE upper(btrim(x.transaction_id))=v_tid)
 THEN
   UPDATE public.bb_bank_new_invoice_review_drafts
   SET status='discarded',review_decision='ignore',
       review_payload=jsonb_build_object('reason','registered_or_cancelled_transaction_id',
                                        'transaction_id',v_tid,'processed_by_bot',true),
       reviewer_telegram_user_id=p_reviewer,updated_at=now()
   WHERE draft_id=d.draft_id;
   RETURN jsonb_build_object('outcome','duplicate','transaction_id',v_tid);
 END IF;

 IF d.received_date IS NULL OR d.received_date < DATE '2000-01-01'
    OR d.received_date > (now() AT TIME ZONE 'Asia/Phnom_Penh')::date
    OR v_amount IS NULL OR v_amount <= 0 OR v_amount > 999999999
    OR v_currency NOT IN ('USD','KHR')
    OR (v_currency='KHR' AND v_amount <> trunc(v_amount))
    OR (v_currency='USD' AND v_amount <> round(v_amount,2))
    OR length(v_norm)<2 OR length(v_norm)>140
 THEN RETURN jsonb_build_object('outcome','review','reason','missing_or_invalid_fields'); END IF;

 -- If another forwarded notice uses the same transaction ID but contradicts
 -- its sender, currency, or amount, hold for human review.
 IF EXISTS(
   SELECT 1 FROM public.bb_bank_new_invoice_review_drafts z
   WHERE z.draft_id<>d.draft_id AND upper(btrim(coalesce(z.transaction_id,'')))=v_tid
     AND z.status IN('candidate','reviewing')
     AND (lower(btrim(coalesce(z.sender_name,''))) IS DISTINCT FROM lower(btrim(d.sender_name))
       OR z.amount IS DISTINCT FROM d.amount OR z.currency IS DISTINCT FROM d.currency)
 ) THEN RETURN jsonb_build_object('outcome','review','reason','conflicting_notice'); END IF;

 -- Staff may deposit money on behalf of customers; never infer beneficiary from staff name.
 IF EXISTS(
    SELECT 1 FROM public.staff s
    WHERE lower(regexp_replace(translate(btrim(s.staff_name), '.,-_', '    '), '\s+', ' ', 'g'))=v_norm
      AND lower(btrim(coalesce(s.status,''))) NOT IN ('inactive','resigned','terminated','left')
 ) THEN RETURN jsonb_build_object('outcome','review','reason','staff_payer'); END IF;

 -- Exact active payer-directory name/alias match only; no fuzzy selection or guessing.
 SELECT count(*),count(DISTINCT b.customer_id),min(b.identity_id),min(b.customer_id),
        min(b.account_holder_name)
 INTO v_identities,v_customers,v_id,v_customer,v_name
 FROM public.bb_customer_bank_identities b
 JOIN public.customers c ON c.customer_id=b.customer_id AND c.active=true
 WHERE b.active=true AND
   (lower(regexp_replace(translate(btrim(b.account_holder_name), '.,-_', '    '), '\s+', ' ', 'g'))=v_norm
    OR EXISTS(SELECT 1 FROM unnest(coalesce(b.alternative_names,ARRAY[]::text[])) alt
              WHERE lower(regexp_replace(translate(btrim(alt), '.,-_', '    '), '\s+', ' ', 'g'))=v_norm));
 IF v_identities<>1 OR v_customers<>1 THEN
   RETURN jsonb_build_object('outcome','review','reason',
     CASE WHEN v_identities=0 THEN 'unknown_payer' ELSE 'ambiguous_payer' END);
 END IF;

 -- This is the bank's actual currency, not an approved exchange conversion.
 v_bank:=CASE WHEN upper(coalesce(d.bank_channel,''))='ACLEDA' THEN 'ACLEDA'
              ELSE NULL END;
 INSERT INTO public.bb_verified_bank_transactions(
   transaction_id,customer_id,amount,currency,invoice_currency,
   approved_exchange_rate,bank_name,status,received_date,
   created_by,payer_identity_id,payer_name
 ) VALUES (
   v_tid,v_customer,v_amount,v_currency,v_currency,1,v_bank,
   'AVAILABLE',d.received_date,v_route.updated_by,v_id,v_name
 );
 UPDATE public.bb_bank_new_invoice_review_drafts
 SET status='registered',registered_transaction_id=v_tid,
     reviewer_telegram_user_id=p_reviewer,
     review_payload=jsonb_build_object('processed_by_bot',true,'source','Telegram Bank Assistant',
       'command_user_telegram_id',p_command_user,'matched_payer_identity_id',v_id,
       'route_authorizing_admin_user_id',v_route.updated_by),
     updated_at=now()
 WHERE draft_id=d.draft_id;

 INSERT INTO public.bb_audit_log(
   actor_user_id,actor_name,module,action,record_type,record_id,reference_no,
   reason,before_state,after_state,metadata
 ) VALUES (
   v_route.updated_by,'Bank Assistant (Telegram command)','bank_register',
   'bank_assistant_auto_registration','bb_verified_bank_transactions',v_tid,v_tid,
   'Automatic bank credit, uniquely matched active payer identity; no invoice payment',
   NULL,jsonb_build_object('customer_id',v_customer,'amount',v_amount,
     'currency',v_currency,'received_date',d.received_date,'status','AVAILABLE'),
   jsonb_build_object('command_user_telegram_id',p_command_user,
     'reviewer_telegram_id',p_reviewer,'source_chat_id',p_chat,
     'source_thread_id',p_thread,'source_message_id',d.source_message_id,
     'draft_id',d.draft_id,'payer_identity_id',v_id,'source','telegram-bank-assistant',
     'route_admin_user_id',v_route.updated_by,
     'invoice_payment_created',false,'currency_converted',false)
 );
 RETURN jsonb_build_object('outcome','registered','transaction_id',v_tid,
     'customer_id',v_customer,'amount',v_amount,'currency',v_currency);
END
$func$;
REVOKE ALL ON FUNCTION public.bb_bank_assistant_auto_register_v1(uuid,text,bigint,text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bb_bank_assistant_auto_register_v1(uuid,text,bigint,text,text)
 TO service_role;
