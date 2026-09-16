/* BIG BROTHER Notification Center — Overdue Invoice Engine V1 */
(function(){
  'use strict';

  const OVERDUE_ADMIN_FUNCTION = `${SUPABASE_URL}/functions/v1/bb-notification-overdue-admin`;

  async function overdueCall(){
    await ensureSession();
    const request = () => fetch(OVERDUE_ADMIN_FUNCTION, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      cache: 'no-store',
    });

    let response = await request();
    if (response.status === 401) {
      await refreshSession();
      response = await request();
    }
    return parseResponse(response);
  }

  function overdueRule(){
    return state.rules.find((rule) => rule.event_key === 'overdue_invoice') || null;
  }

  function schedulerSetting(){
    return state.settings.find((setting) => setting.setting_key === 'overdue_scheduler') || null;
  }

  function ensureControls(){
    const page = document.getElementById('page-overview');
    if (!page) return;

    const firstEvent = page.querySelector('.event-row');
    const firstBadge = firstEvent?.querySelector('.status-pill');
    if (firstBadge) {
      firstBadge.textContent = 'Live';
      firstBadge.className = 'status-pill success';
    }

    let card = document.getElementById('overdueEngineCard');
    if (!card) {
      card = document.createElement('section');
      card.id = 'overdueEngineCard';
      card.className = 'panel section-card';
      card.style.marginTop = '18px';
      page.appendChild(card);
    }

    const rule = overdueRule();
    const scheduler = schedulerSetting();
    const days = Array.isArray(rule?.config?.reminder_days) ? rule.config.reminder_days : [1,3,7,15,30];
    const scheduleTime = scheduler?.config?.local_time || '08:00';
    const timezone = scheduler?.config?.timezone || 'Asia/Phnom_Penh';
    const active = rule?.enabled !== false && scheduler?.enabled !== false;

    card.innerHTML = `
      <div class="section-head">
        <div>
          <p class="eyebrow">OVERDUE ENGINE</p>
          <h3>Automatic receivable reminders</h3>
          <p>Reads overdue invoices, routes each invoice to the responsible staff topic, and blocks duplicate reminders.</p>
        </div>
        <span class="status-pill ${active ? 'success' : 'pending'}">${active ? 'Active' : 'Paused'}</span>
      </div>
      <div class="detail-list">
        <div><span>Daily schedule</span><strong>${escapeHtml(scheduleTime)} • ${escapeHtml(timezone)}</strong></div>
        <div><span>Reminder days</span><strong>${days.map((d) => `Day ${escapeHtml(d)}`).join(' • ')}</strong></div>
        <div><span>Routing</span><strong>Invoice salesperson → Group Topic</strong></div>
        <div><span>Duplicate protection</span><strong>Enabled</strong></div>
      </div>
      <button id="runOverdueNow" class="btn primary" type="button">Run Overdue Check Now</button>
      <p id="overdueRunResult" class="hint">Manual runs use the same engine as the daily scheduler.</p>`;

    const button = document.getElementById('runOverdueNow');
    const resultBox = document.getElementById('overdueRunResult');
    button.addEventListener('click', async () => {
      setBusy(button, true, 'Checking…');
      resultBox.textContent = 'Scanning overdue invoices…';
      try {
        const data = await overdueCall();
        const r = data.result || {};
        resultBox.textContent = `Scanned ${r.scanned ?? 0} • Eligible ${r.eligible ?? 0} • Sent ${r.sent ?? 0} • Duplicate ${r.duplicate ?? 0} • Skipped ${r.skipped ?? 0} • Failed ${r.failed ?? 0}`;
        showToast(r.sent > 0 ? `${r.sent} overdue notification${r.sent === 1 ? '' : 's'} sent.` : 'Overdue check completed. No new reminders to send.', 'success');
        await bootstrap(false);
      } catch (error) {
        resultBox.textContent = error?.message || String(error);
        showToast(error?.message || String(error), 'error');
      } finally {
        setBusy(button, false);
      }
    });
  }

  const previousRenderOverview = renderOverview;
  renderOverview = function(){
    previousRenderOverview();
    ensureControls();
  };

  setTimeout(ensureControls, 0);
})();
