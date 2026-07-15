(function () {
  const studentId = sessionStorage.getItem('hf-student-id');
  const studentName = sessionStorage.getItem('hf-student-name');
  if (!studentId) { window.location.href = 'index.html'; return; }

  document.getElementById('greeting').textContent = `Hi, ${studentName}!`;

  const summary = document.getElementById('assignmentSummary');

  async function loadStatus() {
    try {
      const s = await db.getStudent(studentId);
      const parts = [];
      if (s && s.readingTitle) parts.push(`📖 ${s.readingTitle}`);
      if (s && s.listeningTitle) parts.push(`🎧 ${s.listeningTitle}`);
      summary.textContent = parts.length ? `Working on: ${parts.join(' · ')}` : 'Pick reading or listening below and give your work a title.';
    } catch (e) {
      summary.textContent = 'Could not reach the server. Check your internet connection.';
    }
  }

  loadStatus();
})();
