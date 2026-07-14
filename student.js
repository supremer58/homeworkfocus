(function () {
  const studentId = sessionStorage.getItem('hf-student-id');
  const studentName = sessionStorage.getItem('hf-student-name');
  if (!studentId) { window.location.href = 'index.html'; return; }

  document.getElementById('greeting').textContent = `Hi, ${studentName}!`;

  const summary = document.getElementById('assignmentSummary');

  async function loadStatus() {
    try {
      const [s, track] = await Promise.all([db.getStudent(studentId), db.getListeningTrack()]);
      const parts = [];
      if (s && s.readingTitle) parts.push(`📖 ${s.readingTitle}`);
      if (track && track.title) parts.push(`🎧 ${track.title}`);
      summary.textContent = parts.length ? `Homework: ${parts.join(' · ')}` : 'Pick reading or listening below to get started.';
    } catch (e) {
      summary.textContent = 'Could not reach the server. Check your internet connection.';
    }
  }

  loadStatus();
})();
