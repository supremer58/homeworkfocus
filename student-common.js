// Shared logic for the dedicated reading.html and listening.html pages.
// expectedType is 'translation' (reading) or 'listening'.
function initHomeworkPage(expectedType) {
  const studentId = sessionStorage.getItem('hf-student-id');
  const studentName = sessionStorage.getItem('hf-student-name');
  if (!studentId) { window.location.href = 'index.html'; return; }

  document.getElementById('greeting').textContent = `Hi, ${studentName}!`;

  const timerBadge = document.getElementById('timerBadge');
  const timerDisplay = document.getElementById('timerDisplay');
  const progressFill = document.getElementById('progressFill');
  const progressLabel = document.getElementById('progressLabel');
  const doneBtn = document.getElementById('doneBtn');
  const doneMsg = document.getElementById('doneMsg');
  const doneHint = document.getElementById('doneHint');
  const toast = document.getElementById('toast');
  const mismatchCard = document.getElementById('mismatchCard');
  const taskCard = document.getElementById('taskCard');

  let completed = false;
  let targetMs = 15 * 60 * 1000;
  let requireMinTime = false;
  let hasPlayedAudio = false;
  let lastResetToken = 0;
  let lastSeenMsgCount = 0;

  const pausedBanner = document.getElementById('pausedBanner');
  const chatToggle = document.getElementById('chatToggle');
  const chatPanel = document.getElementById('chatPanel');
  const chatClose = document.getElementById('chatClose');
  const chatLog = document.getElementById('chatLog');
  const chatInput = document.getElementById('chatInput');
  const chatSendBtn = document.getElementById('chatSendBtn');
  let chatOpen = false;

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function fmt(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  function currentAnswerText() {
    const box = document.getElementById(expectedType === 'listening' ? 'listenAnswerBox' : 'answerBox');
    return box ? box.value : '';
  }

  function updateDoneGate() {
    if (completed) return;
    const reasons = [];
    if (requireMinTime && timer.getActiveMs() < targetMs) reasons.push('reach the suggested time');
    if (expectedType === 'listening' && !hasPlayedAudio) reasons.push('listen to the track at least once');
    doneBtn.disabled = reasons.length > 0;
    doneHint.textContent = reasons.length > 0 ? `Finish this first: ${reasons.join(' and ')}.` : '';
  }

  let idleSinceLocal = null;
  const timer = createActivityTimer({
    idleTimeoutMs: 6000,
    onTick: (ms) => {
      timerDisplay.textContent = fmt(ms);
      const pct = Math.min(100, Math.round((ms / targetMs) * 100));
      progressFill.style.width = pct + '%';
      progressLabel.textContent = pct >= 100 ? 'Suggested time reached — nice work!' : `${pct}% toward suggested time`;
      updateDoneGate();
    },
    onStateChange: (active) => {
      timerBadge.classList.toggle('paused', !active);
      idleSinceLocal = active ? null : new Date().toISOString();
    },
  });

  async function loadAssignment() {
    const a = await db.getEffectiveAssignment(studentId);

    if (!a || a.type !== expectedType) {
      taskCard.hidden = true;
      mismatchCard.hidden = false;
      timerBadge.hidden = true;
      return null;
    }
    mismatchCard.hidden = true;
    taskCard.hidden = false;
    timerBadge.hidden = false;

    if (a.targetMinutes) targetMs = a.targetMinutes * 60 * 1000;
    requireMinTime = !!a.requireMinTime;
    document.getElementById('assignmentTitle').textContent = a.title || 'Today\'s homework';

    if (expectedType === 'listening') {
      const audioEl = document.getElementById('audioTrack');
      audioEl.src = a.content;
      timer.watchMedia(audioEl);
      audioEl.addEventListener('ended', () => { hasPlayedAudio = true; updateDoneGate(); });
      document.getElementById('listenAnswerBox').addEventListener('input', saveProgressSoon);
    } else {
      document.getElementById('passageText').textContent = a.content || '';
      document.getElementById('answerBox').addEventListener('input', saveProgressSoon);
    }
    updateDoneGate();
    return a;
  }

  let saveTimeout = null;
  function saveProgressSoon() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveProgress, 1200);
  }

  async function saveProgress() {
    try {
      await db.saveActivity({
        id: studentId,
        activeMs: timer.getActiveMs(),
        isActive: timer.getIsActive(),
        completed,
        answerText: currentAnswerText(),
        taskType: expectedType,
        hasPlayedAudio,
        idleSince: idleSinceLocal,
      });
    } catch (e) { /* offline blip, will retry on next tick */ }
  }

  doneBtn.addEventListener('click', async () => {
    if (doneBtn.disabled) return;
    completed = true;
    doneBtn.disabled = true;
    doneMsg.textContent = 'Marked as done — nice work!';
    doneHint.textContent = '';
    showToast('🎉 Great job! Your teacher can see you finished.');
    await saveProgress();
  });

  async function resumePriorProgress() {
    try {
      const s = await db.getStudent(studentId);
      if (!s) return;
      if (s && typeof s.activeMs === 'number') {
        timer.setActiveMs(s.activeMs);
        timerDisplay.textContent = fmt(s.activeMs);
      }
      if (s && s.hasPlayedAudio) hasPlayedAudio = true;
      const priorAnswer = expectedType === 'listening' ? s.listeningAnswerText : s.readingAnswerText;
      if (s && priorAnswer) {
        const box = document.getElementById(expectedType === 'listening' ? 'listenAnswerBox' : 'answerBox');
        if (box && !box.value) box.value = priorAnswer;
      }
      if (s && s.completed) {
        completed = true;
        doneBtn.disabled = true;
        doneMsg.textContent = 'Marked as done — nice work!';
      }
      if (s && typeof s.resetToken === 'number') lastResetToken = s.resetToken;
      applyControl(s);
      updateDoneGate();
    } catch (e) { /* fresh start if this fails */ }
  }

  function applyControl(s) {
    if (!s) return;
    if (typeof s.resetToken === 'number' && s.resetToken !== lastResetToken) {
      lastResetToken = s.resetToken;
      timer.setActiveMs(0);
      timerDisplay.textContent = '00:00';
      progressFill.style.width = '0%';
      progressLabel.textContent = '0% toward suggested time';
      showToast('⏱ Your teacher reset your timer.');
      updateDoneGate();
    }
    timer.setTeacherPaused(!!s.paused);
    pausedBanner.hidden = !s.paused;
  }

  async function pollControl() {
    try {
      const s = await db.getStudent(studentId);
      applyControl(s);
    } catch (e) { /* ignore transient errors */ }
  }

  // ---- Chat ----
  function renderMessages(msgs) {
    if (msgs.length === 0) {
      chatLog.innerHTML = '<p class="hint" style="text-align:center; margin-top:20px;">No messages yet. Need help? Say hi!</p>';
      return;
    }
    chatLog.innerHTML = msgs.map((m) => {
      const mine = m.from === 'student';
      const who = mine ? 'You' : (m.fromName || 'Teacher');
      return `<div class="chat-bubble ${mine ? 'mine' : 'theirs'}"><span class="who">${who}</span>${escapeHtml(m.text)}</div>`;
    }).join('');
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  let lastSeenMsgCountInit = false;
  async function pollMessages() {
    try {
      const msgs = await db.getMessages(studentId);
      const teacherMsgCount = msgs.filter((m) => m.from === 'teacher').length;
      if (chatOpen) {
        renderMessages(msgs);
        lastSeenMsgCount = teacherMsgCount;
      } else if (!lastSeenMsgCountInit) {
        // First poll on a fresh page load: treat existing history as already seen,
        // don't flag it as new just because this page instance hasn't seen it yet.
        lastSeenMsgCount = teacherMsgCount;
      } else if (teacherMsgCount > lastSeenMsgCount) {
        chatToggle.classList.add('unread');
      }
      lastSeenMsgCountInit = true;
    } catch (e) { /* ignore */ }
  }

  chatToggle.addEventListener('click', () => {
    chatOpen = !chatPanel.hidden ? false : true;
    chatPanel.hidden = !chatOpen;
    if (chatOpen) {
      chatToggle.classList.remove('unread');
      pollMessages();
    }
  });
  chatClose.addEventListener('click', () => {
    chatOpen = false;
    chatPanel.hidden = true;
  });

  async function sendChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    await db.sendMessage({ studentId, from: 'student', fromName: studentName, text });
    pollMessages();
  }
  chatSendBtn.addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

  loadAssignment().then((a) => { if (a) resumePriorProgress(); });
  setInterval(saveProgress, 4000);
  setInterval(pollControl, 3000);
  setInterval(pollMessages, 3000);
  window.addEventListener('beforeunload', saveProgress);
}
