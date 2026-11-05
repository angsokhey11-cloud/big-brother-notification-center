-- BIG BROTHER Bank Review V2: one atomic preparation for an entire manually selected review.
-- Admin must approve final registration separately. This function never creates bank balances.
CREATE OR REPLACE FUNCTION public.bb_bank_review_bulk_prepare_v2(
 p_batch_id uuid, p_reviewer text, p_admin_user uuid, p_choices jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
 v_batch public.bb_bank_transaction_review_batches%ROWTYPE;
 v_entry jsonb;
 v_draft public.bb_bank_new_invoice_review_drafts%ROWTYPE;
 v_id uuid;
 v_selected boolean;
 v_customer text;
 v_tid text;
 v_sender text;
 v_cur text;
 v_date date;
 v_amt numeric;
 v_bank text;
 v_payer bigint;
 v_payer_name text;
 v_seen_ids uuid[] := '{}'::uuid[];
 v_seen_tx text[] := '{}'::text[];
 v_selected_count integer := 0;
 v_ignored integer := 0;
 v_usd numeric := 0;
 v_khr numeric := 0;
 v_n integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'Bank bulk preparation is server-only';
 END IF;
 IF p_batch_id IS NULL OR p_admin_user IS NULL OR p_reviewer !~ '^[0-9]{5,20}$'
   OR jsonb_typeof(p_choices) IS DISTINCT FROM 'array'
   OR jsonb_array_length(p_choices) NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'Invalid Bank Review batch or selection';
 END IF;
 IF NOT EXISTS(
  SELECT 1 FROM public.app_users u WHERE u.user_id=p_admin_user
   AND u.active=true AND lower(u.role)='admin'
 ) OR NOT EXISTS(
  SELECT 1 FROM public.bb_telegram_assistant_admins a WHERE a.telegram_user_id=p_reviewer
 ) THEN RAISE EXCEPTION 'Admin and reviewer authorization required'; END IF;
 SELECT * INTO v_batch
 FROM public.bb_bank_transaction_review_batches b
 WHERE b.batch_id=p_batch_id AND b.reviewer_telegram_user_id=p_reviewer
 FOR UPDATE;
 IF NOT FOUND OR v_batch.status<>'reviewing' OR v_batch.expires_at<=now()
    OR v_batch.review_session_id IS NULL THEN
  RAISE EXCEPTION 'An active explicit-session bank review is required';
 END IF;
 SELECT count(*) INTO v_n FROM public.bb_bank_new_invoice_review_drafts d
 WHERE d.review_batch_id=p_batch_id
 AND d.reviewer_telegram_user_id=p_reviewer AND d.status='reviewing';
 IF v_n<>jsonb_array_length(p_choices) THEN
  RAISE EXCEPTION 'Review selection is incomplete: expected % rows',v_n;
 END IF;
 FOR v_entry IN SELECT value FROM jsonb_array_elements(p_choices) LOOP
  IF (v_entry->>'draft_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR jsonb_typeof(v_entry->'selected') IS DISTINCT FROM 'boolean'
  THEN RAISE EXCEPTION 'Invalid transaction selection'; END IF;
  v_id:=(v_entry->>'draft_id')::uuid;
  IF v_id=ANY(v_seen_ids) THEN RAISE EXCEPTION 'Same draft selected twice'; END IF;
  v_seen_ids:=array_append(v_seen_ids,v_id);
  SELECT * INTO v_draft FROM public.bb_bank_new_invoice_review_drafts d
  WHERE d.draft_id=v_id AND d.review_batch_id=p_batch_id
   AND d.reviewer_telegram_user_id=p_reviewer AND d.status='reviewing'
  FOR UPDATE;
  IF NOT FOUND OR v_draft.registered_transaction_id IS NOT NULL THEN
   RAISE EXCEPTION 'Draft not available for review';
  END IF;
  v_selected:=(v_entry->>'selected')::boolean;
  IF NOT v_selected THEN
   UPDATE public.bb_bank_new_invoice_review_drafts SET
     review_decision='ignore',review_payload=NULL,
     reviewed_by_admin_user_id=p_admin_user,reviewed_at=now(),updated_at=now()
   WHERE draft_id=v_id;
   v_ignored:=v_ignored+1;
   CONTINUE;
  END IF;
  v_customer:=btrim(coalesce(v_entry->>'customer_id',''));
  v_tid:=upper(btrim(coalesce(v_entry->>'transaction_id','')));
  v_sender:=btrim(coalesce(v_entry->>'payer_name',''));
  v_cur:=upper(btrim(coalesce(v_entry->>'currency','')));
  v_bank:=left(btrim(coalesce(v_entry->>'bank_name','')),120);
  IF v_customer='' OR length(v_customer)>150 OR v_tid !~ '^[A-Z0-9_/-]{4,160}$'
    OR v_cur NOT IN('USD','KHR') OR v_tid=ANY(v_seen_tx)
  THEN RAISE EXCEPTION 'Customer, reference or currency missing/invalid on selected notice'; END IF;
  IF nullif(v_entry->>'amount','') IS NULL THEN RAISE EXCEPTION 'Amount required'; END IF;
  v_amt:=(v_entry->>'amount')::numeric;
  IF v_amt<=0 OR v_amt>999999999 OR v_amt<>round(v_amt,4)
  THEN RAISE EXCEPTION 'Invalid selected bank amount'; END IF;
  IF coalesce(v_entry->>'received_date','') !~ '^\d{4}-\d{2}-\d{2}$'
  THEN RAISE EXCEPTION 'Received date required'; END IF;
  v_date:=(v_entry->>'received_date')::date;
  IF v_date<DATE '2000-01-01'
    OR v_date>(now() AT TIME ZONE 'Asia/Phnom_Penh')::date
  THEN RAISE EXCEPTION 'Received date outside allowed range'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.customers c WHERE c.customer_id=v_customer AND c.active)
  THEN RAISE EXCEPTION 'Select an active customer'; END IF;
  v_payer:=NULL;
  IF nullif(v_entry->>'payer_identity_id','') IS NOT NULL THEN
   v_payer:=(v_entry->>'payer_identity_id')::bigint;
   IF NOT EXISTS(
     SELECT 1 FROM public.bb_customer_bank_identities p
     WHERE p.identity_id=v_payer AND p.customer_id=v_customer AND p.active
   ) THEN RAISE EXCEPTION 'Saved payer is not active for chosen customer'; END IF;
   v_payer_name:=NULL;
  ELSE
   IF length(v_sender) NOT BETWEEN 2 AND 140
   THEN RAISE EXCEPTION 'Payer name required for one-time registration'; END IF;
   v_payer_name:=v_sender;
  END IF;
  -- Reject already-used references before the operator proceeds to final approval.
  -- The protected Bank Register RPC repeats these checks atomically during registration.
  IF EXISTS(SELECT 1 FROM public.bb_verified_bank_transactions x
      WHERE upper(btrim(x.transaction_id))=v_tid)
    OR EXISTS(SELECT 1 FROM public.payments x
      WHERE upper(btrim(coalesce(x.transaction_id,'')))=v_tid)
    OR EXISTS(SELECT 1 FROM public.company_deposits x
      WHERE upper(btrim(coalesce(x.collection_transaction_id,'')))=v_tid)
    OR EXISTS(SELECT 1 FROM public.bb_cancelled_bank_transaction_ids x
      WHERE upper(btrim(x.transaction_id))=v_tid)
    OR EXISTS(SELECT 1 FROM public.purchase_payments x
      WHERE upper(btrim(coalesce(x.transaction_id,'')))=v_tid)
  THEN RAISE EXCEPTION 'Transaction ID % is already registered; unselect it',v_tid; END IF;
  v_seen_tx:=array_append(v_seen_tx,v_tid);
  UPDATE public.bb_bank_new_invoice_review_drafts
  SET review_decision='new_invoice',
    review_payload=jsonb_build_object(
      'customer_id',v_customer,'transaction_id',v_tid,'payer_identity_id',v_payer,
      'payer_name',v_payer_name,'amount',v_amt,'currency',v_cur,
      'invoice_currency',v_cur,'exchange_rate',1,'received_date',v_date,
      'bank_name',NULLIF(v_bank,'')
    ),
    reviewed_by_admin_user_id=p_admin_user,reviewed_at=now(),updated_at=now()
  WHERE draft_id=v_id;
  v_selected_count:=v_selected_count+1;
  IF v_cur='USD' THEN v_usd:=v_usd+v_amt;ELSE v_khr:=v_khr+v_amt;END IF;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'selected',v_selected_count,'ignored',v_ignored,
   'usd',v_usd,'khr',v_khr,'mode','manual_bulk_review');
END
$fn$;
REVOKE ALL ON FUNCTION public.bb_bank_review_bulk_prepare_v2(uuid,text,uuid,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bb_bank_review_bulk_prepare_v2(uuid,text,uuid,jsonb)
 TO service_role;
