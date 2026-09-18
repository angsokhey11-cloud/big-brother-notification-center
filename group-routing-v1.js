/* BIG BROTHER Notification Center — Telegram Group Topic Routing V2 */
(function(){
  'use strict';

  pages.staff = 'Telegram Group Topics';

  const originalRenderOverview = renderOverview;

  renderOverview = function(){
    originalRenderOverview();

    const bot = state.bot || {};
    const heroText = document.querySelector('.hero p:last-child');
    if (heroText && bot.connected === true) {
      heroText.textContent = `${bot.bot?.name || 'Telegram bot'}${bot.bot?.username ? ` (@${bot.bot.username})` : ''} is reachable. Group/topic routing is enabled and accounting write controls remain blocked.`;
    }

    const hint = document.getElementById('testMessageHint');
    if (hint) {
      hint.textContent = 'For an exact group topic test, open Group Topics and press Test on that mapping.';
    }
  };

  async function discoverTelegramTopics(button){
    const box = document.getElementById('topicDiscoveryResults');
    if (!box) return;
    setBusy(button, true, 'Checking…');
    box.textContent = 'Reading recent Telegram topic messages…';
    try {
      await ensureSession();
      const request = () => fetch(`${SUPABASE_URL}/functions/v1/bb-telegram-chat-id`, {
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
      const data = await parseResponse(response);
      const topics = Array.isArray(data.topics) ? [...data.topics].reverse() : [];
      box.innerHTML = '';
      if (!topics.length) {
        box.textContent = data.instructions || 'No recent forum topics detected. Send one message inside the exact topic and try again.';
        return;
      }
      const note = document.createElement('small');
      note.textContent = 'Tap the correct topic to fill Group Chat ID + Topic ID automatically.';
      box.appendChild(note);
      const list = document.createElement('div');
      list.style.display = 'grid';
      list.style.gap = '6px';
      list.style.marginTop = '8px';
      topics.forEach((topic) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn secondary';
        b.style.textAlign = 'left';
        const topicName = topic.topic_name || `Topic ${topic.thread_id}`;
        const groupName = topic.chat_title || String(topic.chat_id || 'Telegram group');
        const preview = topic.last_message_preview ? ` · ${topic.last_message_preview}` : '';
        b.textContent = `${groupName} → ${topicName} (#${topic.thread_id})${preview}`;
        b.addEventListener('click', () => {
          document.getElementById('mappingChatId').value = String(topic.chat_id || '');
          document.getElementById('mappingThreadId').value = String(topic.thread_id || '');
          const label = document.getElementById('mappingLabel');
          if (label && !label.value.trim()) label.value = topicName;
          showToast(`Selected ${topicName}.`, 'success');
        });
        list.appendChild(b);
      });
      box.appendChild(list);
    } catch (error) {
      box.textContent = error?.message || String(error);
    } finally {
      setBusy(button, false);
    }
  }
  openMappingDialog = function(existing = null){
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
          <div>
            <p class="eyebrow">TELEGRAM GROUP ROUTING</p>
            <h3>${existing ? 'Edit Group Topic' : 'Add Group Topic'}</h3>
            <p class="hint">Example: Group Chat ID <code>-1004317302923</code> and Topic ID <code>3</code>.</p>
          </div>
          <button type="button" class="icon-btn" id="mappingClose">×</button>
        </div>

        <form id="mappingForm" class="form-grid">
          <label>
            Responsible Staff
            <select id="mappingStaff" ${existing ? 'disabled' : ''} required>${options}</select>
          </label>

          <label>
            Route / Topic Type
            <select id="mappingDestination" ${existing ? 'disabled' : ''} required>
              <option value="AR" ${(existing?.destination_key || 'AR') === 'AR' ? 'selected' : ''}>A/R — Receivable</option>
              <option value="STOCK" ${existing?.destination_key === 'STOCK' ? 'selected' : ''}>STOCK — Stock & Calculator Report</option>
            </select>
          </label>

          <label>
            Group Chat ID
            <input id="mappingChatId" inputmode="numeric" value="${escapeHtml(existing?.telegram_chat_id || '')}" placeholder="-1004317302923" required />
          </label>

          <label>
            Topic ID
            <input id="mappingThreadId" inputmode="numeric" value="${escapeHtml(existing?.telegram_thread_id || '')}" placeholder="3" />
          </label>
          <div class="reminder-box" style="margin:0;grid-column:1/-1">
            <strong>Find Telegram Topic ID</strong>
            <small>Send one message inside the exact Telegram topic first, then discover recent topics.</small>
            <div style="margin-top:8px"><button type="button" class="btn secondary" id="discoverTopicsBtn">Discover Recent Topics</button></div>
            <div id="topicDiscoveryResults" style="margin-top:8px"></div>
          </div>

          <label>
            Topic Label
            <input id="mappingLabel" value="${escapeHtml(existing?.destination_label || '')}" placeholder="Dara Receivable Tracking" />
          </label>

          <div class="reminder-box" style="margin:0">
            <strong>How routing works</strong>
            <small>A/R alerts use the A/R mapping only. Stock and Calculator Reports use the STOCK mapping only. One staff member can have both routes in the same Telegram group with different Topic IDs.</small>
          </div>

          <label class="check-line"><input id="mappingActive" type="checkbox" ${existing?.active === false ? '' : 'checked'} /> Active</label>

          <div class="modal-actions">
            <button type="button" class="btn secondary" id="mappingCancel">Cancel</button>
            <button type="submit" class="btn primary" id="mappingSave">Save Group Topic</button>
          </div>
          <div class="form-error" id="mappingError"></div>
        </form>
      </div>`;

    document.body.appendChild(modal);

    const close = () => modal.remove();
    document.getElementById('mappingClose').addEventListener('click', close);
    document.getElementById('mappingCancel').addEventListener('click', close);
    document.getElementById('discoverTopicsBtn').addEventListener('click', (event) => discoverTelegramTopics(event.currentTarget));
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
          destination_key: existing?.destination_key || document.getElementById('mappingDestination').value,
          telegram_chat_id: document.getElementById('mappingChatId').value,
          telegram_thread_id: document.getElementById('mappingThreadId').value,
          destination_label: document.getElementById('mappingLabel').value,
          telegram_username: '',
          active: document.getElementById('mappingActive').checked,
        });

        close();
        showToast('Telegram group topic mapping saved.', 'success');
        await bootstrap(false);
      } catch (error) {
        errorBox.textContent = error?.message || String(error);
      } finally {
        setBusy(saveButton, false);
      }
    });
  };

  sendStaffTest = async function(staffId, destinationKey, button){
    setBusy(button, true, 'Sending…');
    try {
      await adminCall({ action: 'send_test', staff_id: staffId, destination_key: destinationKey });
      showToast('Test notification sent to the mapped Telegram topic.', 'success');
      await bootstrap(false);
    } catch (error) {
      showToast(error?.message || String(error), 'error');
    } finally {
      setBusy(button, false);
    }
  };

  renderStaff = function(){
    const page = document.getElementById('page-staff');
    const addButton = page?.querySelector('.section-head .btn.primary');
    const content = page?.querySelector('.empty-state, .staff-table-wrap');
    if (!page || !content) return;

    if (addButton) {
      addButton.disabled = false;
      addButton.title = '';
      addButton.textContent = 'Add Group Topic';
      addButton.onclick = () => openMappingDialog();
    }

    if (!state.links.length) {
      content.className = 'empty-state';
      content.innerHTML = `
        <div class="empty-icon">#</div>
        <h3>No group topic mappings yet</h3>
        <p>Map a responsible staff member to a Telegram group + topic to start team tracking.</p>`;
      return;
    }

    content.className = 'staff-table-wrap';
    content.innerHTML = `
      <div class="data-table">
        <div class="data-row data-head"><span>Responsible Staff</span><span>Route / Group Topic</span><span>Status</span><span>Actions</span></div>
        ${state.links.map((link) => {
          const topic = link.telegram_thread_id ? `Topic ${link.telegram_thread_id}` : 'Main group chat';
          const label = link.destination_label || topic;
          return `
            <div class="data-row" data-link-id="${escapeHtml(link.link_id)}">
              <span>
                <strong>${escapeHtml(link.staff?.staff_name || link.staff_id)}</strong>
                <small>${escapeHtml(link.staff?.staff_code || '')}</small>
              </span>
              <span>
                <strong>${escapeHtml(link.destination_key || 'AR')} · ${escapeHtml(label)}</strong>
                <small>${escapeHtml(link.telegram_chat_id_masked || '')} • ${escapeHtml(topic)}</small>
              </span>
              <span><span class="status-pill ${link.active ? 'success' : 'pending'}">${link.active ? 'Active' : 'Paused'}</span></span>
              <span class="row-actions">
                <button class="btn secondary mapping-test" type="button">Test Topic</button>
                <button class="btn secondary mapping-edit" type="button">Edit</button>
                <button class="btn secondary mapping-toggle" type="button">${link.active ? 'Pause' : 'Enable'}</button>
              </span>
            </div>`;
        }).join('')}
      </div>`;

    content.querySelectorAll('.data-row[data-link-id]').forEach((row) => {
      const linkId = String(row.dataset.linkId || '');
      const link = state.links.find((item) => String(item.link_id) === linkId);
      if (!link) return;
      const staffId = link.staff_id;
      const destinationKey = link.destination_key || 'AR';

      row.querySelector('.mapping-edit').addEventListener('click', () => openMappingDialog(link));
      row.querySelector('.mapping-test').addEventListener('click', (event) => sendStaffTest(staffId, destinationKey, event.currentTarget));
      row.querySelector('.mapping-toggle').addEventListener('click', async (event) => {
        const button = event.currentTarget;
        setBusy(button, true, 'Saving…');
        try {
          await adminCall({ action: 'set_mapping_active', staff_id: staffId, destination_key: destinationKey, active: !link.active });
          showToast(`${destinationKey} topic mapping ${link.active ? 'paused' : 'enabled'}.`, 'success');
          await bootstrap(false);
        } catch (error) {
          showToast(error?.message || String(error), 'error');
        } finally {
          setBusy(button, false);
        }
      });
    });
  };

  renderLogs = function(){
    const page = document.getElementById('page-logs');
    const content = page?.querySelector('.empty-state, .logs-table-wrap');
    if (!content) return;

    if (!state.logs.length) {
      content.className = 'empty-state';
      content.innerHTML = `
        <div class="empty-icon">≡</div>
        <h3>No Telegram topic deliveries logged yet</h3>
        <p>Send a Test Topic message and it will appear here.</p>`;
      return;
    }

    content.className = 'logs-table-wrap';
    content.innerHTML = `
      <div class="data-table logs-table">
        <div class="data-row log-row data-head"><span>Time</span><span>Event</span><span>Destination</span><span>Status</span></div>
        ${state.logs.map((log) => {
          const link = state.links.find((item) =>
            item.staff_id &&
            item.staff_id === log.staff_id &&
            String(item.telegram_thread_id || '') === String(log.telegram_thread_id || '')
          ) || state.links.find((item) => item.staff_id && item.staff_id === log.staff_id);
          const topicId = log.telegram_thread_id || link?.telegram_thread_id || null;
          const destination = link?.destination_label || (topicId ? `Topic ${topicId}` : 'Main group chat');
          return `
            <div class="data-row log-row">
              <span><strong>${escapeHtml(formatTime(log.sent_at || log.created_at))}</strong><small>#${escapeHtml(log.notification_id)}</small></span>
              <span><strong>${escapeHtml(log.event_key)}</strong><small>${escapeHtml(log.message_preview || log.entity_id || '')}</small></span>
              <span><strong>${escapeHtml(destination)}</strong><small>${escapeHtml(log.telegram_chat_id_masked || '')}${topicId ? ` • Topic ${escapeHtml(topicId)}` : ''}</small></span>
              <span><span class="status-pill ${log.status === 'sent' ? 'success' : 'pending'}">${escapeHtml(log.status)}</span>${log.error_message ? `<small class="log-error">${escapeHtml(log.error_message)}</small>` : ''}</span>
            </div>`;
        }).join('')}
      </div>`;
  };

  setTimeout(() => {
    bootstrap(false).catch(() => {});
  }, 0);
})();
