(function () {
  const studentId = sessionStorage.getItem('hf-student-id');
  const studentName = sessionStorage.getItem('hf-student-name');
  if (!studentId) { window.location.href = 'index.html'; return; }

  document.getElementById('greeting').textContent = `Hi, ${studentName}!`;

  const REVISION_PREFIX = '🔄 Revision — ';
  const toast = document.getElementById('toast');
  const titleInput = document.getElementById('reviseTitle');
  const answerInput = document.getElementById('reviseAnswer');
  const sendBtn = document.getElementById('sendReviseBtn');
  const reviseMsg = document.getElementById('reviseMsg');
  const historyEl = document.getElementById('revisionHistory');

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2400);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  async function loadHistory() {
    const msgs = await db.getMessages(studentId);
    const revisions = msgs.filter((m) => m.from === 'student' && m.text.startsWith(REVISION_PREFIX));
    if (revisions.length === 0) {
      historyEl.innerHTML = '<p class="hint">Nothing sent yet.</p>';
      return;
    }
    historyEl.innerHTML = revisions.slice().reverse().map((m) => {
      const rest = m.text.slice(REVISION_PREFIX.length);
      const splitAt = rest.indexOf('\n\n');
      const title = splitAt === -1 ? rest : rest.slice(0, splitAt);
      const answer = splitAt === -1 ? '' : rest.slice(splitAt + 2);
      return `
        <div class="answer-card" style="margin-bottom:10px;">
          <div class="answer-card-head"><span class="name">${escapeHtml(title)}</span></div>
          <div class="answer-text">${escapeHtml(answer)}</div>
        </div>`;
    }).join('');
  }

  sendBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    const answer = answerInput.value.trim();
    if (!title) { reviseMsg.textContent = 'Add a title for what you\'re revising.'; return; }
    if (!answer) { reviseMsg.textContent = 'Write your corrected answer first.'; return; }

    sendBtn.disabled = true;
    await db.sendMessage({
      studentId, from: 'student', fromName: studentName,
      text: `${REVISION_PREFIX}${title}\n\n${answer}`,
    });
    titleInput.value = '';
    answerInput.value = '';
    reviseMsg.textContent = '';
    sendBtn.disabled = false;
    showToast('📤 Sent to your teacher!');
    loadHistory();
  });

  // ---- Chat (same as the homework pages) ----
  const chatToggle = document.getElementById('chatToggle');
  const chatPanel = document.getElementById('chatPanel');
  const chatClose = document.getElementById('chatClose');
  const chatLog = document.getElementById('chatLog');
  const chatInput = document.getElementById('chatInput');
  const chatSendBtn = document.getElementById('chatSendBtn');
  let chatOpen = false;
  let lastSeenMsgCount = 0;
  let lastSeenMsgCountInit = false;

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

  async function pollMessages() {
    try {
      const msgs = await db.getMessages(studentId);
      const teacherMsgCount = msgs.filter((m) => m.from === 'teacher').length;
      if (chatOpen) {
        renderMessages(msgs);
        lastSeenMsgCount = teacherMsgCount;
      } else if (!lastSeenMsgCountInit) {
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

  loadHistory();
  pollMessages();
  setInterval(pollMessages, 3000);
})();
