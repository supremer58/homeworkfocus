// Data layer backed by Supabase — replaces the old local-server REST API.
// Every function here mirrors what the old /api/* endpoints used to do.

function rowsToMap(rows) {
  const map = {};
  (rows || []).forEach((r) => { map[r.id] = r; });
  return map;
}

function studentRowToClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    activeMs: row.active_ms,
    readingAssignmentId: row.reading_assignment_id,
    listeningAssignmentId: row.listening_assignment_id,
    completed: row.completed,
    lastSeen: row.last_seen,
    joinedAt: row.joined_at,
    isActive: row.is_active,
    paused: row.paused,
    resetToken: row.reset_token,
    readingAnswerText: row.reading_answer_text,
    listeningAnswerText: row.listening_answer_text,
    hasPlayedAudio: row.has_played_audio,
    idleSince: row.idle_since,
  };
}

function assignmentColumnFor(trackType) {
  return trackType === 'listening'
    ? { settingsCol: 'current_listening_assignment_id', studentCol: 'listening_assignment_id' }
    : { settingsCol: 'current_reading_assignment_id', studentCol: 'reading_assignment_id' };
}

function assignmentRowToClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    targetMinutes: row.target_minutes,
    requireMinTime: row.require_min_time,
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

  async saveActivity({ id, activeMs, isActive, completed, answerText, taskType, hasPlayedAudio, idleSince }) {
    const patch = { active_ms: activeMs, is_active: isActive, completed, last_seen: new Date().toISOString() };
    if (typeof idleSince !== 'undefined') patch.idle_since = idleSince;
    if (typeof answerText === 'string') {
      if (taskType === 'listening') patch.listening_answer_text = answerText;
      else patch.reading_answer_text = answerText;
    }
    if (typeof hasPlayedAudio === 'boolean') patch.has_played_audio = hasPlayedAudio;
    await supabaseClient.from('students').update(patch).eq('id', id);
  },

  async getEffectiveAssignment(studentId, trackType) {
    const { settingsCol, studentCol } = assignmentColumnFor(trackType);
    const { data: settings } = await supabaseClient.from('app_settings').select('*').eq('id', 1).single();
    let assignId = settings ? settings[settingsCol] : null;
    if (studentId) {
      const { data: s } = await supabaseClient.from('students').select(studentCol).eq('id', studentId).maybeSingle();
      if (s && s[studentCol]) assignId = s[studentCol];
    }
    if (!assignId) return null;
    const { data: a } = await supabaseClient.from('assignments').select('*').eq('id', assignId).maybeSingle();
    return assignmentRowToClient(a);
  },

  async getAssignments() {
    const { data: settings } = await supabaseClient.from('app_settings').select('*').eq('id', 1).single();
    const { data: rows } = await supabaseClient.from('assignments').select('*');
    const assignments = {};
    (rows || []).forEach((r) => { assignments[r.id] = assignmentRowToClient(r); });
    return {
      assignments,
      currentReadingAssignmentId: settings ? settings.current_reading_assignment_id : null,
      currentListeningAssignmentId: settings ? settings.current_listening_assignment_id : null,
    };
  },

  async saveAssignment(a) {
    const id = a.id || ('a-' + Date.now());
    await supabaseClient.from('assignments').upsert({
      id, type: a.type, title: a.title, content: a.content,
      target_minutes: a.targetMinutes, require_min_time: a.requireMinTime,
    });
    return { id };
  },

  async setDefaultAssignment(trackType, id) {
    const { settingsCol } = assignmentColumnFor(trackType);
    await supabaseClient.from('app_settings').update({ [settingsCol]: id }).eq('id', 1);
  },

  async assignStudent(studentId, trackType, assignmentId) {
    const { studentCol } = assignmentColumnFor(trackType);
    await supabaseClient.from('students').update({ [studentCol]: assignmentId }).eq('id', studentId);
  },

  async setPin(pin) {
    await supabaseClient.from('app_settings').update({ pin }).eq('id', 1);
  },

  async clearRoster() {
    const { data: students } = await supabaseClient.from('students').select('*');
    const { data: settings } = await supabaseClient.from('app_settings').select('*').eq('id', 1).single();
    const { data: assignmentRows } = await supabaseClient.from('assignments').select('*');
    const assignmentsById = rowsToMap(assignmentRows);
    const today = new Date().toISOString().slice(0, 10);
    const historyRows = (students || []).map((s) => {
      const readingId = s.reading_assignment_id || (settings ? settings.current_reading_assignment_id : null);
      const listeningId = s.listening_assignment_id || (settings ? settings.current_listening_assignment_id : null);
      const readingTitle = readingId && assignmentsById[readingId] ? assignmentsById[readingId].title : null;
      const listeningTitle = listeningId && assignmentsById[listeningId] ? assignmentsById[listeningId].title : null;
      const a = { title: [readingTitle, listeningTitle].filter(Boolean).join(' / ') };
      return {
        date: today, student_id: s.id, name: s.name,
        assignment_title: a ? a.title : '',
        active_ms: s.active_ms, completed: s.completed,
        reading_answer_text: s.reading_answer_text, listening_answer_text: s.listening_answer_text,
      };
    });
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
