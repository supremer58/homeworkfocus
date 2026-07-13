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
    btn.title = `${label} hasn't been set up yet.`;
  }

  async function loadAssignments() {
    try {
      const [reading, listening] = await Promise.all([
        db.getEffectiveAssignment(studentId, 'translation'),
        db.getEffectiveAssignment(studentId, 'listening'),
      ]);

      const parts = [];
      if (reading) parts.push(`📖 ${reading.title}`);
      if (listening) parts.push(`🎧 ${listening.title}`);
      summary.textContent = parts.length ? `Today's homework: ${parts.join(' · ')}` : 'No homework set up yet — check with your teacher.';

      readingBtn.href = 'reading.html';
      listeningBtn.href = 'listening.html';
      if (!reading) disableButton(readingBtn, 'Reading homework');
      if (!listening) disableButton(listeningBtn, 'Listening homework');
    } catch (e) {
      summary.textContent = 'Could not reach the server. Check your internet connection.';
    }
  }

  loadAssignments();
})();
