// Data layer backed by Supabase — replaces the old local-server REST API.
// Every function here mirrors what the old /api/* endpoints used to do.

function studentRowToClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    activeMs: row.active_ms,
    completed: row.completed,
    lastSeen: row.last_seen,
    joinedAt: row.joined_at,
    isActive: row.is_active,
    paused: row.paused,
    resetToken: row.reset_token,
    readingTitle: row.reading_title,
    listeningTitle: row.listening_title,
    readingAnswerText: row.reading_answer_text,
    listeningAnswerText: row.listening_answer_text,
    idleSince: row.idle_since,
  };
}

const db = {
  async join(name, pin) {
    const { data: settings } = await supabaseClient.from('app_settings').select('*').eq('id', 1).single();
    if (!settings || settings.pin !== pin) return { error: 'wrong-pin' };
    const id = (name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'student') + '-' + Math.floor(Math.random() * 9999);
    const { error } = await supabaseClient.from('students').insert({ id, name });
    if (error) return { error: error.message };
    return { id };
  },

  async getStudent(id) {
    const { data } = await supabaseClient.from('students').select('*').eq('id', id).maybeSingle();
    return studentRowToClient(data);
  },

  async saveActivity({ id, activeMs, isActive, completed, answerText, title, taskType, idleSince }) {
    const patch = { active_ms: activeMs, is_active: isActive, completed, last_seen: new Date().toISOString() };
    if (typeof idleSince !== 'undefined') patch.idle_since = idleSince;
    if (typeof answerText === 'string') {
      if (taskType === 'listening') patch.listening_answer_text = answerText;
      else patch.reading_answer_text = answerText;
    }
    await supabaseClient.from('students').update(patch).eq('id', id);

    if (typeof title === 'string') {
      const titlePatch = taskType === 'listening' ? { listening_title: title } : { reading_title: title };
      await supabaseClient.from('students').update(titlePatch).eq('id', id);
    }
  },

  async setPin(pin) {
    await supabaseClient.from('app_settings').update({ pin }).eq('id', 1);
  },

  async removeStudent(id) {
    const { data: s } = await supabaseClient.from('students').select('*').eq('id', id).maybeSingle();
    if (s) {
      await supabaseClient.from('history').insert({
        date: new Date().toISOString().slice(0, 10), student_id: s.id, name: s.name,
        assignment_title: [s.reading_title, s.listening_title].filter(Boolean).join(' / '),
        active_ms: s.active_ms, completed: s.completed,
        reading_answer_text: s.reading_answer_text, listening_answer_text: s.listening_answer_text,
      });
    }
    await supabaseClient.from('messages').delete().eq('student_id', id);
    await supabaseClient.from('students').delete().eq('id', id);
  },

  async clearRoster() {
    const { data: students } = await supabaseClient.from('students').select('*');
    const today = new Date().toISOString().slice(0, 10);
    const historyRows = (students || []).map((s) => ({
      date: today, student_id: s.id, name: s.name,
      assignment_title: [s.reading_title, s.listening_title].filter(Boolean).join(' / '),
      active_ms: s.active_ms, completed: s.completed,
      reading_answer_text: s.reading_answer_text, listening_answer_text: s.listening_answer_text,
    }));
    if (historyRows.length) await supabaseClient.from('history').insert(historyRows);
    await supabaseClient.from('students').delete().neq('id', '');
  },

  async getHistory() {
    const { data } = await supabaseClient.from('history').select('*').order('date', { ascending: false });
    return (data || []).map((h) => ({
      date: h.date, name: h.name, assignmentTitle: h.assignment_title,
      activeMs: h.active_ms, completed: h.completed,
      readingAnswerText: h.reading_answer_text, listeningAnswerText: h.listening_answer_text,
    }));
  },

  async control(id, action) {
    if (action === 'pause') await supabaseClient.from('students').update({ paused: true }).eq('id', id);
    else if (action === 'resume') await supabaseClient.from('students').update({ paused: false }).eq('id', id);
    else if (action === 'reset') {
      const { data: s } = await supabaseClient.from('students').select('reset_token').eq('id', id).maybeSingle();
      await supabaseClient.from('students').update({ active_ms: 0, reset_token: (s ? s.reset_token : 0) + 1 }).eq('id', id);
    }
  },

  async getMessages(studentId) {
    let query = supabaseClient.from('messages').select('*').order('ts', { ascending: true });
    if (studentId) query = query.or(`student_id.eq.${studentId},student_id.is.null`);
    const { data } = await query;
    return (data || []).map((m) => ({
      id: m.id, studentId: m.student_id, from: m.from_role, fromName: m.from_name, text: m.text, ts: m.ts,
    }));
  },

  async sendMessage({ studentId, from, fromName, text }) {
    await supabaseClient.from('messages').insert({ student_id: studentId, from_role: from, from_name: fromName, text });
  },

  async getState() {
    const [{ data: settings }, { data: studentRows }] = await Promise.all([
      supabaseClient.from('app_settings').select('*').eq('id', 1).single(),
      supabaseClient.from('students').select('*'),
    ]);
    const students = {};
    (studentRows || []).forEach((r) => { students[r.id] = studentRowToClient(r); });
    return { pin: settings ? settings.pin : '', students };
  },
};
