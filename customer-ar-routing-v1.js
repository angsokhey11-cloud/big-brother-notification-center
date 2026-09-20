/* BIG BROTHER Notification Center — Customer A/R Telegram Queue V1 */
(function(){
  'use strict';

  const AR_FUNCTION=SUPABASE_URL+'/functions/v1/bb-telegram-ar-update';

  function clean(value){
    return String(value==null?'':value).trim();
  }

  function amount(value,currency){
    const n=Number(value)||0;
    const cur=clean(currency).toUpperCase()||'USD';
    if(cur==='KHR'){
      return 'KHR '+Math.round(n).toLocaleString('en-US');
    }
    return '$'+n.toLocaleString('en-US',{
      minimumFractionDigits:2,
      maximumFractionDigits:2
    });
  }

  function outstanding(job){
    const snapshot=job?.latest_outstanding||{};
    const totals=snapshot?.totals||{};
    const currencies=Object.keys(totals).sort();

    if(!currencies.length){
      return 'All credit invoices cleared';
    }

    return currencies
      .map(currency=>currency+' '+amount(totals[currency],currency))
      .join(' • ');
  }

  async function arCall(payload,retry=true){
    await ensureSession();

    const request=()=>fetch(AR_FUNCTION,{
      method:'POST',
      headers:{
        apikey:SUPABASE_KEY,
        Authorization:'Bearer '+session.access_token,
        'Content-Type':'application/json'
      },
      body:JSON.stringify(payload||{}),
      cache:'no-store'
    });

    let response=await request();

    if(response.status===401&&retry){
      await refreshSession();
      response=await request();
    }

    return parseResponse(response);
  }

  async function retryJob(job,button){
    setBusy(button,true,'Retrying…');

    try{
      await arCall({
        action:'retry',
        job_id:job.job_id
      });

      showToast('A/R update sent successfully on retry.','success');
      await bootstrap(false);
    }catch(error){
      showToast(error?.message||String(error),'error');
      await bootstrap(false).catch(()=>{});
    }finally{
      setBusy(button,false);
    }
  }

  async function cancelJob(job,button){
    if(!confirm('Cancel Telegram A/R update for '+clean(job.payment_id)+'?'))return;

    setBusy(button,true,'Cancelling…');

    try{
      await adminCall({
        action:'cancel_ar_job',
        job_id:job.job_id
      });

      showToast('A/R Telegram job cancelled.','success');
      await bootstrap(false);
    }catch(error){
      showToast(error?.message||String(error),'error');
    }finally{
      setBusy(button,false);
    }
  }

  function render(){
    const content=document.getElementById('arQueueContent');
    if(!content)return;

    const jobs=Array.isArray(state.arJobs)?state.arJobs:[];

    if(!jobs.length){
      content.className='empty-state';
      content.innerHTML=
        '<div class="empty-icon">≡</div>'+
        '<h3>No A/R update jobs yet</h3>'+
        '<p>After accounting fully clears an eligible customer invoice and confirms Telegram, the exact payment job will appear here.</p>';
      return;
    }

    content.className='invoice-queue-wrap';

    content.innerHTML=`
      <div class="customer-route-stats invoice-queue-stats">
        <span><strong>${jobs.filter(job=>job.status==='pending').length}</strong><small>Pending</small></span>
        <span><strong>${jobs.filter(job=>job.status==='sent').length}</strong><small>Sent</small></span>
        <span><strong>${jobs.filter(job=>job.status==='failed').length}</strong><small>Failed</small></span>
      </div>

      <div class="invoice-queue-table-wrap">
        <div class="data-table invoice-queue-table">
          <div class="data-row invoice-queue-row data-head">
            <span>Payment / Cleared</span>
            <span>Customer</span>
            <span>Latest Outstanding</span>
            <span>Destination</span>
            <span>Delivery</span>
            <span>Actions</span>
          </div>

          ${jobs.map(job=>{
            const cleared=Array.isArray(job.cleared_invoices)
              ? job.cleared_invoices
              : [];

            const clearedNos=cleared
              .map(item=>item?.invoiceNo||item?.invoice_no)
              .filter(Boolean)
              .join(', ');

            const destination=
              clean(job.destination_label) ||
              (
                job.telegram_thread_id
                  ? 'Topic '+job.telegram_thread_id
                  : 'Main group chat'
              );

            const statusClass=job.status==='sent'?'success':'pending';

            return `
              <div class="data-row invoice-queue-row" data-ar-job-id="${escapeHtml(job.job_id)}">
                <span>
                  <strong>${escapeHtml(job.payment_id)}</strong>
                  <small>${escapeHtml(clearedNos||'Cleared invoice')}</small>
                </span>

                <span>
                  <strong>${escapeHtml(job.customer_name_snapshot||job.customer_id)}</strong>
                  <small>${escapeHtml(job.customer_id)}</small>
                </span>

                <span>
                  <strong>${escapeHtml(outstanding(job))}</strong>
                  <small>
                    Payment ${escapeHtml(amount(job.payment_amount,job.payment_currency))}
                    ${job.payment_method?' • '+escapeHtml(job.payment_method):''}
                  </small>
                </span>

                <span>
                  <strong>${escapeHtml(destination)}</strong>
                  <small>
                    ${escapeHtml(job.telegram_chat_id_masked||'')}
                    ${job.telegram_thread_id?' • Topic '+escapeHtml(job.telegram_thread_id):''}
                  </small>
                </span>

                <span>
                  <span class="status-pill ${statusClass}">${escapeHtml(job.status)}</span>
                  ${job.error_message?'<small class="log-error">'+escapeHtml(job.error_message)+'</small>':''}
                  ${job.sent_at?'<small>'+escapeHtml(formatTime(job.sent_at))+'</small>':''}
                </span>

                <span class="row-actions">
                  ${job.status==='failed'
                    ? '<button type="button" class="btn primary ar-job-retry">Retry</button>'
                    : ''}
                  ${['pending','failed'].includes(job.status)
                    ? '<button type="button" class="btn secondary ar-job-cancel">Cancel</button>'
                    : ''}
                </span>
              </div>`;
          }).join('')}
        </div>
      </div>`;

    content.querySelectorAll('[data-ar-job-id]').forEach(row=>{
      const job=jobs.find(
        item=>String(item.job_id)===String(row.dataset.arJobId)
      );

      if(!job)return;

      row.querySelector('.ar-job-retry')?.addEventListener(
        'click',
        event=>retryJob(job,event.currentTarget)
      );

      row.querySelector('.ar-job-cancel')?.addEventListener(
        'click',
        event=>cancelJob(job,event.currentTarget)
      );
    });
  }

  window.BBCustomerARRouting={render};
  render();
})();