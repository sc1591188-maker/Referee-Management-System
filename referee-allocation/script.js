'use strict';
/* RefAssign: JavaScript only adds behaviour. The page structure is in index.html.
   Data (referees, availability, matches, assignments) is saved in localStorage. */

/* ===== 1. DATA ===== */
const KEY = 'refassign.simple.v1';
const CONTACT_PATTERN = /^(\S+@\S+\.\S+|\+?[\d\s-]{7,})$/; // email or phone number

function emptyData() {
  return { referees: [], availability: [], matches: [], assignments: [] };
}

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && saved.referees && saved.availability && saved.matches && saved.assignments) return saved;
  } catch (error) { /* broken data: start empty */ }
  return emptyData();
}

function saveData() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); }
  catch (error) { toast('Could not save data in this browser.', true); }
}

let data = loadData();
let confirmAction = null; // function to run when the confirm dialog is accepted
let autoPlan = [];        // proposed auto assignments waiting for confirmation

/* ===== 2. SMALL HELPERS ===== */
function $(selector) { return document.querySelector(selector); }

// Makes user text safe to put inside HTML
function esc(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function toMinutes(time) { const p = time.split(':'); return Number(p[0]) * 60 + Number(p[1]); }

function formatDate(date) {
  return new Date(date + 'T00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTime(time) {
  const p = time.split(':');
  return (p[0] % 12 || 12) + ':' + p[1] + (p[0] < 12 ? ' AM' : ' PM');
}

function formatStamp(iso) {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function startOf(match) { return new Date(match.date + 'T' + match.start); }
function endOf(match) { return new Date(match.date + 'T' + match.end); }
function byStartTime(a, b) { return startOf(a) - startOf(b); }

function findReferee(id) { return data.referees.find(function (r) { return r.id === id; }); }
function findMatch(id) { return data.matches.find(function (m) { return m.id === id; }); }
function matchName(match) { return match.id + ': ' + match.a + ' vs ' + match.b; }
function badge(text) { return '<span class="badge ' + text.toLowerCase() + '">' + text + '</span>'; }

function newId(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

// Suggests the next ID, e.g. R-001, R-002
function nextId(prefix, list) {
  let highest = 0;
  list.forEach(function (item) { highest = Math.max(highest, parseInt(item.id.slice(prefix.length)) || 0); });
  return prefix + String(highest + 1).padStart(3, '0');
}

// Assignments with status "Active" are the current ones; the rest are history
function activeAssignments() { return data.assignments.filter(function (a) { return a.status === 'Active'; }); }
function currentAssignment(matchId) { return activeAssignments().find(function (a) { return a.matchId === matchId; }); }

function matchStatus(match) {
  if (match.cancelled) return 'Cancelled';
  if (endOf(match) < new Date()) return 'Completed';
  return currentAssignment(match.id) ? 'Assigned' : 'Unassigned';
}

function toast(message, isError) {
  const box = document.createElement('div');
  box.className = 'toast' + (isError ? ' bad' : '');
  box.textContent = message;
  $('#toasts').appendChild(box);
  setTimeout(function () { box.remove(); }, 4000);
}

/* ===== 3. BUSINESS RULES ===== */

// Returns an error message, or null if the referee can take the match.
// Rules: referee exists and is active, qualified for the sport,
// free for the WHOLE match, and has no overlapping match on the same date.
function checkReferee(match, referee, assignments) {
  if (!referee || !findReferee(referee.id)) return 'Referee does not exist.';
  if (!referee.active) return referee.name + ' is inactive.';
  if (referee.sport !== match.sport) return referee.name + ' is qualified for ' + referee.sport + ', not ' + match.sport + '.';

  const available = data.availability.some(function (slot) {
    return slot.refId === referee.id && slot.date === match.date &&
      toMinutes(slot.start) <= toMinutes(match.start) && toMinutes(slot.end) >= toMinutes(match.end);
  });
  if (!available) {
    return referee.name + ' is not available for the whole match (' + formatTime(match.start) + ' to ' +
      formatTime(match.end) + ' on ' + formatDate(match.date) + ').';
  }

  // Overlap rule: newStart < existingEnd AND newEnd > existingStart (back-to-back is allowed)
  assignments = assignments || activeAssignments();
  for (let i = 0; i < assignments.length; i++) {
    const a = assignments[i];
    if (a.refId !== referee.id || a.matchId === match.id) continue;
    const other = findMatch(a.matchId);
    if (other && other.date === match.date &&
      toMinutes(match.start) < toMinutes(other.end) && toMinutes(match.end) > toMinutes(other.start)) {
      return referee.name + ' already has ' + other.id + ' (' + formatTime(other.start) + ' to ' +
        formatTime(other.end) + '), which overlaps this match.';
    }
  }
  return null;
}

// Saves an assignment. Returns an error message, or null on success.
// Reassigning keeps the old record in history with status "Reassigned".
function assignReferee(matchId, refId, isReassign) {
  const match = findMatch(matchId);
  const referee = findReferee(refId);
  const current = currentAssignment(matchId);

  if (!match) return 'Match not found.';
  if (match.cancelled) return 'This match is cancelled.';
  if (current && !isReassign) return 'This match already has a referee. Use Reassign instead.';
  if (current && current.refId === refId) return 'That referee is already assigned to this match.';

  const error = checkReferee(match, referee);
  if (error) return error;

  if (current) {
    current.status = 'Reassigned';
    current.note = 'Replaced by ' + referee.name;
  }
  data.assignments.push({
    id: newId('A-'), matchId: matchId, refId: refId,
    matchLabel: matchName(match), refName: referee.name,
    at: new Date().toISOString(), status: 'Active',
    note: current ? 'Reassigned from ' + current.refName : ''
  });
  saveData();
  return null;
}

function cancelAssignment(matchId, note) {
  const current = currentAssignment(matchId);
  if (current) { current.status = 'Cancelled'; current.note = note; }
}

// Runs a change, then re-checks every active assignment.
// If the change would break one, it is undone and an error message is returned.
function tryChange(change) {
  const backup = JSON.stringify(data);
  change();
  const list = activeAssignments();
  for (let i = 0; i < list.length; i++) {
    const match = findMatch(list[i].matchId);
    const error = match ? checkReferee(match, findReferee(list[i].refId)) : 'Match not found.';
    if (error) {
      data = JSON.parse(backup);
      return 'Change blocked: it would break the assignment for ' + list[i].matchId + '. ' + error;
    }
  }
  saveData();
  return null;
}

// Auto assign: give each unassigned match the eligible referee with the fewest assignments
function makeAutoPlan() {
  const working = activeAssignments().map(function (a) { return { matchId: a.matchId, refId: a.refId }; });
  const plan = [], failed = [];
  const unassigned = data.matches.filter(function (m) { return matchStatus(m) === 'Unassigned'; }).sort(byStartTime);

  unassigned.forEach(function (match) {
    const count = function (r) { return working.filter(function (a) { return a.refId === r.id; }).length; };
    const options = data.referees
      .filter(function (r) { return !checkReferee(match, r, working); })
      .sort(function (a, b) { return count(a) - count(b); });
    if (options.length) {
      plan.push({ match: match, referee: options[0] });
      working.push({ matchId: match.id, refId: options[0].id });
    } else {
      failed.push(match);
    }
  });
  return { plan: plan, failed: failed };
}

/* ===== 4. SHOWING DATA ===== */

// Fills a table body, or shows the empty message when there are no rows
function showRows(prefix, rows) {
  $('#' + prefix + 'Rows').innerHTML = rows.join('');
  $('#' + prefix + 'Table').hidden = rows.length === 0;
  const emptyMessage = $('#' + prefix + 'Empty'); // the review dialog has no empty message
  if (emptyMessage) emptyMessage.hidden = rows.length !== 0;
}

function button(action, id, label) {
  return '<button class="btn small" data-do="' + action + '" data-id="' + esc(id) + '">' + label + '</button>';
}

function includesText(text, search) { return !search || text.toLowerCase().includes(search.toLowerCase()); }

function renderDashboard() {
  const unassigned = data.matches.filter(function (m) { return matchStatus(m) === 'Unassigned'; }).sort(byStartTime);
  $('#statReferees').textContent = data.referees.length;
  $('#statMatches').textContent = data.matches.length;
  $('#statAssigned').textContent = data.matches.filter(function (m) { return matchStatus(m) === 'Assigned'; }).length;
  $('#statUnassigned').textContent = unassigned.length;
  $('#statUpcoming').textContent = data.matches.filter(function (m) { return !m.cancelled && startOf(m) >= new Date(); }).length;

  const recent = data.assignments.slice().reverse().slice(0, 5);
  $('#recentList').innerHTML = recent.map(function (a) {
    return '<li>' + esc(a.refName) + ' on ' + esc(a.matchLabel) + ' ' + badge(a.status) + '</li>';
  }).join('');
  $('#recentEmpty').hidden = recent.length > 0;

  const warnings = unassigned.slice(0, 5).map(function (m) {
    return '<li>' + esc(matchName(m)) + ' on ' + formatDate(m.date) + ' has no referee.</li>';
  });
  if (data.matches.length && !data.referees.some(function (r) { return r.active; })) {
    warnings.push('<li>No active referees are available.</li>');
  }
  $('#warnList').innerHTML = warnings.join('');
  $('#warnEmpty').hidden = warnings.length > 0;
}

function renderReferees() {
  const search = $('#refSearch').value, sport = $('#refSport').value, status = $('#refStatus').value;
  const rows = data.referees
    .filter(function (r) {
      return includesText(r.id + ' ' + r.name + ' ' + r.contact, search) &&
        (!sport || r.sport === sport) && (!status || (r.active ? 'Active' : 'Inactive') === status);
    })
    .map(function (r) {
      return '<tr><td>' + esc(r.id) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.contact) + '</td><td>' + esc(r.sport) +
        '</td><td>' + r.exp + ' yrs</td><td>' + badge(r.active ? 'Active' : 'Inactive') + '</td><td>' +
        button('editRef', r.id, 'Edit') + button('delRef', r.id, 'Delete') + '</td></tr>';
    });
  showRows('ref', rows);
}

function renderAvailability() {
  const search = $('#avSearch').value, date = $('#avDate').value;
  const rows = data.availability.slice()
    .sort(function (a, b) { return (a.date + a.start).localeCompare(b.date + b.start); })
    .filter(function (s) {
      const referee = findReferee(s.refId);
      return includesText(s.refId + ' ' + (referee ? referee.name : ''), search) && (!date || s.date === date);
    })
    .map(function (s) {
      const referee = findReferee(s.refId);
      return '<tr><td>' + esc(referee ? referee.name : s.refId) + ' <span class="muted">' + esc(s.refId) + '</span></td><td>' +
        formatDate(s.date) + '</td><td>' + formatTime(s.start) + '</td><td>' + formatTime(s.end) + '</td><td>' +
        button('editAv', s.id, 'Edit') + button('delAv', s.id, 'Delete') + '</td></tr>';
    });
  showRows('av', rows);
}

function renderMatches() {
  const search = $('#matchSearch').value, sport = $('#matchSport').value, status = $('#matchStatus').value;
  const rows = data.matches.slice().sort(byStartTime)
    .filter(function (m) {
      return includesText(m.id + ' ' + m.a + ' ' + m.b + ' ' + m.venue, search) &&
        (!sport || m.sport === sport) && (!status || matchStatus(m) === status);
    })
    .map(function (m) {
      const current = currentAssignment(m.id);
      const referee = current ? findReferee(current.refId) : null;
      return '<tr><td>' + esc(m.id) + '</td><td>' + esc(m.sport) + '</td><td>' + esc(m.a) + ' vs ' + esc(m.b) + '</td><td>' +
        formatDate(m.date) + '</td><td>' + formatTime(m.start) + ' to ' + formatTime(m.end) + '</td><td>' + esc(m.venue) +
        '</td><td>' + (current ? esc(referee ? referee.name : current.refName) : '-') + '</td><td>' + badge(matchStatus(m)) +
        '</td><td>' + button('editMatch', m.id, 'Edit') + button('delMatch', m.id, 'Delete') + '</td></tr>';
    });
  showRows('match', rows);
}

function renderAssignments() {
  // Dropdowns of the assign form
  const unassigned = data.matches.filter(function (m) { return matchStatus(m) === 'Unassigned'; }).sort(byStartTime);
  $('#assignMatch').innerHTML = unassigned.map(function (m) {
    return '<option value="' + esc(m.id) + '">' + esc(matchName(m)) + ', ' + formatDate(m.date) + ' ' + formatTime(m.start) + '</option>';
  }).join('') || '<option value="">No unassigned matches</option>';
  $('#assignRef').innerHTML = data.referees.map(function (r) {
    return '<option value="' + esc(r.id) + '">' + esc(r.name) + ' (' + esc(r.sport) + (r.active ? '' : ', inactive') + ')</option>';
  }).join('') || '<option value="">No referees</option>';

  // Current assignments
  const current = activeAssignments()
    .filter(function (a) { return findMatch(a.matchId); })
    .sort(function (a, b) { return byStartTime(findMatch(a.matchId), findMatch(b.matchId)); })
    .map(function (a) {
      const m = findMatch(a.matchId), referee = findReferee(a.refId);
      return '<tr><td>' + esc(matchName(m)) + '</td><td>' + formatDate(m.date) + ', ' + formatTime(m.start) + ' to ' + formatTime(m.end) +
        '</td><td>' + esc(referee ? referee.name : a.refName) + '</td><td>' +
        button('reassign', m.id, 'Reassign') + button('unassign', m.id, 'Unassign') + '</td></tr>';
    });
  showRows('current', current);

  // History: every event, newest first. Old events are greyed out.
  const search = $('#histSearch').value, status = $('#histStatus').value, date = $('#histDate').value;
  const history = data.assignments.slice().reverse()
    .filter(function (a) {
      const m = findMatch(a.matchId);
      return includesText(a.id + ' ' + a.refName + ' ' + a.matchLabel, search) &&
        (!status || a.status === status) && (!date || (m && m.date === date));
    })
    .map(function (a) {
      const m = findMatch(a.matchId);
      return '<tr class="' + (a.status === 'Active' ? '' : 'old') + '"><td>' + esc(a.id) + '</td><td>' + esc(a.matchLabel) +
        '</td><td>' + esc(a.refName) + '</td><td>' + (m ? formatDate(m.date) : 'Deleted') + '</td><td>' + formatStamp(a.at) +
        '</td><td>' + badge(a.status) + '</td><td>' + esc(a.note || (a.status === 'Active' ? 'Current assignment' : '')) + '</td></tr>';
    });
  showRows('hist', history);
}

function renderAll() {
  renderDashboard(); renderReferees(); renderAvailability(); renderMatches(); renderAssignments();
}

/* ===== 5. PAGES (sidebar navigation) ===== */
function showPage() {
  let name = location.hash.slice(1);
  const section = document.getElementById(name);
  if (!section || !section.classList.contains('page')) name = 'dashboard';
  document.querySelectorAll('.page').forEach(function (page) { page.classList.toggle('show', page.id === name); });
  document.querySelectorAll('.sidebar a').forEach(function (link) {
    link.classList.toggle('active', link.getAttribute('href') === '#' + name);
  });
  window.scrollTo(0, 0);
}

/* ===== 6. DIALOGS ===== */

// Opens a form dialog. "values" pre-fills the fields; "isEdit" locks the ID field.
function openForm(dialogId, title, values, isEdit) {
  const dialog = $(dialogId);
  const form = dialog.querySelector('form');
  form.reset();
  form.querySelector('.error').textContent = '';
  dialog.querySelector('.dialog-title').textContent = title;
  for (const name in values) { if (form.elements[name]) form.elements[name].value = values[name]; }
  if (form.elements.editing) form.elements.editing.value = isEdit ? '1' : '';
  if (form.elements.id && form.elements.id.type !== 'hidden') form.elements.id.readOnly = isEdit;
  dialog.showModal();
}

function askConfirm(message, action) {
  confirmAction = action;
  $('#confirmText').innerHTML = message;
  $('#confirmDialog').showModal();
}

// Each save function returns an error message, or null when saved
function saveReferee(v) {
  const id = v.id.trim(), name = v.name.trim(), contact = v.contact.trim(), exp = Number(v.exp);
  const editing = v.editing === '1';
  if (!id || !name) return 'Referee ID and full name are required.';
  if (!editing && data.referees.some(function (r) { return r.id.toLowerCase() === id.toLowerCase(); })) return 'This referee ID already exists.';
  if (!CONTACT_PATTERN.test(contact)) return 'Enter a valid email address or phone number.';
  if (!(exp >= 0 && exp <= 60)) return 'Experience must be between 0 and 60 years.';
  const record = { id: id, name: name, contact: contact, sport: v.sport, exp: exp, active: v.active === '1' };
  return tryChange(function () {
    if (editing) Object.assign(findReferee(id), record); else data.referees.push(record);
  });
}

function saveAvailability(v) {
  const editing = v.editing === '1';
  if (!v.refId) return 'Choose a referee.';
  if (!v.date || !v.start || !v.end) return 'Date, start time and end time are required.';
  if (toMinutes(v.end) <= toMinutes(v.start)) return 'End time must be after the start time.';
  const overlap = data.availability.some(function (s) {
    return s.id !== v.id && s.refId === v.refId && s.date === v.date &&
      toMinutes(v.start) < toMinutes(s.end) && toMinutes(v.end) > toMinutes(s.start);
  });
  if (overlap) return 'This overlaps another availability slot for the same referee.';
  const record = { id: editing ? v.id : newId('V-'), refId: v.refId, date: v.date, start: v.start, end: v.end };
  return tryChange(function () {
    if (editing) Object.assign(data.availability.find(function (s) { return s.id === v.id; }), record);
    else data.availability.push(record);
  });
}

function saveMatch(v) {
  const id = v.id.trim(), a = v.a.trim(), b = v.b.trim(), venue = v.venue.trim();
  const editing = v.editing === '1';
  if (!id || !a || !b || !venue || !v.date || !v.start || !v.end) return 'Fill in every field.';
  if (!editing && findMatch(id)) return 'This match ID already exists.';
  if (a.toLowerCase() === b.toLowerCase()) return 'Team A and Team B must be different.';
  if (toMinutes(v.end) <= toMinutes(v.start)) return 'End time must be after the start time.';
  const record = { id: id, sport: v.sport, a: a, b: b, date: v.date, start: v.start, end: v.end, venue: venue, cancelled: v.state === '1' };
  return tryChange(function () {
    if (record.cancelled) cancelAssignment(id, 'Match cancelled'); // a cancelled match keeps no referee
    if (editing) Object.assign(findMatch(id), record); else data.matches.push(record);
  });
}

/* ===== 7. SAMPLE DATA ===== */
function loadSample() {
  data = emptyData();
  const day = function (n) { return new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA'); }; // YYYY-MM-DD

  const people = [
    ['R-001', 'Arjun Mehta', 'arjun.mehta@example.com', 'Football', 8, true],
    ['R-002', 'Priya Sharma', '+91 98765 43210', 'Football', 5, true],
    ['R-003', 'Daniel Okoye', 'daniel.okoye@example.com', 'Basketball', 6, true],
    ['R-004', 'Sofia Alvarez', 'sofia.alvarez@example.com', 'Cricket', 10, true],
    ['R-005', 'Karan Singh', '+91 91234 56780', 'Football', 2, false],
    ['R-006', 'Mei Tanaka', 'mei.tanaka@example.com', 'Basketball', 4, true]
  ];
  people.forEach(function (p) {
    data.referees.push({ id: p[0], name: p[1], contact: p[2], sport: p[3], exp: p[4], active: p[5] });
  });

  const slots = [['R-001', 1, '08:00', '14:00'], ['R-002', 1, '09:00', '12:00'], ['R-005', 1, '08:00', '18:00'],
  ['R-003', 2, '10:00', '16:00'], ['R-006', 2, '10:00', '12:00'], ['R-004', 3, '09:00', '17:00']];
  slots.forEach(function (s, i) {
    data.availability.push({ id: 'V-S' + i, refId: s[0], date: day(s[1]), start: s[2], end: s[3] });
  });

  const games = [
    ['M-001', 'Football', 'Lions', 'Tigers', 1, '10:00', '11:30', 'Central Stadium'],
    ['M-002', 'Football', 'Eagles', 'Wolves', 1, '11:30', '13:00', 'Central Stadium'],   // back-to-back with M-001
    ['M-003', 'Basketball', 'Hawks', 'Bulls', 2, '10:00', '11:00', 'City Arena'],
    ['M-004', 'Basketball', 'Raptors', 'Suns', 2, '10:30', '11:30', 'City Arena'],     // overlaps M-003
    ['M-005', 'Cricket', 'Royals', 'Knights', 3, '10:00', '16:00', 'Riverside Ground'],
    ['M-006', 'Football', 'Rovers', 'United', -2, '15:00', '16:30', 'North Field']     // already played
  ];
  games.forEach(function (g) {
    data.matches.push({ id: g[0], sport: g[1], a: g[2], b: g[3], date: day(g[4]), start: g[5], end: g[6], venue: g[7], cancelled: false });
  });

  assignReferee('M-001', 'R-001');
  assignReferee('M-002', 'R-001');
  assignReferee('M-003', 'R-003');
  saveData(); renderAll(); toast('Sample data loaded.');
}

/* ===== 8. BUTTON CLICKS (data-do="name" runs actions[name]) ===== */
const actions = {
  closeDialog: function (id, button) { button.closest('dialog').close(); },
  confirmYes: function () { const run = confirmAction; $('#confirmDialog').close(); if (run) run(); },

  // Navbar
  sample: function () {
    if (data.referees.length || data.matches.length) askConfirm('Replace all current data with the demo data?', loadSample);
    else loadSample();
  },
  reset: function () {
    askConfirm('Delete ALL referees, availability, matches and history? This cannot be undone.', function () {
      data = emptyData(); saveData(); renderAll(); toast('All data cleared.');
    });
  },
  rate: function () {
    const form = $('#rateForm');
    form.reset();                                // clear any earlier stars
    form.querySelector('.error').textContent = '';
    $('#rateDialog').showModal();
  },

  // Referees
  addRef: function () { openForm('#refDialog', 'Add referee', { id: nextId('R-', data.referees), active: '1', exp: 0 }, false); },
  editRef: function (id) {
    const r = findReferee(id);
    openForm('#refDialog', 'Edit referee', Object.assign({}, r, { active: r.active ? '1' : '0' }), true);
  },
  delRef: function (id) {
    if (activeAssignments().some(function (a) { return a.refId === id; })) {
      return toast('Unassign this referee from their matches first.', true);
    }
    askConfirm('Delete ' + esc(findReferee(id).name) + '? Their availability is removed; assignment history is kept.', function () {
      data.referees = data.referees.filter(function (r) { return r.id !== id; });
      data.availability = data.availability.filter(function (s) { return s.refId !== id; });
      saveData(); renderAll(); toast('Referee deleted.');
    });
  },

  // Availability
  addAv: function () {
    if (!data.referees.length) return toast('Add a referee first.', true);
    fillRefereeSelect('#avRefSelect', '');
    openForm('#avDialog', 'Add availability', {}, false);
  },
  editAv: function (id) {
    const slot = data.availability.find(function (s) { return s.id === id; });
    fillRefereeSelect('#avRefSelect', '');
    openForm('#avDialog', 'Edit availability', slot, true);
  },
  delAv: function (id) {
    askConfirm('Delete this availability slot?', function () {
      const error = tryChange(function () { data.availability = data.availability.filter(function (s) { return s.id !== id; }); });
      renderAll();
      if (error) toast(error, true); else toast('Availability deleted.');
    });
  },

  // Matches
  addMatch: function () { openForm('#matchDialog', 'Add match', { id: nextId('M-', data.matches), state: '0' }, false); },
  editMatch: function (id) {
    const m = findMatch(id);
    openForm('#matchDialog', 'Edit match', Object.assign({}, m, { state: m.cancelled ? '1' : '0' }), true);
  },
  delMatch: function (id) {
    askConfirm('Delete match ' + esc(id) + '? Any current assignment will be cancelled in the history.', function () {
      cancelAssignment(id, 'Match deleted');
      data.matches = data.matches.filter(function (m) { return m.id !== id; });
      saveData(); renderAll(); toast('Match deleted.');
    });
  },

  // Assignments
  reassign: function (matchId) {
    const current = currentAssignment(matchId);
    const others = data.referees.filter(function (r) { return r.id !== current.refId; });
    if (!others.length) return toast('There is no other referee to choose.', true);
    fillRefereeSelect('#reassignSelect', current.refId);
    $('#reassignMatchName').textContent = matchName(findMatch(matchId));
    openForm('#reassignDialog', 'Reassign referee', { matchId: matchId }, false);
  },
  unassign: function (matchId) {
    askConfirm('Remove the referee from this match?', function () {
      cancelAssignment(matchId, 'Unassigned by organizer');
      saveData(); renderAll(); toast('Referee unassigned.');
    });
  },
  autoAssign: function () {
    const result = makeAutoPlan();
    if (!result.plan.length && !result.failed.length) return toast('There are no unassigned matches.');
    autoPlan = result.plan;
    showRows('auto', result.plan.map(function (p) {
      return '<tr><td>' + esc(matchName(p.match)) + '</td><td>' + formatDate(p.match.date) + ', ' + formatTime(p.match.start) +
        '</td><td>' + esc(p.referee.name) + '</td></tr>';
    }));
    $('#autoFailList').innerHTML = result.failed.map(function (m) { return '<li>' + esc(matchName(m)) + '</li>'; }).join('');
    $('#autoFail').hidden = result.failed.length === 0;
    $('#autoOkBtn').hidden = result.plan.length === 0;
    $('#autoDialog').showModal();
  },
  autoOk: function () {
    let done = 0;
    autoPlan.forEach(function (p) { if (!assignReferee(p.match.id, p.referee.id)) done++; });
    $('#autoDialog').close(); renderAll();
    toast(done + ' match' + (done === 1 ? '' : 'es') + ' assigned.');
  }
};

// Fills a referee dropdown, leaving out one referee if "skipId" is given
function fillRefereeSelect(selector, skipId) {
  $(selector).innerHTML = data.referees
    .filter(function (r) { return r.id !== skipId; })
    .map(function (r) { return '<option value="' + esc(r.id) + '">' + esc(r.name) + ' (' + esc(r.id) + ')</option>'; })
    .join('');
}

document.addEventListener('click', function (event) {
  const target = event.target.closest('[data-do]');
  if (target && actions[target.dataset.do]) actions[target.dataset.do](target.dataset.id, target);
});

/* ===== 9. FORMS ===== */
document.addEventListener('submit', function (event) {
  event.preventDefault();
  const form = event.target;

  // The assign form on the Assignments page
  if (form.id === 'assignForm') {
    const matchId = $('#assignMatch').value, refId = $('#assignRef').value;
    const error = !matchId || !refId ? 'Choose a match and a referee.' : assignReferee(matchId, refId);
    $('#assignError').textContent = error || '';
    if (!error) { renderAll(); toast('Referee assigned.'); }
    return;
  }

  // The star rating form: a star must be chosen, then we say thanks
  if (form.id === 'rateForm') {
    if (!new FormData(form).get('rating')) {
      form.querySelector('.error').textContent = 'Please choose a star rating.';
      return;
    }
    form.closest('dialog').close();
    toast('Thanks for your feedback');
    return;
  }

  // The forms inside dialogs
  const savers = {
    refForm: saveReferee,
    avForm: saveAvailability,
    matchForm: saveMatch,
    reassignForm: function (v) { return assignReferee(v.matchId, v.refId, true); }
  };
  const error = savers[form.id](Object.fromEntries(new FormData(form)));
  if (error) {
    form.querySelector('.error').textContent = error;
  } else {
    form.closest('dialog').close(); renderAll(); toast('Saved.');
  }
});

/* ===== 10. SEARCH AND FILTER BOXES ===== */
const filters = {
  refSearch: renderReferees, refSport: renderReferees, refStatus: renderReferees,
  avSearch: renderAvailability, avDate: renderAvailability,
  matchSearch: renderMatches, matchSport: renderMatches, matchStatus: renderMatches,
  histSearch: renderAssignments, histStatus: renderAssignments, histDate: renderAssignments
};
document.addEventListener('input', function (event) {
  if (filters[event.target.id]) filters[event.target.id]();
});

/* ===== 11. START ===== */
window.addEventListener('hashchange', showPage);
showPage();
renderAll();