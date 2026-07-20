(function () {
  const saveMsg = document.getElementById('saveMsg');
  const roster = document.getElementById('roster');
  const joinInfo = document.getElementById('joinInfo');
  const toast = document.getElementById('toast');

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2600);
  }

  const joinUrl = `${window.location.origin}/`;
  joinInfo.textContent = `Students join at ${joinUrl}`;

  // ---- Classes ----
  const classSelect = document.getElementById('classSelect');
  let currentClassId = localStorage.getItem('hf-current-class-id') || '';
  let classesCache = [];

  async function loadClasses({ selectId } = {}) {
    classesCache = await db.getClasses();
    if (classesCache.length === 0) {
      const result = await db.createClass('My Class');
      if (result.error) {
        classSelect.innerHTML = '<option>Setup needed</option>';
        showToast('Could not load classes — the database may need an update. Contact support.');
        return;
      }
      classesCache = await db.getClasses();
      showToast(`Created "My Class" — PIN: ${result.pin}`);
    }
    if (classesCache.length === 0) return;
    if (selectId) currentClassId = selectId;
    if (!currentClassId || !classesCache.some((c) => c.id === currentClassId)) {
      currentClassId = classesCache[0].id;
    }
    localStorage.setItem('hf-current-class-id', currentClassId);
    classSelect.innerHTML = classesCache.map((c) => `<option value="${c.id}" ${c.id === currentClassId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
  }

  // ---- Realtime: react instantly to student joins/updates/messages ----
  // instead of waiting for the next poll. Polling stays as a slower
  // fallback in case the realtime connection drops.
  let realtimeChannel = null;
  function subscribeRealtime() {
    if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
    if (!currentClassId) return;
    realtimeChannel = supabaseClient
      .channel(`teacher-class-${currentClassId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students', filter: `class_id=eq.${currentClassId}` }, () => {
        refreshRoster();
        if (activeAnswerId) pollAnswer();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `class_id=eq.${currentClassId}` }, () => {
        refreshRoster();
        if (activeChatId) pollChat();
      })
      .subscribe();
  }

  classSelect.addEventListener('change', async () => {
    currentClassId = classSelect.value;
    localStorage.setItem('hf-current-class-id', currentClassId);
    closeAllPanels();
    await loadPin();
    await refreshRoster();
    subscribeRealtime();
  });

  document.getElementById('newClassBtn').addEventListener('click', async () => {
    const name = prompt('Name for the new class (e.g. "Period 3"):');
    if (!name || !name.trim()) return;
    const result = await db.createClass(name.trim());
    if (result.error) { showToast(`Could not create class: ${result.error}`); return; }
    await loadClasses({ selectId: result.id });
    await loadPin();
    await refreshRoster();
    subscribeRealtime();
    showToast(`"${name.trim()}" created — PIN: ${result.pin}`);
  });

  document.getElementById('renameClassBtn').addEventListener('click', async () => {
    const current = classesCache.find((c) => c.id === currentClassId);
    const name = prompt('New name for this class:', current ? current.name : '');
    if (!name || !name.trim()) return;
    await db.renameClass(currentClassId, name.trim());
    await loadClasses();
    showToast('Class renamed ✓');
  });

  function closeAllPanels() {
    answerPanel.hidden = true;
    chatPanel.hidden = true;
    trendPanel.hidden = true;
    activeAnswerId = null;
    activeChatId = null;
  }

  // ---- QR code ----
  const qrCard = document.getElementById('qrCard');
  document.getElementById('showQrBtn').addEventListener('click', async () => {
    qrCard.hidden = !qrCard.hidden;
    if (!qrCard.hidden) {
      document.getElementById('qrImg').src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(joinUrl)}`;
      document.getElementById('qrUrlText').textContent = joinUrl;
      const state = await db.getState(currentClassId);
      document.getElementById('qrPinText').textContent = state.pin || '';
    }
  });

  // ---- Copy invite ----
  document.getElementById('copyInviteBtn').addEventListener('click', async () => {
    const state = await db.getState(currentClassId);
    const text = `Join HomeworkFocus: ${joinUrl}\nPIN: ${state.pin || ''}`;
    try {
      await navigator.clipboard.writeText(text);
      showToast('📋 Copied! Paste it in Zoom chat, Classroom, anywhere.');
    } catch (e) {
      showToast('Could not copy — your browser may need clipboard permission.');
    }
  });

  // ---- Class PIN ----
  document.getElementById('savePinBtn').addEventListener('click', async () => {
    const pin = document.getElementById('pinField').value.trim();
    if (!pin) return;
    const result = await db.setClassPin(currentClassId, pin);
    if (result.error) {
      saveMsg.textContent = 'That PIN is already used by another class.';
      setTimeout(() => saveMsg.textContent = '', 3000);
      return;
    }
    saveMsg.textContent = 'Saved ✓';
    setTimeout(() => saveMsg.textContent = '', 2000);
  });

  async function loadPin() {
    const state = await db.getState(currentClassId);
    document.getElementById('pinField').value = state.pin || '';
  }

  // ---- Broadcast ----
  document.getElementById('broadcastBtn').addEventListener('click', async () => {
    const input = document.getElementById('broadcastInput');
    const text = input.value.trim();
    if (!text) return;
    await db.sendMessage({ classId: currentClassId, studentId: null, from: 'teacher', fromName: 'Teacher', text });
    input.value = '';
    document.getElementById('broadcastMsg').textContent = 'Sent to everyone ✓';
    setTimeout(() => document.getElementById('broadcastMsg').textContent = '', 2500);
  });

  document.getElementById('nudgeIdleBtn').addEventListener('click', async () => {
    if (currentIdleIds.length === 0) {
      showToast('🎉 No one is idle right now — everyone is on task or offline.');
      return;
    }
    const input = document.getElementById('broadcastInput');
    const text = input.value.trim() || "⏰ Just checking in — need help getting back on track?";
    await Promise.all(currentIdleIds.map((id) => db.sendMessage({ classId: currentClassId, studentId: id, from: 'teacher', fromName: 'Teacher', text })));
    input.value = '';
    document.getElementById('broadcastMsg').textContent = `Sent to ${currentIdleIds.length} idle student${currentIdleIds.length > 1 ? 's' : ''} ✓`;
    setTimeout(() => document.getElementById('broadcastMsg').textContent = '', 2500);
  });

  document.getElementById('clearRosterBtn').addEventListener('click', async () => {
    if (!confirm('Start a fresh session? Today\'s roster will be saved to the report, then cleared.')) return;
    await db.clearRoster(currentClassId);
    refreshRoster();
  });

  document.getElementById('downloadHistoryBtn').addEventListener('click', async () => {
    const history = await db.getHistory(currentClassId);
    if (!history.length) { showToast('No history yet — nothing to download.'); return; }
    const rows = [['Date', 'Name', 'Assignment', 'Active time (min)', 'Completed', 'Reading answer', 'Listening answer']];
    history.forEach(h => {
      rows.push([
        h.date, h.name, h.assignmentTitle,
        (Math.round((h.activeMs || 0) / 6000) / 10).toString(),
        h.completed ? 'Yes' : 'No',
        (h.readingAnswerText || '').replace(/\n/g, ' '),
        (h.listeningAnswerText || '').replace(/\n/g, ' '),
      ]);
    });
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `homeworkfocus-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  });

  function fmt(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  const ONLINE_TIMEOUT_MS = 10000;
  const HIDE_AFTER_OFFLINE_MS = 60000;
  const IDLE_ALERT_MS = 120000;
  const alertedIdle = new Set();
  let currentIdleIds = [];

  let viewedMsgCounts = {};
  try { viewedMsgCounts = JSON.parse(localStorage.getItem('hf-viewed-msg-counts') || '{}'); } catch (e) { /* ignore */ }
  function saveViewedMsgCounts() {
    try { localStorage.setItem('hf-viewed-msg-counts', JSON.stringify(viewedMsgCounts)); } catch (e) { /* ignore */ }
  }

  async function refreshRoster() {
    const [state, allMessages] = await Promise.all([
      db.getState(currentClassId),
      db.getMessages(currentClassId),
    ]);
    const msgCountsByStudent = {};
    allMessages.forEach((m) => {
      if (m.from === 'student' && m.studentId) msgCountsByStudent[m.studentId] = (msgCountsByStudent[m.studentId] || 0) + 1;
    });

    const students = state.students || {};
    const allEntries = Object.entries(students);
    renderAnswersGrid(allEntries);

    // Students who've been disconnected a while drop off the live list —
    // it goes back to "waiting for students" on its own, no manual reset
    // needed. Their time/answers stay intact for Reports and All Answers.
    const now = Date.now();
    const entries = allEntries.filter(([, s]) => (now - new Date(s.lastSeen).getTime()) < HIDE_AFTER_OFFLINE_MS);

    if (entries.length === 0) {
      roster.innerHTML = '<p class="hint" style="text-align:center; padding:20px 0;">🕐 Waiting for students to join — share the PIN or QR code above.</p>';
      document.getElementById('rosterSummary').textContent = '';
      currentIdleIds = [];
      return;
    }
    entries.sort((a, b) => a[1].name.localeCompare(b[1].name));

    let onlineCount = 0, workingCount = 0, doneCount = 0;
    currentIdleIds = [];

    roster.innerHTML = entries.map(([id, s]) => {
      const lastSeenMs = now - new Date(s.lastSeen).getTime();
      const online = lastSeenMs < ONLINE_TIMEOUT_MS;
      const isActive = s.isActive && online && !s.paused;
      if (online) onlineCount++;
      if (isActive) workingCount++;
      if (s.completed) doneCount++;

      const idleForMs = (online && !isActive && !s.paused && !s.completed && s.idleSince)
        ? now - new Date(s.idleSince).getTime() : 0;
      const idleTooLong = idleForMs > IDLE_ALERT_MS;
      if (idleTooLong && !alertedIdle.has(id)) {
        alertedIdle.add(id);
        playAlertBeep();
      } else if (!idleTooLong) {
        alertedIdle.delete(id);
      }
      if (idleTooLong && online) currentIdleIds.push(id);

      const hasUnreadMsg = (msgCountsByStudent[id] || 0) > (viewedMsgCounts[id] || 0);

      let badge, metaText, dotClass;
      if (!online) {
        badge = '<span class="badge offline">offline</span>';
        metaText = 'last seen ' + timeAgo(lastSeenMs);
        dotClass = 'offline';
      } else if (s.completed) {
        badge = '<span class="badge done">✓ done</span>';
        metaText = 'online';
        dotClass = 'online';
      } else if (s.paused) {
        badge = '<span class="badge idle">⏸ paused</span>';
        metaText = 'online, paused by you';
        dotClass = 'online';
      } else if (idleTooLong) {
        badge = `<span class="badge offline" style="background:#fde7e7; color:#c0392b;">⚠ idle ${Math.floor(idleForMs / 60000)}m</span>`;
        metaText = 'online, stuck or distracted?';
        dotClass = 'online';
      } else if (isActive) {
        badge = '<span class="badge working">● working</span>';
        metaText = 'online, actively working';
        dotClass = 'working';
      } else {
        badge = '<span class="badge idle">idle</span>';
        metaText = 'online, not working right now';
        dotClass = 'online';
      }

      return `
        <div class="roster-row ${isActive ? 'active' : ''} ${idleTooLong ? 'alert' : ''}">
          <div class="status-dot ${dotClass}"></div>
          <div class="name">${escapeHtml(s.name)}</div>
          <div class="meta">${metaText}</div>
          ${badge}
          <div class="time" title="Total active time">${fmt(s.activeMs || 0)}</div>
          <div class="row-actions">
            <button class="btn ghost small" data-action="answer" data-id="${id}" data-name="${escapeHtml(s.name)}" title="View their answer">📝</button>
            <button class="btn ghost small" data-action="${s.paused ? 'resume' : 'pause'}" data-id="${id}" title="${s.paused ? 'Resume timer' : 'Pause timer'}">${s.paused ? '▶' : '⏸'}</button>
            <button class="btn ghost small" data-action="reset" data-id="${id}" title="Reset timer">↺</button>
            <button class="btn ghost small chat-action ${hasUnreadMsg ? 'has-unread' : ''}" data-action="chat" data-id="${id}" data-name="${escapeHtml(s.name)}" title="Message ${escapeHtml(s.name)} privately${hasUnreadMsg ? ' (new message!)' : ''}">💬</button>
            <button class="btn ghost small" data-action="remove" data-id="${id}" data-name="${escapeHtml(s.name)}" title="Done reviewing — remove ${escapeHtml(s.name)}" style="color:#c0392b;">✕</button>
          </div>
        </div>`;
    }).join('');

    document.getElementById('rosterSummary').textContent =
      `${onlineCount}/${entries.length} online · ${workingCount} actively working · ${doneCount} done`;
  }

  const answersGrid = document.getElementById('answersGrid');
  const answerFilters = document.getElementById('answerFilters');
  let selectedAnswerId = 'all';

  function renderAnswersGrid(entries) {
    if (entries.length === 0) {
      answerFilters.innerHTML = '';
      answersGrid.innerHTML = '<p class="hint" style="text-align:center; padding:20px 0;">No one has written anything yet.</p>';
      return;
    }
    const sorted = [...entries].sort((a, b) => a[1].name.localeCompare(b[1].name));

    if (selectedAnswerId !== 'all' && !sorted.some(([id]) => id === selectedAnswerId)) {
      selectedAnswerId = 'all';
    }

    answerFilters.innerHTML = [
      `<button class="filter-pill ${selectedAnswerId === 'all' ? 'active' : ''}" data-filter-id="all">All (${sorted.length})</button>`,
      ...sorted.map(([id, s]) => `<button class="filter-pill ${selectedAnswerId === id ? 'active' : ''}" data-filter-id="${id}">${escapeHtml(s.name)}${s.completed ? ' ✓' : ''}</button>`),
    ].join('');

    const toShow = selectedAnswerId === 'all' ? sorted : sorted.filter(([id]) => id === selectedAnswerId);

    answersGrid.innerHTML = toShow.map(([id, s]) => {
      const reading = (s.readingAnswerText || '').trim();
      const listening = (s.listeningAnswerText || '').trim();
      const readingLabel = s.readingTitle ? `📖 Reading — ${escapeHtml(s.readingTitle)}` : '📖 Reading';
      const listeningLabel = s.listeningTitle ? `🎧 Listening — ${escapeHtml(s.listeningTitle)}` : '🎧 Listening';
      return `
        <div class="answer-card" id="answer-card-${id}">
          <div class="answer-card-head">
            <span class="name">${escapeHtml(s.name)}</span>
            <span class="hint" title="Total active time" style="font-variant-numeric: tabular-nums; font-weight:700;">⏱ ${fmt(s.activeMs || 0)}</span>
            ${s.completed ? '<span class="badge done">✓ done</span>' : ''}
            <button class="btn ghost small" data-action="answer-trend" data-id="${id}" data-name="${escapeHtml(s.name)}" title="See ${escapeHtml(s.name)}'s trend over time" style="margin-left:auto;">📈</button>
            <button class="btn ghost small chat-action" data-action="answer-chat" data-id="${id}" data-name="${escapeHtml(s.name)}" title="Message ${escapeHtml(s.name)} privately">💬</button>
            <button class="btn ghost small" data-action="answer-remove" data-id="${id}" data-name="${escapeHtml(s.name)}" title="Done reviewing — remove ${escapeHtml(s.name)}" style="color:#c0392b;">✕</button>
          </div>
          <div class="answer-block">
            <div class="answer-label">${readingLabel}</div>
            <div class="answer-text ${reading ? '' : 'empty'}">${reading ? escapeHtml(reading) : 'Nothing written yet'}</div>
          </div>
          <div class="answer-block">
            <div class="answer-label">${listeningLabel}</div>
            <div class="answer-text ${listening ? '' : 'empty'}">${listening ? escapeHtml(listening) : 'Nothing written yet'}</div>
          </div>
        </div>`;
    }).join('');
  }

  answerFilters.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-filter-id]');
    if (!btn) return;
    selectedAnswerId = btn.dataset.filterId;
    refreshRoster();
  });

  answersGrid.addEventListener('click', async (e) => {
    const chatBtn = e.target.closest('button[data-action="answer-chat"]');
    if (chatBtn) { openChat(chatBtn.dataset.id, chatBtn.dataset.name); return; }
    const trendBtn = e.target.closest('button[data-action="answer-trend"]');
    if (trendBtn) { openTrend(trendBtn.dataset.name); return; }
    const removeBtn = e.target.closest('button[data-action="answer-remove"]');
    if (removeBtn) {
      await db.removeStudent(removeBtn.dataset.id);
      showToast(`${removeBtn.dataset.name} removed ✓`);
      refreshRoster();
    }
  });

  function playAlertBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 660;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch (e) { /* audio not available, skip */ }
  }

  function timeAgo(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    return Math.floor(m / 60) + 'h ago';
  }

  roster.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (action === 'pause' || action === 'resume') {
      await db.control(id, action);
      refreshRoster();
    } else if (action === 'reset') {
      if (!confirm('Reset this student\'s timer to 00:00?')) return;
      await db.control(id, 'reset');
      refreshRoster();
    } else if (action === 'chat') {
      openChat(id, btn.dataset.name);
    } else if (action === 'answer') {
      openAnswer(id, btn.dataset.name);
    } else if (action === 'remove') {
      await db.removeStudent(id);
      showToast(`${btn.dataset.name} removed ✓`);
      refreshRoster();
    }
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  // ---- Answer viewer ----
  const answerPanel = document.getElementById('answerPanel');
  const answerWithName = document.getElementById('answerWithName');
  const answerBody = document.getElementById('answerBody');
  const answerClose = document.getElementById('answerClose');
  let activeAnswerId = null;

  async function pollAnswer() {
    if (!activeAnswerId) return;
    const s = await db.getStudent(activeAnswerId);
    if (!s) return;
    const reading = (s.readingAnswerText || '').trim();
    const listening = (s.listeningAnswerText || '').trim();
    const readingLabel = s.readingTitle ? `📖 Reading — ${escapeHtml(s.readingTitle)}` : '📖 Reading';
    const listeningLabel = s.listeningTitle ? `🎧 Listening — ${escapeHtml(s.listeningTitle)}` : '🎧 Listening';
    answerBody.innerHTML = `
      <div style="margin-bottom:18px;">
        <div class="hint" style="font-weight:700; margin-bottom:6px;">${readingLabel}</div>
        <div>${reading ? escapeHtml(reading) : '<span class="hint">(nothing written yet)</span>'}</div>
      </div>
      <div>
        <div class="hint" style="font-weight:700; margin-bottom:6px;">${listeningLabel}</div>
        <div>${listening ? escapeHtml(listening) : '<span class="hint">(nothing written yet)</span>'}</div>
      </div>`;
  }

  function openAnswer(id, name) {
    activeAnswerId = id;
    answerWithName.textContent = `📝 ${name}'s answers`;
    answerPanel.hidden = false;
    chatPanel.hidden = true;
    trendPanel.hidden = true;
    pollAnswer();
  }
  answerClose.addEventListener('click', () => {
    answerPanel.hidden = true;
    activeAnswerId = null;
  });

  // ---- Chat ----
  const chatPanel = document.getElementById('chatPanel');
  const chatWithName = document.getElementById('chatWithName');
  const chatLog = document.getElementById('chatLog');
  const chatInput = document.getElementById('chatInput');
  const chatSendBtn = document.getElementById('chatSendBtn');
  const chatClose = document.getElementById('chatClose');
  let activeChatId = null;
  let activeChatName = '';

  function renderMessages(msgs) {
    if (msgs.length === 0) {
      chatLog.innerHTML = `<p class="hint" style="text-align:center; margin-top:20px;">No messages yet — say hi to ${escapeHtml(activeChatName)}!</p>`;
      return;
    }
    chatLog.innerHTML = msgs.map((m) => {
      const mine = m.from === 'teacher';
      const who = mine ? 'You' : activeChatName;
      return `<div class="chat-bubble ${mine ? 'mine' : 'theirs'}"><span class="who">${who}</span>${escapeHtml(m.text)}</div>`;
    }).join('');
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  async function pollChat() {
    if (!activeChatId) return;
    const msgs = await db.getMessages(currentClassId, activeChatId);
    const mine = msgs.filter(m => m.studentId === activeChatId);
    renderMessages(mine);
    // Viewing the panel counts as reading everything currently in it.
    const studentMsgCount = mine.filter(m => m.from === 'student').length;
    if (studentMsgCount > (viewedMsgCounts[activeChatId] || 0)) {
      viewedMsgCounts[activeChatId] = studentMsgCount;
      saveViewedMsgCounts();
    }
  }

  function openChat(id, name) {
    activeChatId = id;
    activeChatName = name;
    chatWithName.textContent = `💬 ${name}`;
    chatPanel.hidden = false;
    answerPanel.hidden = true;
    trendPanel.hidden = true;
    pollChat();
  }

  chatClose.addEventListener('click', () => {
    chatPanel.hidden = true;
    activeChatId = null;
  });

  async function sendChat() {
    const text = chatInput.value.trim();
    if (!text || !activeChatId) return;
    chatInput.value = '';
    await db.sendMessage({ classId: currentClassId, studentId: activeChatId, from: 'teacher', fromName: 'Teacher', text });
    pollChat();
  }
  chatSendBtn.addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

  // ---- Trend (per-student history across sessions) ----
  const trendPanel = document.getElementById('trendPanel');
  const trendWithName = document.getElementById('trendWithName');
  const trendBody = document.getElementById('trendBody');
  const trendClose = document.getElementById('trendClose');

  function renderTrendChart(rows) {
    if (rows.length === 0) {
      return '<p class="hint" style="text-align:center; margin-top:20px;">No past sessions yet for this student — trends appear after "New session" is used at least once.</p>';
    }
    const w = 320, h = 160, pad = 28;
    const maxMin = Math.max(1, ...rows.map((r) => r.activeMs / 60000));
    const barW = (w - pad * 2) / rows.length;
    const bars = rows.map((r, i) => {
      const minutes = r.activeMs / 60000;
      const barH = Math.max(2, (minutes / maxMin) * (h - pad * 2));
      const x = pad + i * barW + barW * 0.15;
      const y = h - pad - barH;
      const color = r.completed ? 'var(--brand)' : '#b8bfd6';
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW * 0.7).toFixed(1)}" height="${barH.toFixed(1)}" rx="3" fill="${color}"><title>${escapeHtml(r.date)}: ${minutes.toFixed(1)} min${r.completed ? ' (done)' : ''}</title></rect>`;
    }).join('');
    const axisY = h - pad;
    return `
      <svg viewBox="0 0 ${w} ${h}" style="width:100%; height:auto; max-width:400px; display:block; margin:0 auto;">
        <line x1="${pad}" y1="${axisY}" x2="${w - pad}" y2="${axisY}" stroke="var(--border)" stroke-width="1" />
        ${bars}
      </svg>
      <p class="hint" style="text-align:center; margin-top:10px;">Active minutes per past session (darker = marked done). Hover a bar for the date.</p>`;
  }

  async function openTrend(name) {
    trendWithName.textContent = `📈 ${name}'s trend`;
    trendPanel.hidden = false;
    answerPanel.hidden = true;
    chatPanel.hidden = true;
    trendBody.innerHTML = '<p class="hint">Loading…</p>';
    const history = await db.getHistory(currentClassId);
    const rows = history
      .filter((h) => h.name.trim().toLowerCase() === name.trim().toLowerCase())
      .sort((a, b) => a.date.localeCompare(b.date));
    trendBody.innerHTML = renderTrendChart(rows);
  }

  trendClose.addEventListener('click', () => { trendPanel.hidden = true; });

  async function init() {
    await loadClasses();
    await loadPin();
    await refreshRoster();
    subscribeRealtime();
    setInterval(refreshRoster, 15000);
    setInterval(() => { if (activeChatId) pollChat(); }, 8000);
    setInterval(() => { if (activeAnswerId) pollAnswer(); }, 8000);
  }
  init();
})();
