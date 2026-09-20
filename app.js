const SUPABASE_URL = 'https://sjfhlaclgmkwwofzstok.supabase.co';
const SUPABASE_KEY = 'sb_publishable_w762jR65CWwlO30fKQsYOw_6L9grx8S';
const SESSION_KEY = 'BB_SUPABASE_DEV_SESSION_V1';
const ADMIN_FUNCTION = `${SUPABASE_URL}/functions/v1/bb-notification-admin`;

const pages = {
  overview: 'Notification Center',
  staff: 'Staff Telegram Mapping',
  customers: 'Customer Invoice Routing',
  invoiceQueue: 'Invoice Queue',
  arQueue: 'A/R Update Queue',
  rules: 'Notification Rules',
  logs: 'Delivery Logs',
};

const RULE_ORDER = [
  'overdue_invoice',
  'request_submitted',
  'request_approved',
  'request_rejected',
  'customer_invoice_share',
  'customer_ar_cleared',
];

const navItems = document.querySelectorAll('.nav-item');
const pageSections = document.querySelectorAll('.page');
const pageTitle = document.getElementById('pageTitle');
const refreshBtn = document.getElementById('refreshBtn');
const testMessageBtn = document.getElementById('testMessageBtn');
const toast = document.getElementById('toast');

let session = null;
let state = {
  bot: null,
  staff: [],
  customers: [],
  links: [],
  rules: [],
  settings: [],
  logs: [],
  invoiceJobs: [],
  arJobs: [],
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function showToast(message, kind = '') {
  toast.textContent = message;
  toast.className = `toast show${kind ? ` ${kind}` : ''}`;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.className = 'toast';
  }, 3600);
}

function setBusy(button, busy, busyText = 'Working…') {
  if (!button) return;
  if (busy) {
    button.dataset.oldText = button.textContent;
    button.disabled = true;
    button.textContent = busyText;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.oldText || button.textContent;
  }
}

function setPage(name) {
  navItems.forEach((item) => item.classList.toggle('active', item.dataset.page === name));
  pageSections.forEach((section) => section.classList.toggle('active', section.id === `page-${name}`));
  pageTitle.textContent = pages[name] || 'Notification Center';
  window.location.hash = name === 'overview' ? '' : name;
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch (_) {
    return null;
  }
}

function saveSession(value) {
  session = value || null;
  try {
    if (!value) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    if (!value.expires_at && value.expires_in) {
      value.expires_at = Math.floor(Date.now() / 1000) + Number(value.expires_in);
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  } catch (_) {}
}

async function parseResponse(response) {
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = { message: text };
  }
  if (!response.ok || data.success === false) {
    const error = new Error(data.message || data.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function signIn(email, password) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: String(email || '').trim(), password: String(password || '') }),
    cache: 'no-store',
  });
  const data = await parseResponse(response);
  saveSession(data);
  return data;
}

async function refreshSession() {
  const current = readSession();
  if (!current?.refresh_token) throw new Error('Please sign in to BIG BROTHER.');
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: current.refresh_token }),
    cache: 'no-store',
  });
  const data = await parseResponse(response);
  saveSession(data);
  return data;
}

async function ensureSession() {
  session = readSession();
  if (!session?.access_token) throw new Error('Please sign in to BIG BROTHER.');
  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at && Number(session.expires_at) < now + 45) {
    await refreshSession();
  }
  return session;
}

async function signOut() {
  const current = readSession();
  try {
    if (current?.access_token) {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${current.access_token}` },
        cache: 'no-store',
      });
    }
  } catch (_) {}
  saveSession(null);
  location.reload();
}

async function adminCall(payload, retry = true) {
  await ensureSession();
  const request = () => fetch(ADMIN_FUNCTION, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload || {}),
    cache: 'no-store',
  });

  let response = await request();
  if (response.status === 401 && retry) {
    await refreshSession();
    response = await request();
  }
  return parseResponse(response);
}

function installSignOutButton() {
  if (document.getElementById('signOutBtn')) return;
  const actions = document.querySelector('.topbar-actions');
  if (!actions) return;
  const button = document.createElement('button');
  button.id = 'signOutBtn';
  button.className = 'btn secondary';
  button.textContent = 'Sign Out';
  button.addEventListener('click', signOut);
  actions.appendChild(button);
}

function showLogin(message = '') {
  document.getElementById('authGate')?.remove();
  const gate = document.createElement('div');
  gate.id = 'authGate';
  gate.className = 'auth-gate';
  gate.innerHTML = `
    <form class="auth-card" id="authForm">
      <div class="brand-mark auth-logo">BB</div>
      <h2>BIG BROTHER Notification Center</h2>
      <p>Use the same BIG BROTHER account as the main Dashboard.</p>
      <label>Email</label>
      <input id="authEmail" type="email" autocomplete="username" required />
      <label>Password</label>
      <input id="authPassword" type="password" autocomplete="current-password" required />
      <button id="authSubmit" class="btn primary" type="submit">Sign In</button>
      <div id="authError" class="auth-error">${escapeHtml(message)}</div>
    </form>`;
  document.body.appendChild(gate);

  document.getElementById('authForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('authSubmit');
    const errorBox = document.getElementById('authError');
    errorBox.textContent = '';
    setBusy(button, true, 'Signing in…');
    try {
      await signIn(document.getElementById('authEmail').value, document.getElementById('authPassword').value);
      await bootstrap();
      gate.remove();
    } catch (error) {
      errorBox.textContent = error?.message || String(error);
    } finally {
      setBusy(button, false);
    }
  });
}

function showAccessDenied(message) {
  document.getElementById('authGate')?.remove();
  const gate = document.createElement('div');
  gate.id = 'authGate';
  gate.className = 'auth-gate';
  gate.innerHTML = `
    <div class="auth-card">
      <div class="brand-mark auth-logo">BB</div>
      <h2>Admin access required</h2>
      <p>${escapeHtml(message || 'This module is available to BIG BROTHER administrators only.')}</p>
      <button id="deniedSignOut" class="btn secondary" type="button">Sign Out</button>
    </div>`;
  document.body.appendChild(gate);
  document.getElementById('deniedSignOut').addEventListener('click', signOut);
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function ruleByKey(key) {
  return state.rules.find((rule) => rule.event_key === key) || null;
}

function renderOverview() {
  const bot = state.bot || {};
  const connected = bot.connected === true;
  const heroTitle = document.querySelector('.hero h2');
  const heroText = document.querySelector('.hero p:last-child');
  const heroBadge = document.querySelector('.hero-badge');
  const statCards = document.querySelectorAll('.stat-card strong');

  if (heroTitle) heroTitle.textContent = connected ? 'Telegram bot is connected' : 'Telegram bot needs attention';
  if (heroText) {
    heroText.textContent = connected
      ? `${bot.bot?.name || 'Telegram bot'}${bot.bot?.username ? ` (@${bot.bot.username})` : ''} is reachable. Notification-only security remains enforced.`
      : (bot.error || 'Telegram connection could not be verified.');
  }
  if (heroBadge) {
    heroBadge.innerHTML = `<span class="dot ${connected ? 'ok' : ''}"></span>${connected ? 'Connected' : 'Attention'}`;
  }
  if (statCards[0]) statCards[0].textContent = connected ? 'Connected' : 'Offline';
  if (statCards[2]) statCards[2].textContent = String(state.links.filter((link) => link.active).length);
  if (statCards[3]) statCards[3].textContent = String(state.logs.length);

  const botStatusPill = document.querySelector('#page-overview .section-card .status-pill');
  if (botStatusPill) {
    botStatusPill.textContent = connected ? 'Connected' : 'Attention';
    botStatusPill.className = `status-pill ${connected ? 'success' : 'pending'}`;
  }

  const hint = document.getElementById('testMessageHint');
  if (hint) {
    hint.textContent = bot.testChatConfigured
      ? 'Test messages use the secure Telegram test chat stored in Supabase Secrets.'
      : 'TELEGRAM_TEST_CHAT_ID is not configured.';
  }
}

function openMappingDialog(existing = null) {
  document.getElementById('mappingModal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'mappingModal';
  modal.className = 'modal-backdrop';
  const selectedId = existing?.staff_id || '';
  const options = state.staff
    .map((staff) => `<option value="${escapeHtml(staff.staff_id)}" ${staff.staff_id === selectedId ? 'selected' : ''}>${escapeHtml(staff.staff_name)} (${escapeHtml(staff.staff_code)})</option>`)
    .join('');
  modal.innerHTML = `
    <div class="modal-card">
      <div class="section-head">
        <div><p class="eyebrow">TELEGRAM STAFF</p><h3>${existing ? 'Edit Mapping' : 'Add Mapping'}</h3></div>
        <button type="button" class="icon-btn" id="mappingClose">×</button>
      </div>
      <form id="mappingForm" class="form-grid">
        <label>Staff<select id="mappingStaff" ${existing ? 'disabled' : ''} required>${options}</select></label>
        <label>Telegram Chat ID<input id="mappingChatId" inputmode="numeric" value="${escapeHtml(existing?.telegram_chat_id || '')}" placeholder="8802197264" required /></label>
        <label>Telegram Username (optional)<input id="mappingUsername" value="${escapeHtml(existing?.telegram_username || '')}" placeholder="username" /></label>
        <label class="check-line"><input id="mappingActive" type="checkbox" ${existing?.active === false ? '' : 'checked'} /> Active</label>
        <div class="modal-actions">
          <button type="button" class="btn secondary" id="mappingCancel">Cancel</button>
          <button type="submit" class="btn primary" id="mappingSave">Save Mapping</button>
        </div>
        <div class="form-error" id="mappingError"></div>
      </form>
    </div>`;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById('mappingClose').addEventListener('click', close);
  document.getElementById('mappingCancel').addEventListener('click', close);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });

  document.getElementById('mappingForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const saveButton = document.getElementById('mappingSave');
    const errorBox = document.getElementById('mappingError');
    errorBox.textContent = '';
    setBusy(saveButton, true, 'Saving…');
    try {
      await adminCall({
        action: 'save_mapping',
        staff_id: existing?.staff_id || document.getElementById('mappingStaff').value,
        telegram_chat_id: document.getElementById('mappingChatId').value,
        telegram_username: document.getElementById('mappingUsername').value,
        active: document.getElementById('mappingActive').checked,
      });
      close();
      showToast('Telegram staff mapping saved.', 'success');
      await bootstrap(false);
    } catch (error) {
      errorBox.textContent = error?.message || String(error);
    } finally {
      setBusy(saveButton, false);
    }
  });
}

async function sendStaffTest(staffId, button) {
  setBusy(button, true, 'Sending…');
  try {
    await adminCall({ action: 'send_test', staff_id: staffId });
    showToast('Test notification sent to staff Telegram.', 'success');
    await bootstrap(false);
  } catch (error) {
    showToast(error?.message || String(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

function renderStaff() {
  const page = document.getElementById('page-staff');
  const addButton = page?.querySelector('.section-head .btn.primary');
  const content = page?.querySelector('.empty-state, .staff-table-wrap');
  if (!page || !content) return;

  if (addButton) {
    addButton.disabled = false;
    addButton.title = '';
    addButton.onclick = () => openMappingDialog();
  }

  if (!state.links.length) {
    content.className = 'empty-state';
    content.innerHTML = `
      <div class="empty-icon">@</div>
      <h3>No staff Telegram mappings yet</h3>
      <p>Add the first staff mapping to begin routing notifications.</p>`;
    return;
  }

  content.className = 'staff-table-wrap';
  content.innerHTML = `
    <div class="data-table">
      <div class="data-row data-head"><span>Staff</span><span>Telegram</span><span>Status</span><span>Actions</span></div>
      ${state.links.map((link) => `
        <div class="data-row" data-staff-id="${escapeHtml(link.staff_id)}">
          <span><strong>${escapeHtml(link.staff?.staff_name || link.staff_id)}</strong><small>${escapeHtml(link.staff?.staff_code || '')}</small></span>
          <span><strong>${escapeHtml(link.telegram_username ? `@${link.telegram_username}` : 'Private chat')}</strong><small>${escapeHtml(link.telegram_chat_id_masked || '')}</small></span>
          <span><span class="status-pill ${link.active ? 'success' : 'pending'}">${link.active ? 'Active' : 'Paused'}</span></span>
          <span class="row-actions">
            <button class="btn secondary mapping-test" type="button">Test</button>
            <button class="btn secondary mapping-edit" type="button">Edit</button>
            <button class="btn secondary mapping-toggle" type="button">${link.active ? 'Pause' : 'Enable'}</button>
          </span>
        </div>`).join('')}
    </div>`;

  content.querySelectorAll('.data-row[data-staff-id]').forEach((row) => {
    const staffId = row.dataset.staffId;
    const link = state.links.find((item) => item.staff_id === staffId);
    row.querySelector('.mapping-edit').addEventListener('click', () => openMappingDialog(link));
    row.querySelector('.mapping-test').addEventListener('click', (event) => sendStaffTest(staffId, event.currentTarget));
    row.querySelector('.mapping-toggle').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      setBusy(button, true, 'Saving…');
      try {
        await adminCall({ action: 'set_mapping_active', staff_id: staffId, active: !link.active });
        showToast(`Mapping ${link.active ? 'paused' : 'enabled'}.`, 'success');
        await bootstrap(false);
      } catch (error) {
        showToast(error?.message || String(error), 'error');
      } finally {
        setBusy(button, false);
      }
    });
  });
}

function renderRules() {
  const inputs = document.querySelectorAll('#page-rules .rule-row input[type="checkbox"]');
  inputs.forEach((input, index) => {
    const key = RULE_ORDER[index];
    const rule = ruleByKey(key);
    input.disabled = false;
    input.checked = rule?.enabled !== false;
    input.onchange = async () => {
      input.disabled = true;
      try {
        await adminCall({
          action: 'save_rule',
          event_key: key,
          enabled: input.checked,
          config: rule?.config || {},
        });
        showToast('Notification rule updated.', 'success');
        await bootstrap(false);
      } catch (error) {
        input.checked = !input.checked;
        showToast(error?.message || String(error), 'error');
      } finally {
        input.disabled = false;
      }
    };
  });

  const overdue = ruleByKey('overdue_invoice');
  const days = Array.isArray(overdue?.config?.reminder_days) ? overdue.config.reminder_days : [1, 3, 7, 15, 30];
  const chips = document.querySelector('#page-rules .chips');
  if (chips) chips.innerHTML = days.map((day) => `<span>Day ${escapeHtml(day)}</span>`).join('');

  const reminderBox = document.querySelector('#page-rules .reminder-box');
  if (reminderBox && !document.getElementById('editReminderDays')) {
    const button = document.createElement('button');
    button.id = 'editReminderDays';
    button.className = 'btn secondary compact';
    button.type = 'button';
    button.textContent = 'Edit reminder days';
    button.addEventListener('click', async () => {
      const current = (Array.isArray(overdue?.config?.reminder_days) ? overdue.config.reminder_days : days).join(', ');
      const answer = prompt('Overdue reminder days, separated by commas:', current);
      if (answer === null) return;
      const reminderDays = [...new Set(answer.split(',').map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value >= 1 && value <= 365))].sort((a, b) => a - b);
      if (!reminderDays.length) {
        showToast('Enter at least one valid reminder day.', 'error');
        return;
      }
      setBusy(button, true, 'Saving…');
      try {
        await adminCall({ action: 'save_rule', event_key: 'overdue_invoice', enabled: overdue?.enabled !== false, config: { ...(overdue?.config || {}), reminder_days: reminderDays } });
        showToast('Overdue reminder days updated.', 'success');
        await bootstrap(false);
      } catch (error) {
        showToast(error?.message || String(error), 'error');
      } finally {
        setBusy(button, false);
      }
    });
    reminderBox.appendChild(button);
  }
}

function renderLogs() {
  const page = document.getElementById('page-logs');
  const content = page?.querySelector('.empty-state, .logs-table-wrap');
  if (!content) return;

  if (!state.logs.length) {
    content.className = 'empty-state';
    content.innerHTML = `
      <div class="empty-icon">≡</div>
      <h3>No Telegram deliveries logged yet</h3>
      <p>Send a test notification and it will appear here.</p>`;
    return;
  }

  content.className = 'logs-table-wrap';
  content.innerHTML = `
    <div class="data-table logs-table">
      <div class="data-row log-row data-head"><span>Time</span><span>Event</span><span>Recipient</span><span>Status</span></div>
      ${state.logs.map((log) => `
        <div class="data-row log-row">
          <span><strong>${escapeHtml(formatTime(log.sent_at || log.created_at))}</strong><small>#${escapeHtml(log.notification_id)}</small></span>
          <span><strong>${escapeHtml(log.event_key)}</strong><small>${escapeHtml(log.message_preview || log.entity_id || '')}</small></span>
          <span><strong>${escapeHtml(log.staff?.staff_name || 'Admin test chat')}</strong><small>${escapeHtml(log.telegram_chat_id_masked || '')}</small></span>
          <span><span class="status-pill ${log.status === 'sent' ? 'success' : 'pending'}">${escapeHtml(log.status)}</span>${log.error_message ? `<small class="log-error">${escapeHtml(log.error_message)}</small>` : ''}</span>
        </div>`).join('')}
    </div>`;
}

function renderAll() {
  renderOverview();
  renderStaff();
  renderRules();
  renderLogs();
  window.BBCustomerInvoiceRouting?.render?.();
  window.BBCustomerARRouting?.render?.();
  installSignOutButton();
}

async function bootstrap(showMessage = true) {
  refreshBtn.disabled = true;
  try {
    const data = await adminCall({ action: 'bootstrap' });
    state = {
      bot: data.bot || null,
      staff: Array.isArray(data.staff) ? data.staff : [],
      customers: Array.isArray(data.customers) ? data.customers : [],
      links: Array.isArray(data.links) ? data.links : [],
      rules: Array.isArray(data.rules) ? data.rules : [],
      settings: Array.isArray(data.settings) ? data.settings : [],
      logs: Array.isArray(data.logs) ? data.logs : [],
      invoiceJobs: Array.isArray(data.invoiceJobs) ? data.invoiceJobs : [],
      arJobs: Array.isArray(data.arJobs) ? data.arJobs : [],
    };
    renderAll();
    document.getElementById('authGate')?.remove();
    if (showMessage) showToast('Notification Center connected.', 'success');
  } catch (error) {
    if (error?.status === 403) {
      showAccessDenied(error.message);
    } else if (/sign in/i.test(error?.message || '') || error?.status === 401) {
      showLogin(error?.message || 'Please sign in to BIG BROTHER.');
    } else {
      showToast(error?.message || String(error), 'error');
    }
    throw error;
  } finally {
    refreshBtn.disabled = false;
  }
}

navItems.forEach((item) => {
  item.addEventListener('click', () => setPage(item.dataset.page));
});

refreshBtn.addEventListener('click', async () => {
  setBusy(refreshBtn, true, 'Refreshing…');
  try {
    await bootstrap(false);
    showToast('Live notification data refreshed.', 'success');
  } catch (_) {
  } finally {
    setBusy(refreshBtn, false);
  }
});

testMessageBtn.addEventListener('click', async () => {
  setBusy(testMessageBtn, true, 'Sending…');
  try {
    await adminCall({ action: 'send_test' });
    showToast('Telegram test notification sent.', 'success');
    await bootstrap(false);
  } catch (error) {
    showToast(error?.message || String(error), 'error');
  } finally {
    setBusy(testMessageBtn, false);
  }
});

const initialPage = window.location.hash.replace('#', '');
if (initialPage && pages[initialPage]) setPage(initialPage);

window.addEventListener('hashchange', () => {
  const name = window.location.hash.replace('#', '') || 'overview';
  if (pages[name]) setPage(name);
});

bootstrap(false).catch(() => {});
