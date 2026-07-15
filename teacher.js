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

  // ---- QR code ----
  const qrCard = document.getElementById('qrCard');
  document.getElementById('showQrBtn').addEventListener('click', async () => {
    qrCard.hidden = !qrCard.hidden;
    if (!qrCard.hidden) {
      document.getElementById('qrImg').src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(joinUrl)}`;
      document.getElementById('qrUrlText').textContent = joinUrl;
      const state = await db.getState();
      document.getElementById('qrPinText').textContent = state.pin || '';
    }
  });

  // ---- Copy invite ----
  document.getElementById('copyInviteBtn').addEventListener('click', async () => {
    const state = await db.getState();
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
    await db.setPin(pin);
    saveMsg.textContent = 'Saved ✓';
    setTimeout(() => saveMsg.textContent = '', 2000);
  });

  async function loadPin() {
    const state = await db.getState();
    document.getElementById('pinField').value = state.pin || '';
  }

  // ---- Broadcast ----
  document.getElementById('broadcastBtn').addEventListener('click', async () => {
    const input = document.getElementById('broadcastInput');
    const text = input.value.trim();
    if (!text) return;
    await db.sendMessage({ studentId: null, from: 'teacher', fromName: 'Teacher', text });
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
    await Promise.all(currentIdleIds.map((id) => db.sendMessage({ studentId: id, from: 'teacher', fromName: 'Teacher', text })));
    input.value = '';
    document.getElementById('broadcastMsg').textContent = `Sent to ${currentIdleIds.length} idle student${currentIdleIds.length > 1 ? 's' : ''} ✓`;
    setTimeout(() => document.getElementById('broadcastMsg').textContent = '', 2500);
  });

  document.getElementById('clearRosterBtn').addEventListener('click', async () => {
    if (!confirm('Start a fresh session? Today\'s roster will be saved to the report, then cleared. Assignments stay the same.')) return;
    await db.clearRoster();
    refreshRoster();
  });

  document.getElementById('downloadHistoryBtn').addEventListener('click', async () => {
    const history = await db.getHistory();
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
      db.getState(),
      db.getMessages(),
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
            <button class="btn ghost small chat-action" data-action="answer-chat" data-id="${id}" data-name="${escapeHtml(s.name)}" title="Message ${escapeHtml(s.name)} privately" style="margin-left:auto;">💬</button>
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
  let answerPollHandle = null;

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
    pollAnswer();
    clearInterval(answerPollHandle);
    answerPollHandle = setInterval(pollAnswer, 2500);
  }
  answerClose.addEventListener('click', () => {
    answerPanel.hidden = true;
    activeAnswerId = null;
    clearInterval(answerPollHandle);
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
  let chatPollHandle = null;

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
    const msgs = await db.getMessages(activeChatId);
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
    pollChat();
    clearInterval(chatPollHandle);
    chatPollHandle = setInterval(pollChat, 2500);
  }

  chatClose.addEventListener('click', () => {
    chatPanel.hidden = true;
    activeChatId = null;
    clearInterval(chatPollHandle);
  });

  async function sendChat() {
    const text = chatInput.value.trim();
    if (!text || !activeChatId) return;
    chatInput.value = '';
    await db.sendMessage({ studentId: activeChatId, from: 'teacher', fromName: 'Teacher', text });
    pollChat();
  }
  chatSendBtn.addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

  loadPin();
  refreshRoster();
  setInterval(refreshRoster, 2500);
})();
