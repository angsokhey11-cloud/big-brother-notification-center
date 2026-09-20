/* BIG BROTHER Notification Center — Customer Invoice Routing V1 */
(function(){
  'use strict';

  pages.customers = 'Customer Invoice Routing';
  pages.invoiceQueue = 'Invoice Queue';

  const INVOICE_SEND_FUNCTION = SUPABASE_URL + '/functions/v1/bb-telegram-invoice-send';

  let customerSearch = '';
  let customerEnabledOnly = false;

  function clean(value){
    return String(value ?? '').trim();
  }

  function money(value, currency='USD'){
    const n=Number(value)||0;
    if(String(currency).toUpperCase()==='KHR'){
      return 'KHR '+Math.round(n).toLocaleString('en-US');
    }
    return '$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  }

  function customerRouteLabel(customer){
    if(!customer?.telegram_chat_id)return 'Not configured';
    return clean(customer.telegram_destination_name) ||
      (customer.telegram_thread_id ? 'Topic '+customer.telegram_thread_id : 'Main group chat');
  }

  function openCustomerRouteDialog(customer){
    document.getElementById('customerRouteModal')?.remove();

    const modal=document.createElement('div');
    modal.id='customerRouteModal';
    modal.className='modal-backdrop';
    modal.innerHTML=`
      <div class="modal-card customer-route-modal">
        <div class="section-head">
          <div>
            <p class="eyebrow">CUSTOMER TELEGRAM INVOICE</p>
            <h3>${escapeHtml(customer.customer_name || customer.customer_id)}</h3>
            <p class="hint">${escapeHtml(customer.customer_id)}${customer.location_code ? ' • '+escapeHtml(customer.location_code) : ''}</p>
          </div>
          <button type="button" class="icon-btn" id="customerRouteClose">×</button>
        </div>

        <form id="customerRouteForm" class="form-grid">
          <label class="check-line customer-send-toggle">
            <input id="customerSendInvoice" type="checkbox" ${customer.telegram_send_invoice ? 'checked' : ''} />
            <span>
              <strong>Send Invoice to Telegram</strong>
              <small>After accounting completes this customer's invoice, BIG BROTHER will offer a Send Invoice confirmation.</small>
            </span>
          </label>

          <label>
            Telegram Group Chat ID
            <input
              id="customerTelegramChatId"
              inputmode="numeric"
              value="${escapeHtml(customer.telegram_chat_id || '')}"
              placeholder="-1004317302923"
            />
          </label>

          <label>
            Telegram Topic ID
            <input
              id="customerTelegramThreadId"
              inputmode="numeric"
              value="${escapeHtml(customer.telegram_thread_id || '')}"
              placeholder="3"
            />
          </label>

          <label>
            Destination Name
            <input
              id="customerTelegramDestination"
              value="${escapeHtml(customer.telegram_destination_name || '')}"
              placeholder="ABC Mart Invoice Topic"
            />
          </label>

          <div class="reminder-box customer-route-help">
            <strong>Exact routing</strong>
            <small>Group Chat ID identifies the Telegram group. Topic ID identifies the exact forum topic. Leave Topic ID blank only when invoices should go to the main group chat.</small>
          </div>

          <div class="modal-actions">
            <button type="button" class="btn secondary" id="customerRouteCancel">Cancel</button>
            <button type="submit" class="btn primary" id="customerRouteSave">Save Customer Route</button>
          </div>
          <div class="form-error" id="customerRouteError"></div>
        </form>
      </div>`;

    document.body.appendChild(modal);

    const close=()=>modal.remove();
    document.getElementById('customerRouteClose').addEventListener('click',close);
    document.getElementById('customerRouteCancel').addEventListener('click',close);
    modal.addEventListener('click',(event)=>{if(event.target===modal)close()});

    document.getElementById('customerRouteForm').addEventListener('submit',async(event)=>{
      event.preventDefault();
      const button=document.getElementById('customerRouteSave');
      const errorBox=document.getElementById('customerRouteError');
      errorBox.textContent='';
      setBusy(button,true,'Saving…');
      try{
        await adminCall({
          action:'save_customer_invoice_route',
          customer_id:customer.customer_id,
          telegram_send_invoice:document.getElementById('customerSendInvoice').checked,
          telegram_chat_id:document.getElementById('customerTelegramChatId').value,
          telegram_thread_id:document.getElementById('customerTelegramThreadId').value,
          telegram_destination_name:document.getElementById('customerTelegramDestination').value,
        });
        close();
        showToast('Customer Telegram invoice route saved.','success');
        await bootstrap(false);
      }catch(error){
        errorBox.textContent=error?.message||String(error);
      }finally{
        setBusy(button,false);
      }
    });
  }

  async function testCustomerRoute(customer,button){
    setBusy(button,true,'Testing…');
    try{
      await adminCall({
        action:'test_customer_invoice_route',
        customer_id:customer.customer_id,
      });
      showToast('Customer Telegram destination verified.','success');
      await bootstrap(false);
    }catch(error){
      showToast(error?.message||String(error),'error');
    }finally{
      setBusy(button,false);
    }
  }

  function renderCustomers(){
    const content=document.getElementById('customerInvoiceRoutingContent');
    if(!content)return;

    const customers=Array.isArray(state.customers)?state.customers:[];
    const query=customerSearch.toLowerCase();
    const filtered=customers.filter((customer)=>{
      if(customerEnabledOnly && !customer.telegram_send_invoice)return false;
      if(!query)return true;
      return [
        customer.customer_id,
        customer.customer_name,
        customer.phone,
        customer.location_code,
        customer.telegram_destination_name,
        customer.telegram_chat_id,
        customer.telegram_thread_id,
      ].some((value)=>clean(value).toLowerCase().includes(query));
    });

    const enabledCount=customers.filter((c)=>c.telegram_send_invoice).length;
    const verifiedCount=customers.filter((c)=>c.telegram_verified_at).length;

    content.className='customer-routing-wrap';
    content.innerHTML=`
      <div class="customer-route-toolbar">
        <div class="customer-route-stats">
          <span><strong>${customers.length}</strong><small>Customers</small></span>
          <span><strong>${enabledCount}</strong><small>Send Invoice ON</small></span>
          <span><strong>${verifiedCount}</strong><small>Verified Routes</small></span>
        </div>
        <div class="customer-route-filters">
          <input id="customerRouteSearch" type="search" placeholder="Search customer, ID, location or Telegram destination…" value="${escapeHtml(customerSearch)}" />
          <label class="customer-enabled-filter"><input id="customerEnabledOnly" type="checkbox" ${customerEnabledOnly?'checked':''}> Enabled only</label>
        </div>
      </div>

      <div class="customer-table-wrap">
        <div class="data-table customer-route-table">
          <div class="data-row customer-route-row data-head">
            <span>Customer</span><span>Telegram Destination</span><span>Invoice Setting</span><span>Verification</span><span>Actions</span>
          </div>
          ${filtered.length ? filtered.map((customer)=>{
            const configured=Boolean(customer.telegram_chat_id);
            const enabled=customer.telegram_send_invoice===true;
            const verified=Boolean(customer.telegram_verified_at);
            const topic=customer.telegram_thread_id ? 'Topic '+customer.telegram_thread_id : (configured ? 'Main group chat' : '');
            return `
              <div class="data-row customer-route-row" data-customer-id="${escapeHtml(customer.customer_id)}">
                <span>
                  <strong>${escapeHtml(customer.customer_name || customer.customer_id)}</strong>
                  <small>${escapeHtml(customer.customer_id)}${customer.location_code ? ' • '+escapeHtml(customer.location_code) : ''}</small>
                </span>
                <span>
                  <strong>${escapeHtml(customerRouteLabel(customer))}</strong>
                  <small>${escapeHtml(customer.telegram_chat_id_masked || '')}${topic ? ' • '+escapeHtml(topic) : ''}</small>
                </span>
                <span><span class="status-pill ${enabled?'success':'pending'}">${enabled?'Send Invoice ON':'OFF'}</span></span>
                <span>
                  <span class="status-pill ${verified?'success':'pending'}">${verified?'Verified':(configured?'Not tested':'Not configured')}</span>
                  ${verified ? '<small>'+escapeHtml(formatTime(customer.telegram_verified_at))+'</small>' : ''}
                </span>
                <span class="row-actions">
                  <button type="button" class="btn secondary customer-route-edit">Configure</button>
                  <button type="button" class="btn secondary customer-route-test" ${configured?'':'disabled'}>Test Topic</button>
                </span>
              </div>`;
          }).join('') : `
            <div class="customer-route-empty">No customers match this filter.</div>`}
        </div>
      </div>`;

    const search=document.getElementById('customerRouteSearch');
    search?.addEventListener('input',(event)=>{
      customerSearch=event.target.value||'';
      renderCustomers();
      document.getElementById('customerRouteSearch')?.focus();
    });
    document.getElementById('customerEnabledOnly')?.addEventListener('change',(event)=>{
      customerEnabledOnly=event.target.checked===true;
      renderCustomers();
    });

    content.querySelectorAll('.customer-route-row[data-customer-id]').forEach((row)=>{
      const customer=customers.find((item)=>String(item.customer_id)===String(row.dataset.customerId));
      if(!customer)return;
      row.querySelector('.customer-route-edit')?.addEventListener('click',()=>openCustomerRouteDialog(customer));
      row.querySelector('.customer-route-test')?.addEventListener('click',(event)=>testCustomerRoute(customer,event.currentTarget));
    });
  }

  async function invoiceSendCall(payload,retry=true){
    await ensureSession();
    const request=()=>fetch(INVOICE_SEND_FUNCTION,{
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

  async function retryInvoiceJob(job,button){
    setBusy(button,true,'Retrying…');
    try{
      await invoiceSendCall({
        action:'retry',
        job_id:job.job_id
      });
      showToast('Invoice sent successfully on retry.','success');
      await bootstrap(false);
    }catch(error){
      showToast(error?.message||String(error),'error');
      await bootstrap(false).catch(()=>{});
    }finally{
      setBusy(button,false);
    }
  }

  async function cancelInvoiceJob(job,button){
    if(!confirm('Cancel Telegram invoice job '+job.invoice_no_snapshot+'?'))return;
    setBusy(button,true,'Cancelling…');
    try{
      await adminCall({action:'cancel_invoice_job',job_id:job.job_id});
      showToast('Invoice Telegram job cancelled.','success');
      await bootstrap(false);
    }catch(error){
      showToast(error?.message||String(error),'error');
    }finally{
      setBusy(button,false);
    }
  }

  function renderInvoiceQueue(){
    const content=document.getElementById('invoiceQueueContent');
    if(!content)return;
    const jobs=Array.isArray(state.invoiceJobs)?state.invoiceJobs:[];

    if(!jobs.length){
      content.className='empty-state';
      content.innerHTML='<div class="empty-icon">≡</div><h3>No invoice jobs yet</h3><p>After an accountant confirms Send Invoice, the exact invoice job will appear here.</p>';
      return;
    }

    content.className='invoice-queue-wrap';
    content.innerHTML=`
      <div class="customer-route-stats invoice-queue-stats">
        <span><strong>${jobs.filter((j)=>j.status==='pending').length}</strong><small>Pending</small></span>
        <span><strong>${jobs.filter((j)=>j.status==='sent').length}</strong><small>Sent</small></span>
        <span><strong>${jobs.filter((j)=>j.status==='failed').length}</strong><small>Failed</small></span>
      </div>
      <div class="invoice-queue-table-wrap">
        <div class="data-table invoice-queue-table">
          <div class="data-row invoice-queue-row data-head">
            <span>Invoice</span><span>Customer</span><span>Accounting Status</span><span>Destination</span><span>Delivery</span><span>Actions</span>
          </div>
          ${jobs.map((job)=>{
            const deliveryClass=job.status==='sent'?'success':'pending';
            const destination=job.destination_label || (job.telegram_thread_id ? 'Topic '+job.telegram_thread_id : 'Main group chat');
            return `
              <div class="data-row invoice-queue-row" data-job-id="${escapeHtml(job.job_id)}">
                <span><strong>${escapeHtml(job.invoice_no_snapshot)}</strong><small>${escapeHtml(formatTime(job.requested_at))}</small></span>
                <span><strong>${escapeHtml(job.customer_name_snapshot || job.customer_id)}</strong><small>${escapeHtml(job.customer_id)}</small></span>
                <span>
                  <strong>${escapeHtml(job.payment_status)}</strong>
                  <small>${escapeHtml(money(job.grand_total,job.currency))} • Balance ${escapeHtml(money(job.outstanding,job.currency))}</small>
                </span>
                <span><strong>${escapeHtml(destination)}</strong><small>${escapeHtml(job.telegram_chat_id_masked || '')}${job.telegram_thread_id?' • Topic '+escapeHtml(job.telegram_thread_id):''}</small></span>
                <span>
                  <span class="status-pill ${deliveryClass}">${escapeHtml(job.status)}</span>
                  ${job.error_message?'<small class="log-error">'+escapeHtml(job.error_message)+'</small>':''}
                  ${job.sent_at?'<small>'+escapeHtml(formatTime(job.sent_at))+'</small>':''}
                </span>
                <span class="row-actions">
                  ${job.status==='failed'?'<button type="button" class="btn primary invoice-job-retry">Retry</button>':''}
                  ${['pending','failed'].includes(job.status)?'<button type="button" class="btn secondary invoice-job-cancel">Cancel</button>':''}
                </span>
              </div>`;
          }).join('')}
        </div>
      </div>`;

    content.querySelectorAll('.invoice-queue-row[data-job-id]').forEach((row)=>{
      const job=jobs.find((item)=>String(item.job_id)===String(row.dataset.jobId));
      if(!job)return;
      row.querySelector('.invoice-job-retry')?.addEventListener('click',(event)=>retryInvoiceJob(job,event.currentTarget));
      row.querySelector('.invoice-job-cancel')?.addEventListener('click',(event)=>cancelInvoiceJob(job,event.currentTarget));
    });
  }

  function render(){
    renderCustomers();
    renderInvoiceQueue();
  }

  window.BBCustomerInvoiceRouting={render,openCustomerRouteDialog};
  render();
})();