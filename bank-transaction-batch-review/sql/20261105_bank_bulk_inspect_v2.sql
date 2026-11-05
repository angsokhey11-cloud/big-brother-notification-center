-- Read-only Bank Review V2 analysis, scoped by Edge Function to an authorized admin review.
-- This function does not write to any business or accounting table.
CREATE OR REPLACE FUNCTION public.bb_bank_review_inspect_v2(
 p_transaction_ids text[],p_customer_ids text[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_duplicates jsonb;v_balances jsonb;v_ar jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'Bank analysis is server-only';
 END IF;
 IF coalesce(array_length(p_transaction_ids,1),0)>100 OR coalesce(array_length(p_customer_ids,1),0)>100
 THEN RAISE EXCEPTION 'Bank review analysis request too large';END IF;
 WITH all_ref AS(
  SELECT upper(trim(transaction_id)) tid,'Bank Register' source FROM public.bb_verified_bank_transactions
  UNION ALL SELECT upper(trim(coalesce(transaction_id,''))),'Payment History' FROM public.payments
  UNION ALL SELECT upper(trim(coalesce(collection_transaction_id,''))),'Company Deposit' FROM public.company_deposits
  UNION ALL SELECT upper(trim(transaction_id)),'Cancelled ID' FROM public.bb_cancelled_bank_transaction_ids
  UNION ALL SELECT upper(trim(coalesce(transaction_id,''))),'Purchase Payment' FROM public.purchase_payments
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('transaction_id',tid,'source',source)),'[]'::jsonb)
 INTO v_duplicates FROM all_ref
 WHERE tid<>'' AND tid=ANY(p_transaction_ids);
 SELECT coalesce(jsonb_agg(jsonb_build_object('customer_id',customer_id,'currency',currency,
        'available',amount)),'[]'::jsonb)
 INTO v_balances FROM (
  SELECT customer_id,upper(currency) currency,sum(remaining_amount) amount
  FROM public.bb_bank_balance_snapshot
  WHERE customer_id=ANY(p_customer_ids) AND remaining_amount>0
  GROUP BY customer_id,upper(currency)
 ) b;
 SELECT coalesce(jsonb_agg(jsonb_build_object('customer_id',customer_id,'currency',currency,
        'outstanding',amount)),'[]'::jsonb)
 INTO v_ar FROM (
  SELECT customer_id,upper(currency) currency,sum(outstanding) amount
  FROM public.invoices
  WHERE customer_id=ANY(p_customer_ids) AND outstanding>0
  GROUP BY customer_id,upper(currency)
 ) i;
 RETURN jsonb_build_object('duplicates',v_duplicates,
   'available_bank_balances',v_balances,'outstanding_receivables',v_ar);
END
$fn$;
REVOKE ALL ON FUNCTION public.bb_bank_review_inspect_v2(text[],text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bb_bank_review_inspect_v2(text[],text[]) TO service_role;
