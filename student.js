(function () {
  const studentId = sessionStorage.getItem('hf-student-id');
  const studentName = sessionStorage.getItem('hf-student-name');
  if (!studentId) { window.location.href = 'index.html'; return; }

  document.getElementById('greeting').textContent = `Hi, ${studentName}!`;

  const readingBtn = document.getElementById('readingBtn');
  const listeningBtn = document.getElementById('listeningBtn');
  const summary = document.getElementById('assignmentSummary');

  function disableButton(btn, label) {
    btn.removeAttribute('href');
    btn.classList.remove('primary');
    btn.classList.add('ghost');
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
    btn.title = `${label} isn't assigned to you right now.`;
  }

  async function loadAssignment() {
    try {
      const a = await db.getEffectiveAssignment(studentId);
      if (!a) {
        summary.textContent = 'No homework assigned yet — check with your teacher.';
        disableButton(readingBtn, 'Reading homework');
        disableButton(listeningBtn, 'Listening homework');
        return;
      }
      summary.textContent = `Today's homework: ${a.title}`;
      readingBtn.href = 'reading.html';
      listeningBtn.href = 'listening.html';
      if (a.type === 'translation') {
        disableButton(listeningBtn, 'Listening homework');
      } else if (a.type === 'listening') {
        disableButton(readingBtn, 'Reading homework');
      }
    } catch (e) {
      summary.textContent = 'Could not reach the server. Check your internet connection.';
    }
  }

  loadAssignment();
})();
