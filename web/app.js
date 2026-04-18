(() => {
  'use strict';

  const STORAGE_KEY = 'seatingSystemState.v1';

  const el = {};
  const state = {
    classroom: null,
    students: [],
    arrangement: null,
    rules: null,
    api: {
      online: false,
      exports: { pdf: false, xlsx: false },
    },
    server_eval: null, // {score, max_score, violations, by_type} from last Python run
    ui: {
      empty_mode: false,
      lock_mode: false,
      selected_student_id: null,
      selected_seat: null, // [row, col]
      engine: 'browser', // browser | python
    },
    history: {
      undo: [],
      redo: [],
    },
    status_message: '',
  };

  function deepClone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function clampInt(value, min, max) {
    const n = parseInt(value, 10);
    if (Number.isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function normalizeGender(raw) {
    const v = String(raw ?? '').trim().toLowerCase();
    if (v === '男' || v === 'm' || v === 'male' || v === 'man' || v === 'boy') return '男';
    if (v === '女' || v === 'f' || v === 'female' || v === 'woman' || v === 'girl') return '女';
    return '男';
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function seatKey(row, col) {
    return `${row},${col}`;
  }

  function sameSeat(a, b) {
    return Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a[1] === b[1];
  }

  function downloadText(filename, text, mime = 'application/json') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function safeParseJson(text) {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (err) {
      return { ok: false, error: err };
    }
  }

  function parseCsv(text) {
    const lines = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return [];

    const rows = [];
    for (const line of lines) {
      const out = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
          continue;
        }
        if (ch === ',' && !inQuotes) {
          out.push(cur);
          cur = '';
          continue;
        }
        cur += ch;
      }
      out.push(cur);
      rows.push(out.map((v) => v.trim()));
    }

    const header = rows.shift().map((h) => h.toLowerCase());
    const result = [];
    for (const r of rows) {
      const obj = {};
      for (let i = 0; i < header.length; i++) obj[header[i]] = r[i] ?? '';
      result.push(obj);
    }
    return result;
  }

  function defaultState() {
    return {
      classroom: {
        name: 'Classroom',
        rows: 5,
        cols: 6,
        teacher_desk_position: 'front',
        special_seats: [],
        empty_seats: [],
        orientation: 'front',
      },
      students: [],
      arrangement: {
        id: 'arr_' + Math.random().toString(36).slice(2, 10),
        name: 'Seating Arrangement',
        classroom_id: 'classroom_default',
        created_at: nowIso(),
        seats: createSeatsMatrix(5, 6),
        locked_seats: [],
      },
      rules: {
        alternating_gender: true,
        enforce_fixed: true,
        check_front: true,
        front_rows: 2,
        check_near_teacher: false,
        near_band: 2,
        check_aisle: false,
        avoid_pairs: [],
      },
    };
  }

  function currentPayload() {
    return {
      version: 1,
      classroom: state.classroom,
      students: state.students,
      arrangement: state.arrangement,
      rules: state.rules,
    };
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 1200) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function checkApiHealth() {
    try {
      const res = await fetchWithTimeout('/api/health', { method: 'GET' }, 900);
      if (!res.ok) throw new Error('health not ok');
      const data = await res.json();
      state.api.online = !!data?.ok;
      state.api.exports = {
        pdf: !!data?.exports?.pdf,
        xlsx: !!data?.exports?.xlsx,
      };
    } catch {
      state.api.online = false;
      state.api.exports = { pdf: false, xlsx: false };
      if (state.ui.engine === 'python') state.ui.engine = 'browser';
    }
  }

  async function pythonAutoArrange(mode) {
    if (!state.api.online) {
      state.status_message = 'API 離線：請用 `python server.py` 啟動';
      render();
      return;
    }
    const isOptimize = mode === 'optimize';
    state.status_message = isOptimize ? 'Python 最佳化中…（最多 3 秒）' : 'Python 排座中…';
    render();
    try {
      const body = { mode, payload: currentPayload() };
      if (isOptimize) {
        body.seed_mode = 'seat_number';
        body.time_budget = 3.0;
      }
      const res = await fetch('/api/auto-arrange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        state.status_message = data?.error || 'Python 排座失敗';
        render();
        return;
      }
      const score = data.score;
      const maxScore = data.max_score ?? 1000;
      const stats = data.stats;
      let msg;
      if (isOptimize && stats) {
        msg = `已最佳化 · 分數 ${score}/${maxScore} · 迭代 ${stats.iterations}（改善 ${stats.improved}）· ${stats.elapsed}s`;
      } else if (typeof score === 'number') {
        msg = `已自動排座（Python）· 分數 ${score}/${maxScore}`;
      } else {
        msg = '已自動排座（Python）';
      }
      commit(() => {
        state.arrangement.seats = data.arrangement.seats;
        state.arrangement.locked_seats = data.arrangement.locked_seats ?? state.arrangement.locked_seats;
        if (typeof score === 'number') {
          state.server_eval = {
            score,
            max_score: maxScore,
            violations: data.violations ?? [],
            by_type: data.by_type ?? {},
          };
        }
      }, msg);
    } catch (err) {
      state.status_message = 'Python 排座失敗：' + String(err?.message || err);
      render();
    }
  }

  async function pythonEvaluate() {
    if (!state.api.online) {
      state.status_message = 'API 離線：請用 `python server.py` 啟動';
      render();
      return;
    }
    try {
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: currentPayload() }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        state.status_message = data?.error || 'Python 評分失敗';
        render();
        return;
      }
      state.server_eval = {
        score: data.score,
        max_score: data.max_score ?? 1000,
        violations: data.violations ?? [],
        by_type: data.by_type ?? {},
      };
      state.status_message = `Python 評分：${data.score}/${data.max_score ?? 1000}`;
      render();
      scheduleSave();
    } catch (err) {
      state.status_message = 'Python 評分失敗：' + String(err?.message || err);
      render();
    }
  }

  async function pythonExport(kind) {
    if (!state.api.online) {
      state.status_message = 'API 離線：請用 `python server.py` 啟動';
      render();
      return;
    }
    if (kind === 'pdf' && !state.api.exports.pdf) {
      state.status_message = 'PDF 匯出未啟用：請安裝 reportlab（`pip install -r requirements.txt`）';
      render();
      return;
    }
    if (kind === 'xlsx' && !state.api.exports.xlsx) {
      state.status_message = 'Excel 匯出未啟用：請安裝 openpyxl（`pip install -r requirements.txt`）';
      render();
      return;
    }

    const date = new Date().toISOString().slice(0, 10);
    const filename = `seating_${date}.${kind === 'xlsx' ? 'xlsx' : 'pdf'}`;
    state.status_message = `匯出 ${kind.toUpperCase()}…`;
    render();
    try {
      const endpoint = kind === 'xlsx' ? '/api/export/xlsx' : '/api/export/pdf';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, payload: currentPayload() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        state.status_message = data?.error || '匯出失敗';
        render();
        return;
      }
      const blob = await res.blob();
      downloadBlob(filename, blob);
      state.status_message = `已匯出：${filename}`;
      render();
    } catch (err) {
      state.status_message = '匯出失敗：' + String(err?.message || err);
      render();
    }
  }

  function createSeatsMatrix(rows, cols) {
    const seats = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) row.push(null);
      seats.push(row);
    }
    return seats;
  }

  function buildSample() {
    const rows = 6;
    const cols = 6;
    const students = [];
    for (let i = 1; i <= 28; i++) {
      const gender = i % 2 === 0 ? '女' : '男';
      students.push({
        id: 'S' + pad2(i),
        seat_number: i,
        name: `學生${pad2(i)}`,
        gender,
        height: 150 + (i % 20),
        vision_left: 1.0,
        vision_right: 1.0,
        need_front_seat: i === 3 || i === 4,
        need_aisle_seat: i === 7 || i === 18,
        need_near_teacher: i === 2 || i === 8,
        fixed_position: i === 1 ? [0, 0] : (i === 2 ? [0, 1] : null),
        notes: '',
      });
    }

    const classroom = {
      name: '示範教室',
      rows,
      cols,
      teacher_desk_position: 'front',
      special_seats: [],
      empty_seats: [],
      orientation: 'front',
    };

    const arrangement = {
      id: 'arr_sample',
      name: '示範座位表',
      classroom_id: 'classroom_sample',
      created_at: nowIso(),
      seats: createSeatsMatrix(rows, cols),
      locked_seats: [[0, 0], [0, 1]],
    };

    const rules = {
      alternating_gender: true,
      enforce_fixed: true,
      check_front: true,
      front_rows: 2,
      check_near_teacher: true,
      near_band: 2,
      check_aisle: true,
      avoid_pairs: [['S05', 'S06'], ['S11', 'S12']],
    };

    return { classroom, students, arrangement, rules };
  }

  function snapshot() {
    return deepClone({
      classroom: state.classroom,
      students: state.students,
      arrangement: state.arrangement,
      rules: state.rules,
      ui: state.ui,
    });
  }

  function restoreSnap(snap) {
    state.classroom = snap.classroom;
    state.students = snap.students;
    state.arrangement = snap.arrangement;
    state.rules = snap.rules;
    state.ui = snap.ui ?? state.ui;
  }

  function commit(mutator, message) {
    state.history.undo.push(snapshot());
    state.history.redo = [];
    mutator();
    if (message) state.status_message = message;
    render();
    scheduleSave();
  }

  function undo() {
    if (!state.history.undo.length) return;
    const current = snapshot();
    const prev = state.history.undo.pop();
    state.history.redo.push(current);
    restoreSnap(prev);
    state.status_message = '已 Undo';
    render();
    scheduleSave();
  }

  function redo() {
    if (!state.history.redo.length) return;
    const current = snapshot();
    const next = state.history.redo.pop();
    state.history.undo.push(current);
    restoreSnap(next);
    state.status_message = '已 Redo';
    render();
    scheduleSave();
  }

  function buildEmptySeatSet() {
    return new Set((state.classroom.empty_seats ?? []).map(([r, c]) => seatKey(r, c)));
  }

  function buildLockedSeatSet() {
    return new Set((state.arrangement.locked_seats ?? []).map(([r, c]) => seatKey(r, c)));
  }

  function buildPosByStudent() {
    const pos = new Map();
    const seats = state.arrangement.seats ?? [];
    for (let r = 0; r < seats.length; r++) {
      for (let c = 0; c < seats[r].length; c++) {
        const sid = seats[r][c];
        if (sid) pos.set(sid, [r, c]);
      }
    }
    return pos;
  }

  function getStudentById(id) {
    return state.students.find((s) => s.id === id) ?? null;
  }

  function validateSeatInBounds(row, col) {
    return row >= 0 && col >= 0 && row < state.classroom.rows && col < state.classroom.cols;
  }

  function canEditSeat(row, col) {
    const emptySet = buildEmptySeatSet();
    const lockedSet = buildLockedSeatSet();
    const key = seatKey(row, col);
    return !emptySet.has(key) && !lockedSet.has(key);
  }

  function unassignStudent(studentId) {
    const lockedSet = buildLockedSeatSet();
    const posByStudent = buildPosByStudent();
    const pos = posByStudent.get(studentId);
    if (!pos) return false;
    const key = seatKey(pos[0], pos[1]);
    if (lockedSet.has(key)) return false;
    state.arrangement.seats[pos[0]][pos[1]] = null;
    return true;
  }

  function moveStudentToSeat(studentId, row, col) {
    const emptySet = buildEmptySeatSet();
    const lockedSet = buildLockedSeatSet();
    const targetKey = seatKey(row, col);

    if (!validateSeatInBounds(row, col)) return { ok: false, reason: '座位超出範圍' };
    if (emptySet.has(targetKey)) return { ok: false, reason: '不能放到空位/走道' };
    if (lockedSet.has(targetKey) && state.arrangement.seats[row][col] !== studentId) {
      return { ok: false, reason: '座位已鎖定' };
    }

    const posByStudent = buildPosByStudent();
    const origin = posByStudent.get(studentId) ?? null;
    if (origin) {
      const originKey = seatKey(origin[0], origin[1]);
      if (lockedSet.has(originKey) && originKey !== targetKey) return { ok: false, reason: '原座位已鎖定' };
    }

    const targetOccupant = state.arrangement.seats[row][col];
    if (origin && origin[0] === row && origin[1] === col) return { ok: true, changed: false };

    // Ensure student is not duplicated: clear origin first.
    if (origin) state.arrangement.seats[origin[0]][origin[1]] = null;

    // If target occupied, swap when possible.
    if (targetOccupant) {
      if (origin) {
        const originKey = seatKey(origin[0], origin[1]);
        if (lockedSet.has(originKey)) {
          // origin is locked and already moved out; revert
          state.arrangement.seats[origin[0]][origin[1]] = studentId;
          return { ok: false, reason: '原座位已鎖定' };
        }
        if (lockedSet.has(targetKey)) {
          // target locked; revert
          state.arrangement.seats[origin[0]][origin[1]] = studentId;
          return { ok: false, reason: '座位已鎖定' };
        }
        state.arrangement.seats[origin[0]][origin[1]] = targetOccupant;
      } else {
        // from unassigned: eject target occupant
        // (target occupant becomes unassigned)
      }
    }

    state.arrangement.seats[row][col] = studentId;
    return { ok: true, changed: true };
  }

  function toggleEmptySeat(row, col) {
    if (!validateSeatInBounds(row, col)) return;
    const key = seatKey(row, col);
    const emptySet = buildEmptySeatSet();

    const next = new Set(emptySet);
    if (next.has(key)) next.delete(key);
    else next.add(key);

    state.classroom.empty_seats = Array.from(next).map((k) => k.split(',').map((v) => parseInt(v, 10)));

    // Clear occupant and remove lock if making empty
    if (next.has(key)) {
      state.arrangement.seats[row][col] = null;
      state.arrangement.locked_seats = (state.arrangement.locked_seats ?? []).filter(([r, c]) => seatKey(r, c) !== key);
    }
  }

  function toggleLockedSeat(row, col) {
    if (!validateSeatInBounds(row, col)) return;
    const key = seatKey(row, col);
    const emptySet = buildEmptySeatSet();
    if (emptySet.has(key)) return;

    const lockedSet = buildLockedSeatSet();
    const next = new Set(lockedSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    state.arrangement.locked_seats = Array.from(next).map((k) => k.split(',').map((v) => parseInt(v, 10)));
  }

  function setFixedPosition(studentId, row, col) {
    const s = getStudentById(studentId);
    if (!s) return { ok: false, reason: '找不到學生' };
    if (!validateSeatInBounds(row, col)) return { ok: false, reason: '座位超出範圍' };
    const emptySet = buildEmptySeatSet();
    if (emptySet.has(seatKey(row, col))) return { ok: false, reason: '不能把固定座位設在空位/走道' };
    s.fixed_position = [row, col];
    return { ok: true };
  }

  function clearFixedPosition(studentId) {
    const s = getStudentById(studentId);
    if (!s) return;
    s.fixed_position = null;
  }

  function resizeSeats(nextRows, nextCols) {
    const rows = clampInt(nextRows, 1, 30);
    const cols = clampInt(nextCols, 1, 30);

    const oldRows = state.classroom.rows;
    const oldCols = state.classroom.cols;
    state.classroom.rows = rows;
    state.classroom.cols = cols;

    const oldSeats = state.arrangement.seats ?? [];
    const nextSeats = createSeatsMatrix(rows, cols);
    for (let r = 0; r < Math.min(rows, oldRows); r++) {
      for (let c = 0; c < Math.min(cols, oldCols); c++) {
        nextSeats[r][c] = oldSeats[r]?.[c] ?? null;
      }
    }
    state.arrangement.seats = nextSeats;

    // Clamp empty/locked seats
    state.classroom.empty_seats = (state.classroom.empty_seats ?? []).filter(([r, c]) => r >= 0 && c >= 0 && r < rows && c < cols);
    state.arrangement.locked_seats = (state.arrangement.locked_seats ?? []).filter(([r, c]) => r >= 0 && c >= 0 && r < rows && c < cols);

    // Clear out-of-bounds fixed positions
    for (const s of state.students) {
      if (!s.fixed_position) continue;
      const [r, c] = s.fixed_position;
      if (r < 0 || c < 0 || r >= rows || c >= cols) s.fixed_position = null;
    }

    // Remove locks that overlap empty seats
    const emptySet = buildEmptySeatSet();
    state.arrangement.locked_seats = (state.arrangement.locked_seats ?? []).filter(([r, c]) => !emptySet.has(seatKey(r, c)));
  }

  function clearArrangementUnlocked() {
    const lockedSet = buildLockedSeatSet();
    const emptySet = buildEmptySeatSet();
    for (let r = 0; r < state.classroom.rows; r++) {
      for (let c = 0; c < state.classroom.cols; c++) {
        const key = seatKey(r, c);
        if (emptySet.has(key)) {
          state.arrangement.seats[r][c] = null;
          continue;
        }
        if (!lockedSet.has(key)) state.arrangement.seats[r][c] = null;
      }
    }
  }

  function autoArrange(mode) {
    const emptySet = buildEmptySeatSet();
    const lockedSet = buildLockedSeatSet();

    clearArrangementUnlocked();
    const posAfterClear = buildPosByStudent(); // only locked occupants remain after clear

    // Place fixed students first (but never override locked seats)
    const placed = new Set();
    for (const s of state.students) {
      if (!s.fixed_position) continue;
      const [r, c] = s.fixed_position;
      if (!validateSeatInBounds(r, c)) continue;
      const key = seatKey(r, c);
      if (emptySet.has(key)) continue;
      if (lockedSet.has(key)) {
        // only ok if already there
        if (state.arrangement.seats[r][c] === s.id) placed.add(s.id);
        continue;
      }
      const origin = posAfterClear.get(s.id);
      if (origin) {
        const originKey = seatKey(origin[0], origin[1]);
        if (lockedSet.has(originKey) && originKey !== key) {
          // student is stuck in a locked seat; don't duplicate
          continue;
        }
      }
      // clear any existing placement of this student
      unassignStudent(s.id);
      state.arrangement.seats[r][c] = s.id;
      placed.add(s.id);
    }

    // Also treat locked seat occupants as placed
    for (const [r, c] of state.arrangement.locked_seats ?? []) {
      const sid = state.arrangement.seats?.[r]?.[c] ?? null;
      if (sid) placed.add(sid);
    }

    const remaining = state.students.filter((s) => !placed.has(s.id));
    const positions = [];
    for (let r = 0; r < state.classroom.rows; r++) {
      for (let c = 0; c < state.classroom.cols; c++) {
        const key = seatKey(r, c);
        if (emptySet.has(key) || lockedSet.has(key)) continue;
        if (state.arrangement.seats[r][c] !== null) continue;
        positions.push([r, c]);
      }
    }

    if (mode === 'seat_number') {
      remaining.sort((a, b) => (a.seat_number ?? 0) - (b.seat_number ?? 0));
      for (let i = 0; i < Math.min(remaining.length, positions.length); i++) {
        const s = remaining[i];
        const [r, c] = positions[i];
        state.arrangement.seats[r][c] = s.id;
      }
      return;
    }

    if (mode === 'by_height') {
      remaining.sort((a, b) => {
        const ah = a.height;
        const bh = b.height;
        if (ah == null && bh == null) return (a.seat_number ?? 0) - (b.seat_number ?? 0);
        if (ah == null) return 1;
        if (bh == null) return -1;
        if (ah !== bh) return ah - bh;
        return (a.seat_number ?? 0) - (b.seat_number ?? 0);
      });
      for (let i = 0; i < Math.min(remaining.length, positions.length); i++) {
        const s = remaining[i];
        const [r, c] = positions[i];
        state.arrangement.seats[r][c] = s.id;
      }
      return;
    }

    if (mode === 'by_vision') {
      remaining.sort((a, b) => {
        const av = Math.min(a.vision_left ?? 1.0, a.vision_right ?? 1.0);
        const bv = Math.min(b.vision_left ?? 1.0, b.vision_right ?? 1.0);
        if (av !== bv) return av - bv;
        return (a.seat_number ?? 0) - (b.seat_number ?? 0);
      });
      for (let i = 0; i < Math.min(remaining.length, positions.length); i++) {
        const s = remaining[i];
        const [r, c] = positions[i];
        state.arrangement.seats[r][c] = s.id;
      }
      return;
    }

    if (mode === 'random') {
      shuffleInPlace(remaining);
      for (let i = 0; i < Math.min(remaining.length, positions.length); i++) {
        const s = remaining[i];
        const [r, c] = positions[i];
        state.arrangement.seats[r][c] = s.id;
      }
      return;
    }

    if (mode === 'alternating_gender') {
      const males = remaining.filter((s) => s.gender === '男').sort((a, b) => (a.seat_number ?? 0) - (b.seat_number ?? 0));
      const females = remaining.filter((s) => s.gender === '女').sort((a, b) => (a.seat_number ?? 0) - (b.seat_number ?? 0));
      let mi = 0;
      let fi = 0;

      for (const [r, c] of positions) {
        const preferMale = ((r + c) % 2 === 0);
        if (mi < males.length && fi < females.length) {
          const pickMale = preferMale;
          const s = pickMale ? males[mi++] : females[fi++];
          state.arrangement.seats[r][c] = s.id;
          continue;
        }
        if (mi < males.length) {
          state.arrangement.seats[r][c] = males[mi++].id;
          continue;
        }
        if (fi < females.length) {
          state.arrangement.seats[r][c] = females[fi++].id;
        }
      }
    }
  }

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
  }

  function areAdjacent(a, b) {
    if (!a || !b) return false;
    const dr = Math.abs(a[0] - b[0]);
    const dc = Math.abs(a[1] - b[1]);
    return (dr + dc) === 1;
  }

  function isAisleSeat(row, col, emptySet) {
    if (col === 0 || col === state.classroom.cols - 1) return true;
    const left = seatKey(row, col - 1);
    const right = seatKey(row, col + 1);
    return emptySet.has(left) || emptySet.has(right);
  }

  function evaluateViolations() {
    const violations = [];
    const emptySet = buildEmptySeatSet();
    const seats = state.arrangement.seats ?? [];
    const posByStudent = buildPosByStudent();

    const studentMap = new Map(state.students.map((s) => [s.id, s]));

    const add = (type, message, seat_positions = [], student_ids = []) => {
      violations.push({ type, message, seat_positions, student_ids });
    };

    // Fixed seat rule
    if (state.rules.enforce_fixed) {
      for (const s of state.students) {
        if (!s.fixed_position) continue;
        const [r, c] = s.fixed_position;
        if (!validateSeatInBounds(r, c)) {
          add('fixed', `${s.name} 的固定座位超出範圍（${r + 1},${c + 1}）`, [], [s.id]);
          continue;
        }
        if (emptySet.has(seatKey(r, c))) {
          add('fixed', `${s.name} 的固定座位在空位/走道（${r + 1},${c + 1}）`, [[r, c]], [s.id]);
          continue;
        }
        const occupant = seats?.[r]?.[c] ?? null;
        if (occupant !== s.id) {
          add('fixed', `${s.name} 必須在固定座位（${r + 1},${c + 1}）`, [[r, c]], [s.id, occupant].filter(Boolean));
        }
      }
    }

    // need_front_seat
    if (state.rules.check_front) {
      const band = clampInt(state.rules.front_rows, 1, 10);
      for (const s of state.students) {
        if (!s.need_front_seat) continue;
        const pos = posByStudent.get(s.id);
        if (!pos) {
          add('front', `${s.name} 需要前排，但尚未安排座位`, [], [s.id]);
          continue;
        }
        if (pos[0] >= band) add('front', `${s.name} 需要前排（前 ${band} 排）`, [pos], [s.id]);
      }
    }

    // need_near_teacher
    if (state.rules.check_near_teacher) {
      const band = clampInt(state.rules.near_band, 1, 10);
      const desk = state.classroom.teacher_desk_position;
      for (const s of state.students) {
        if (!s.need_near_teacher) continue;
        const pos = posByStudent.get(s.id);
        if (!pos) {
          add('near_teacher', `${s.name} 需要靠近講桌，但尚未安排座位`, [], [s.id]);
          continue;
        }
        const [r, c] = pos;
        let ok = true;
        if (desk === 'front') ok = r < band;
        if (desk === 'back') ok = r >= state.classroom.rows - band;
        if (desk === 'left') ok = c < band;
        if (desk === 'right') ok = c >= state.classroom.cols - band;
        if (!ok) add('near_teacher', `${s.name} 需要靠近講桌（範圍 ${band}）`, [pos], [s.id]);
      }
    }

    // need_aisle_seat
    if (state.rules.check_aisle) {
      for (const s of state.students) {
        if (!s.need_aisle_seat) continue;
        const pos = posByStudent.get(s.id);
        if (!pos) {
          add('aisle', `${s.name} 需要走道旁，但尚未安排座位`, [], [s.id]);
          continue;
        }
        const [r, c] = pos;
        if (!isAisleSeat(r, c, emptySet)) add('aisle', `${s.name} 需要走道旁（左右邊界或鄰空位）`, [pos], [s.id]);
      }
    }

    // Alternating gender (adjacent)
    if (state.rules.alternating_gender) {
      for (let r = 0; r < state.classroom.rows; r++) {
        for (let c = 0; c < state.classroom.cols; c++) {
          const sid = seats?.[r]?.[c] ?? null;
          if (!sid) continue;
          const s = studentMap.get(sid);
          if (!s) continue;
          // right
          if (c + 1 < state.classroom.cols) {
            const sid2 = seats?.[r]?.[c + 1] ?? null;
            if (sid2) {
              const s2 = studentMap.get(sid2);
              if (s2 && s.gender === s2.gender) {
                add('gender', `相鄰同性別：${s.name}（${s.gender}）與 ${s2.name}（${s2.gender}）`, [[r, c], [r, c + 1]], [sid, sid2]);
              }
            }
          }
          // down
          if (r + 1 < state.classroom.rows) {
            const sid2 = seats?.[r + 1]?.[c] ?? null;
            if (sid2) {
              const s2 = studentMap.get(sid2);
              if (s2 && s.gender === s2.gender) {
                add('gender', `相鄰同性別：${s.name}（${s.gender}）與 ${s2.name}（${s2.gender}）`, [[r, c], [r + 1, c]], [sid, sid2]);
              }
            }
          }
        }
      }
    }

    // Avoid pairs
    for (const pair of state.rules.avoid_pairs ?? []) {
      if (!Array.isArray(pair) || pair.length !== 2) continue;
      const [a, b] = pair;
      const posA = posByStudent.get(a);
      const posB = posByStudent.get(b);
      if (!posA || !posB) continue;
      if (areAdjacent(posA, posB)) {
        const sa = studentMap.get(a);
        const sb = studentMap.get(b);
        add('avoid', `配對不可相鄰：${sa?.name ?? a} ↔ ${sb?.name ?? b}`, [posA, posB], [a, b]);
      }
    }

    return violations;
  }

  function render() {
    // Classroom controls
    el.rows_input.value = String(state.classroom.rows);
    el.cols_input.value = String(state.classroom.cols);
    el.desk_select.value = state.classroom.teacher_desk_position;

    el.toggle_empty_mode.textContent = `編輯空位：${state.ui.empty_mode ? '開' : '關'}`;
    el.toggle_lock_mode.textContent = `鎖定座位：${state.ui.lock_mode ? '開' : '關'}`;

    // Rules
    el.rule_alternating_gender.checked = !!state.rules.alternating_gender;
    el.rule_enforce_fixed.checked = !!state.rules.enforce_fixed;
    el.rule_check_front.checked = !!state.rules.check_front;
    el.front_rows.value = String(state.rules.front_rows);
    el.rule_check_near_teacher.checked = !!state.rules.check_near_teacher;
    el.near_band.value = String(state.rules.near_band);
    el.rule_check_aisle.checked = !!state.rules.check_aisle;

    // Selection summary
    const s = state.ui.selected_student_id ? getStudentById(state.ui.selected_student_id) : null;
    const seat = state.ui.selected_seat;
    const seatText = seat ? `座位：(${seat[0] + 1},${seat[1] + 1})` : '座位：未選取';
    const studentText = s ? `學生：${s.seat_number ?? ''} ${s.name}（${s.gender}）` : '學生：未選取';
    const fixedText = s?.fixed_position ? `固定：(${s.fixed_position[0] + 1},${s.fixed_position[1] + 1})` : '固定：—';
    el.selection_summary.textContent = `${studentText}\n${seatText}\n${fixedText}`;

    // Avoid pair selects
    renderAvoidControls();

    // Grid + violations
    const violations = evaluateViolations();
    renderGrid(violations);
    renderViolations(violations);

    // Students list
    renderStudentList();

    // Actions state
    el.undo_button.disabled = !state.history.undo.length;
    el.redo_button.disabled = !state.history.redo.length;

    // Engine + API status
    if (el.engine_select) {
      const pythonOption = el.engine_select.querySelector('option[value="python"]');
      if (pythonOption) pythonOption.disabled = !state.api.online;
      if (!state.api.online && state.ui.engine === 'python') state.ui.engine = 'browser';
      el.engine_select.value = state.ui.engine || 'browser';
    }
    if (el.api_status) {
      const parts = [];
      parts.push(state.api.online ? 'API：在線' : 'API：離線');
      if (state.api.online) {
        parts.push(`PDF:${state.api.exports.pdf ? '✓' : '✗'}`);
        parts.push(`Excel:${state.api.exports.xlsx ? '✓' : '✗'}`);
      }
      el.api_status.textContent = parts.join(' · ');
      el.api_status.classList.toggle('online', state.api.online);
      el.api_status.classList.toggle('offline', !state.api.online);
    }
    if (el.export_xlsx) el.export_xlsx.disabled = !state.api.online || !state.api.exports.xlsx;
    if (el.export_pdf) el.export_pdf.disabled = !state.api.online || !state.api.exports.pdf;
    if (el.python_evaluate) el.python_evaluate.disabled = !state.api.online;

    // Desk indicator
    el.desk.className = `desk ${state.classroom.teacher_desk_position}`;

    // Status
    const posByStudent = buildPosByStudent();
    const assigned = posByStudent.size;
    const unassigned = state.students.length - assigned;
    const statusBits = [
      `已排：${assigned}`,
      `未排：${unassigned}`,
      `違規：${violations.length}`,
    ];
    if (state.server_eval && typeof state.server_eval.score === 'number') {
      statusBits.push(`Python 分數：${state.server_eval.score}/${state.server_eval.max_score}`);
    }
    if (state.status_message) statusBits.push(state.status_message);
    el.status.textContent = statusBits.join(' · ');
  }

  function renderViolations(violations) {
    el.violations.innerHTML = '';
    if (!violations.length) {
      const div = document.createElement('div');
      div.className = 'violation';
      div.textContent = '沒有發現違規。';
      el.violations.appendChild(div);
      return;
    }
    for (const v of violations.slice(0, 24)) {
      const div = document.createElement('div');
      div.className = 'violation';
      div.textContent = v.message;
      el.violations.appendChild(div);
    }
    if (violations.length > 24) {
      const div = document.createElement('div');
      div.className = 'violation';
      div.textContent = `（已省略 ${violations.length - 24} 則）`;
      el.violations.appendChild(div);
    }
  }

  function renderAvoidControls() {
    const students = [...state.students].sort((a, b) => (a.seat_number ?? 0) - (b.seat_number ?? 0));
    const makeOption = (s) => {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = `${s.seat_number ?? ''} ${s.name}`;
      return o;
    };

    const prevA = el.avoid_a.value;
    const prevB = el.avoid_b.value;
    el.avoid_a.innerHTML = '';
    el.avoid_b.innerHTML = '';
    const blankA = document.createElement('option');
    blankA.value = '';
    blankA.textContent = '（選擇學生 A）';
    const blankB = document.createElement('option');
    blankB.value = '';
    blankB.textContent = '（選擇學生 B）';
    el.avoid_a.appendChild(blankA);
    el.avoid_b.appendChild(blankB);
    for (const s of students) {
      el.avoid_a.appendChild(makeOption(s));
      el.avoid_b.appendChild(makeOption(s.clone ? s.clone() : s));
    }
    if (prevA) el.avoid_a.value = prevA;
    if (prevB) el.avoid_b.value = prevB;

    // Avoid list
    el.avoid_list.innerHTML = '';
    const studentMap = new Map(state.students.map((s) => [s.id, s]));
    for (let i = 0; i < (state.rules.avoid_pairs ?? []).length; i++) {
      const [a, b] = state.rules.avoid_pairs[i];
      const sa = studentMap.get(a);
      const sb = studentMap.get(b);
      const item = document.createElement('div');
      item.className = 'avoid-item';
      item.textContent = `${sa?.name ?? a} ↔ ${sb?.name ?? b}`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '移除';
      btn.addEventListener('click', () => {
        commit(() => {
          state.rules.avoid_pairs.splice(i, 1);
        }, '已移除配對');
      });
      item.appendChild(btn);
      el.avoid_list.appendChild(item);
    }
  }

  function renderStudentList() {
    el.student_list.innerHTML = '';
    const filter = String(el.student_filter.value ?? '').trim().toLowerCase();
    const posByStudent = buildPosByStudent();

    const unassigned = state.students
      .filter((s) => !posByStudent.has(s.id))
      .sort((a, b) => (a.seat_number ?? 0) - (b.seat_number ?? 0));

    const filtered = filter
      ? unassigned.filter((s) => {
        const hay = `${s.seat_number ?? ''} ${s.name} ${s.gender}`.toLowerCase();
        return hay.includes(filter);
      })
      : unassigned;

    for (const s of filtered) {
      const card = document.createElement('div');
      card.className = 'student-card' + (state.ui.selected_student_id === s.id ? ' selected' : '');
      card.draggable = true;
      card.dataset.studentId = s.id;

      const meta = document.createElement('div');
      meta.className = 'student-meta';

      const name = document.createElement('div');
      name.className = 'student-name';
      name.textContent = `${s.seat_number ?? ''} ${s.name}`;

      const sub = document.createElement('div');
      sub.className = 'student-sub';
      const tags = [];
      if (s.need_front_seat) tags.push('前排');
      if (s.need_near_teacher) tags.push('近講桌');
      if (s.need_aisle_seat) tags.push('走道');
      if (s.fixed_position) tags.push(`固定(${s.fixed_position[0] + 1},${s.fixed_position[1] + 1})`);
      sub.textContent = tags.length ? tags.join(' · ') : '—';

      meta.appendChild(name);
      meta.appendChild(sub);

      const badge = document.createElement('div');
      badge.className = 'badge ' + (s.gender === '男' ? 'male' : 'female');
      badge.textContent = s.gender;

      card.appendChild(meta);
      card.appendChild(badge);

      card.addEventListener('click', () => {
        state.ui.selected_student_id = s.id;
        state.status_message = '';
        render();
        scheduleSave();
      });

      card.addEventListener('dragstart', (ev) => {
        const payload = JSON.stringify({ studentId: s.id });
        ev.dataTransfer.setData('text/plain', payload);
        ev.dataTransfer.setData('application/json', payload);
        ev.dataTransfer.effectAllowed = 'move';
      });

      el.student_list.appendChild(card);
    }
  }

  function renderGrid(violations) {
    const rows = state.classroom.rows;
    const cols = state.classroom.cols;
    const emptySet = buildEmptySeatSet();
    const lockedSet = buildLockedSeatSet();
    const seats = state.arrangement.seats ?? createSeatsMatrix(rows, cols);
    state.arrangement.seats = seats;

    const violationSeats = new Set();
    for (const v of violations) {
      for (const [r, c] of v.seat_positions ?? []) violationSeats.add(seatKey(r, c));
    }

    el.grid.style.gridTemplateColumns = `repeat(${cols}, minmax(90px, 1fr))`;
    el.grid.innerHTML = '';
    const studentMap = new Map(state.students.map((s) => [s.id, s]));

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const key = seatKey(r, c);
        const seat = document.createElement('div');
        seat.className = 'seat';
        seat.dataset.row = String(r);
        seat.dataset.col = String(c);

        if (emptySet.has(key)) seat.classList.add('empty');
        if (lockedSet.has(key)) seat.classList.add('locked');
        if (state.ui.selected_seat && sameSeat(state.ui.selected_seat, [r, c])) seat.classList.add('selected');
        if (violationSeats.has(key)) seat.classList.add('violation-seat');

        const occupantId = seats?.[r]?.[c] ?? null;

        if (emptySet.has(key)) {
          seat.textContent = '空位';
        } else {
          const label = document.createElement('div');
          label.className = 'seat-label';
          label.textContent = `(${r + 1},${c + 1})`;
          seat.appendChild(label);

          if (lockedSet.has(key)) {
            const lock = document.createElement('div');
            lock.className = 'lock-icon';
            lock.textContent = '🔒';
            seat.appendChild(lock);
          }

          if (occupantId) {
            const s = studentMap.get(occupantId);
            const occ = document.createElement('div');
            occ.className = 'seat-occupant';
            occ.draggable = true;
            occ.dataset.studentId = occupantId;

            const nm = document.createElement('div');
            nm.className = 'name';
            nm.textContent = s ? s.name : occupantId;

            const sub = document.createElement('div');
            sub.className = 'sub';
            sub.textContent = s ? `${s.seat_number ?? ''} · ${s.gender}` : '—';

            occ.appendChild(nm);
            occ.appendChild(sub);

            occ.addEventListener('dragstart', (ev) => {
              const payload = JSON.stringify({ studentId: occupantId });
              ev.dataTransfer.setData('text/plain', payload);
              ev.dataTransfer.setData('application/json', payload);
              ev.dataTransfer.effectAllowed = 'move';
            });

            occ.addEventListener('click', (ev) => {
              ev.stopPropagation();
              state.ui.selected_student_id = occupantId;
              state.ui.selected_seat = [r, c];
              state.status_message = '';
              render();
              scheduleSave();
            });

            seat.appendChild(occ);
          }

          seat.addEventListener('dragover', (ev) => {
            if (emptySet.has(key)) return;
            ev.preventDefault();
            seat.classList.add('dragover');
            ev.dataTransfer.dropEffect = 'move';
          });

          seat.addEventListener('dragleave', () => {
            seat.classList.remove('dragover');
          });

          seat.addEventListener('drop', (ev) => {
            ev.preventDefault();
            seat.classList.remove('dragover');
            const payload = getDragPayload(ev);
            if (!payload?.studentId) return;
            const studentId = payload.studentId;
            commit(() => {
              const res = moveStudentToSeat(studentId, r, c);
              if (!res.ok) state.status_message = res.reason;
            }, '已更新座位');
          });

          seat.addEventListener('click', () => {
            if (state.ui.empty_mode) {
              commit(() => toggleEmptySeat(r, c), '已更新空位');
              return;
            }
            if (state.ui.lock_mode) {
              commit(() => toggleLockedSeat(r, c), '已更新鎖定');
              return;
            }
            state.ui.selected_seat = [r, c];
            if (occupantId) state.ui.selected_student_id = occupantId;
            state.status_message = '';
            render();
            scheduleSave();
          });
        }

        el.grid.appendChild(seat);
      }
    }
  }

  function getDragPayload(ev) {
    const raw = ev.dataTransfer.getData('application/json') || ev.dataTransfer.getData('text/plain');
    if (!raw) return null;
    const parsed = safeParseJson(raw);
    if (!parsed.ok) return null;
    return parsed.value;
  }

  function loadStateObject(obj) {
    if (!obj || typeof obj !== 'object') return { ok: false, reason: 'JSON 格式不正確' };
    const payload = obj.version ? obj : obj; // reserved

    if (!payload.classroom || !payload.arrangement || !payload.rules) return { ok: false, reason: '缺少 classroom/arrangement/rules' };
    if (!Array.isArray(payload.students ?? [])) return { ok: false, reason: 'students 必須是陣列' };
    if (!Array.isArray(payload.arrangement.seats ?? [])) return { ok: false, reason: 'arrangement.seats 必須是二維陣列' };

    const next = deepClone(payload);
    // Normalize
    next.classroom.rows = clampInt(next.classroom.rows, 1, 30);
    next.classroom.cols = clampInt(next.classroom.cols, 1, 30);
    next.classroom.teacher_desk_position = next.classroom.teacher_desk_position ?? 'front';
    next.classroom.empty_seats = (next.classroom.empty_seats ?? []).filter(Array.isArray);

    next.arrangement.locked_seats = (next.arrangement.locked_seats ?? []).filter(Array.isArray);
    next.arrangement.seats = normalizeSeatsMatrix(next.arrangement.seats, next.classroom.rows, next.classroom.cols);

    next.students = normalizeStudents(next.students);
    next.rules = normalizeRules(next.rules);

    commit(() => {
      state.classroom = next.classroom;
      state.students = next.students;
      state.arrangement = next.arrangement;
      state.rules = next.rules;
      state.ui.selected_student_id = null;
      state.ui.selected_seat = null;
      state.ui.empty_mode = false;
      state.ui.lock_mode = false;
      state.status_message = '已載入 JSON';
    });

    return { ok: true };
  }

  function normalizeSeatsMatrix(seats, rows, cols) {
    const next = createSeatsMatrix(rows, cols);
    for (let r = 0; r < Math.min(rows, seats.length); r++) {
      const row = seats[r] ?? [];
      for (let c = 0; c < Math.min(cols, row.length); c++) next[r][c] = row[c] ?? null;
    }
    return next;
  }

  function normalizeStudents(students) {
    const ids = new Set();
    const out = [];
    for (const raw of students) {
      if (!raw || typeof raw !== 'object') continue;
      const seatNumber = raw.seat_number ?? raw.seatnumber ?? raw.seatNumber ?? raw.no ?? raw.number ?? null;
      const name = raw.name ?? raw.姓名 ?? raw.student ?? '';
      const gender = normalizeGender(raw.gender ?? raw.性別 ?? raw.sex ?? raw.Gender ?? '');
      let id = String(raw.id ?? raw.student_id ?? raw.studentId ?? '').trim();
      if (!id) {
        const base = 'S' + pad2(parseInt(seatNumber ?? (out.length + 1), 10) || (out.length + 1));
        id = base;
      }
      while (ids.has(id)) id = id + '_' + Math.random().toString(16).slice(2, 6);
      ids.add(id);

      const fixed = raw.fixed_position ?? raw.fixedPosition ?? null;
      const fixedPos = Array.isArray(fixed) && fixed.length === 2 ? [parseInt(fixed[0], 10), parseInt(fixed[1], 10)] : null;

      out.push({
        id,
        seat_number: seatNumber ? parseInt(seatNumber, 10) : null,
        name: String(name),
        gender,
        height: raw.height != null && raw.height !== '' ? parseInt(raw.height, 10) : null,
        vision_left: raw.vision_left != null ? parseFloat(raw.vision_left) : (raw.visionLeft != null ? parseFloat(raw.visionLeft) : 1.0),
        vision_right: raw.vision_right != null ? parseFloat(raw.vision_right) : (raw.visionRight != null ? parseFloat(raw.visionRight) : 1.0),
        need_front_seat: !!(raw.need_front_seat ?? raw.needFrontSeat),
        need_aisle_seat: !!(raw.need_aisle_seat ?? raw.needAisleSeat),
        need_near_teacher: !!(raw.need_near_teacher ?? raw.needNearTeacher),
        fixed_position: fixedPos,
        notes: String(raw.notes ?? ''),
      });
    }
    return out;
  }

  function normalizeRules(rules) {
    const r = { ...(rules ?? {}) };
    return {
      alternating_gender: !!(r.alternating_gender ?? r.alternatingGender ?? true),
      enforce_fixed: !!(r.enforce_fixed ?? r.enforceFixed ?? true),
      check_front: !!(r.check_front ?? r.checkFront ?? true),
      front_rows: clampInt(r.front_rows ?? r.frontRows ?? 2, 1, 10),
      check_near_teacher: !!(r.check_near_teacher ?? r.checkNearTeacher ?? false),
      near_band: clampInt(r.near_band ?? r.nearBand ?? 2, 1, 10),
      check_aisle: !!(r.check_aisle ?? r.checkAisle ?? false),
      avoid_pairs: Array.isArray(r.avoid_pairs ?? r.avoidPairs) ? (r.avoid_pairs ?? r.avoidPairs) : [],
    };
  }

  function bindElements() {
    el.rows_input = document.getElementById('rows-input');
    el.cols_input = document.getElementById('cols-input');
    el.desk_select = document.getElementById('desk-select');
    el.toggle_empty_mode = document.getElementById('toggle-empty-mode');
    el.toggle_lock_mode = document.getElementById('toggle-lock-mode');

    el.selection_summary = document.getElementById('selection-summary');
    el.assign_selected = document.getElementById('assign-selected');
    el.unassign_selected = document.getElementById('unassign-selected');
    el.set_fixed = document.getElementById('set-fixed');
    el.clear_fixed = document.getElementById('clear-fixed');

    el.load_sample = document.getElementById('load-sample');
    el.clear_all = document.getElementById('clear-all');
    el.import_students = document.getElementById('import-students');
    el.student_filter = document.getElementById('student-filter');
    el.student_list = document.getElementById('student-list');
    el.unassigned_drop = document.getElementById('unassigned-drop');

    el.rule_alternating_gender = document.getElementById('rule-alternating-gender');
    el.rule_enforce_fixed = document.getElementById('rule-enforce-fixed');
    el.rule_check_front = document.getElementById('rule-check-front');
    el.front_rows = document.getElementById('front-rows');
    el.rule_check_near_teacher = document.getElementById('rule-check-near-teacher');
    el.near_band = document.getElementById('near-band');
    el.rule_check_aisle = document.getElementById('rule-check-aisle');

    el.avoid_a = document.getElementById('avoid-a');
    el.avoid_b = document.getElementById('avoid-b');
    el.avoid_add = document.getElementById('avoid-add');
    el.avoid_list = document.getElementById('avoid-list');

    el.auto_mode = document.getElementById('auto-mode');
    el.engine_select = document.getElementById('engine-select');
    el.api_status = document.getElementById('api-status');
    el.auto_run = document.getElementById('auto-run');
    el.python_evaluate = document.getElementById('python-evaluate');
    el.undo_button = document.getElementById('undo');
    el.redo_button = document.getElementById('redo');
    el.download_state = document.getElementById('download-state');
    el.load_state = document.getElementById('load-state');
    el.export_csv = document.getElementById('export-csv');
    el.export_xlsx = document.getElementById('export-xlsx');
    el.export_pdf = document.getElementById('export-pdf');
    el.clear_arrangement = document.getElementById('clear-arrangement');

    el.violations = document.getElementById('violations');
    el.grid = document.getElementById('grid');
    el.desk = document.getElementById('desk');
    el.status = document.getElementById('status');
    el.clear_local = document.getElementById('clear-local');
  }

  function bindEvents() {
    el.rows_input.addEventListener('change', () => {
      const nextRows = clampInt(el.rows_input.value, 1, 30);
      const nextCols = clampInt(el.cols_input.value, 1, 30);
      commit(() => resizeSeats(nextRows, nextCols), '已更新教室大小');
    });
    el.cols_input.addEventListener('change', () => {
      const nextRows = clampInt(el.rows_input.value, 1, 30);
      const nextCols = clampInt(el.cols_input.value, 1, 30);
      commit(() => resizeSeats(nextRows, nextCols), '已更新教室大小');
    });
    el.desk_select.addEventListener('change', () => {
      commit(() => {
        state.classroom.teacher_desk_position = el.desk_select.value;
      }, '已更新講桌位置');
    });

    el.toggle_empty_mode.addEventListener('click', () => {
      state.ui.empty_mode = !state.ui.empty_mode;
      if (state.ui.empty_mode) state.ui.lock_mode = false;
      render();
      scheduleSave();
    });
    el.toggle_lock_mode.addEventListener('click', () => {
      state.ui.lock_mode = !state.ui.lock_mode;
      if (state.ui.lock_mode) state.ui.empty_mode = false;
      render();
      scheduleSave();
    });

    el.assign_selected.addEventListener('click', () => {
      const sid = state.ui.selected_student_id;
      const seat = state.ui.selected_seat;
      if (!sid || !seat) {
        state.status_message = '請先選取學生與座位';
        render();
        return;
      }
      commit(() => {
        const res = moveStudentToSeat(sid, seat[0], seat[1]);
        if (!res.ok) state.status_message = res.reason;
      }, '已指定座位');
    });

    el.unassign_selected.addEventListener('click', () => {
      const sid = state.ui.selected_student_id;
      if (!sid) {
        state.status_message = '請先選取學生';
        render();
        return;
      }
      commit(() => {
        const ok = unassignStudent(sid);
        if (!ok) state.status_message = '無法移出（座位可能已鎖定或未安排）';
      }, '已移出座位');
    });

    el.set_fixed.addEventListener('click', () => {
      const sid = state.ui.selected_student_id;
      const seat = state.ui.selected_seat;
      if (!sid || !seat) {
        state.status_message = '請先選取學生與座位';
        render();
        return;
      }
      commit(() => {
        const res = setFixedPosition(sid, seat[0], seat[1]);
        if (!res.ok) state.status_message = res.reason;
      }, '已設定固定座位');
    });

    el.clear_fixed.addEventListener('click', () => {
      const sid = state.ui.selected_student_id;
      if (!sid) {
        state.status_message = '請先選取學生';
        render();
        return;
      }
      commit(() => clearFixedPosition(sid), '已清除固定座位');
    });

    el.load_sample.addEventListener('click', () => {
      const sample = buildSample();
      commit(() => {
        state.classroom = sample.classroom;
        state.students = sample.students;
        state.arrangement = sample.arrangement;
        state.rules = sample.rules;
        state.ui.selected_student_id = null;
        state.ui.selected_seat = null;
        state.ui.empty_mode = false;
        state.ui.lock_mode = false;
        autoArrange('seat_number');
        state.status_message = '已載入範例';
      });
    });

    el.clear_all.addEventListener('click', () => {
      commit(() => {
        const base = defaultState();
        state.classroom = base.classroom;
        state.students = base.students;
        state.arrangement = base.arrangement;
        state.rules = base.rules;
        state.ui.selected_student_id = null;
        state.ui.selected_seat = null;
        state.ui.empty_mode = false;
        state.ui.lock_mode = false;
        state.status_message = '已清空';
      });
    });

    el.import_students.addEventListener('change', async () => {
      const file = el.import_students.files?.[0] ?? null;
      if (!file) return;
      const text = await file.text();
      if (file.name.toLowerCase().endsWith('.json')) {
        const parsed = safeParseJson(text);
        if (!parsed.ok) {
          state.status_message = 'JSON 解析失敗';
          render();
          return;
        }
        const obj = parsed.value;
        // Accept either {students:[...]} or raw students array.
        const students = Array.isArray(obj) ? obj : (obj.students ?? []);
        commit(() => {
          state.students = normalizeStudents(students);
          clearArrangementUnlocked();
          state.status_message = `已匯入學生：${state.students.length} 人`;
        });
      } else if (file.name.toLowerCase().endsWith('.csv')) {
        const rows = parseCsv(text);
        commit(() => {
          state.students = normalizeStudents(rows.map((r) => ({
            id: r.id || r.student_id || r.studentid || '',
            seat_number: r.seat_number || r.seatnumber || r.seat || r.no || r.number || '',
            name: r.name || r.姓名 || r.student || '',
            gender: r.gender || r.性別 || r.sex || '',
          })));
          clearArrangementUnlocked();
          state.status_message = `已匯入學生：${state.students.length} 人`;
        });
      } else {
        state.status_message = '僅支援 JSON / CSV';
        render();
      }
      el.import_students.value = '';
    });

    el.student_filter.addEventListener('input', () => {
      renderStudentList();
    });

    // Rule controls
    el.rule_alternating_gender.addEventListener('change', () => commit(() => { state.rules.alternating_gender = el.rule_alternating_gender.checked; }));
    el.rule_enforce_fixed.addEventListener('change', () => commit(() => { state.rules.enforce_fixed = el.rule_enforce_fixed.checked; }));
    el.rule_check_front.addEventListener('change', () => commit(() => { state.rules.check_front = el.rule_check_front.checked; }));
    el.front_rows.addEventListener('change', () => commit(() => { state.rules.front_rows = clampInt(el.front_rows.value, 1, 10); }));
    el.rule_check_near_teacher.addEventListener('change', () => commit(() => { state.rules.check_near_teacher = el.rule_check_near_teacher.checked; }));
    el.near_band.addEventListener('change', () => commit(() => { state.rules.near_band = clampInt(el.near_band.value, 1, 10); }));
    el.rule_check_aisle.addEventListener('change', () => commit(() => { state.rules.check_aisle = el.rule_check_aisle.checked; }));

    el.avoid_add.addEventListener('click', () => {
      const a = el.avoid_a.value;
      const b = el.avoid_b.value;
      if (!a || !b || a === b) {
        state.status_message = '請選擇兩位不同學生';
        render();
        return;
      }
      const key = [a, b].sort().join('|');
      const existing = new Set((state.rules.avoid_pairs ?? []).map((p) => [...p].sort().join('|')));
      if (existing.has(key)) {
        state.status_message = '配對已存在';
        render();
        return;
      }
      commit(() => {
        state.rules.avoid_pairs.push([a, b]);
        state.status_message = '已加入配對';
      });
    });

    if (el.engine_select) {
      el.engine_select.addEventListener('change', () => {
        const next = el.engine_select.value;
        commit(() => {
          state.ui.engine = next;
        }, '已切換引擎');
      });
    }

    el.auto_run.addEventListener('click', () => {
      const mode = el.auto_mode.value;
      if (mode === 'optimize') {
        if (!state.api.online) {
          state.status_message = '最佳化需要 Python server：請用 `python server.py` 啟動';
          render();
          return;
        }
        pythonAutoArrange(mode);
        return;
      }
      if (state.ui.engine === 'python') {
        pythonAutoArrange(mode);
        return;
      }
      commit(() => autoArrange(mode), '已自動排座');
    });

    if (el.python_evaluate) {
      el.python_evaluate.addEventListener('click', () => pythonEvaluate());
    }

    el.undo_button.addEventListener('click', () => undo());
    el.redo_button.addEventListener('click', () => redo());

    el.download_state.addEventListener('click', () => {
      const payload = {
        version: 1,
        classroom: state.classroom,
        students: state.students,
        arrangement: state.arrangement,
        rules: state.rules,
      };
      downloadText(`seating_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
    });

    el.load_state.addEventListener('change', async () => {
      const file = el.load_state.files?.[0] ?? null;
      if (!file) return;
      const text = await file.text();
      const parsed = safeParseJson(text);
      if (!parsed.ok) {
        state.status_message = 'JSON 解析失敗';
        render();
        return;
      }
      const res = loadStateObject(parsed.value);
      if (!res.ok) {
        state.status_message = res.reason;
        render();
      }
      el.load_state.value = '';
    });

    el.export_csv.addEventListener('click', () => {
      const studentMap = new Map(state.students.map((s) => [s.id, s]));
      const seats = state.arrangement.seats ?? [];
      const rows = [];
      rows.push(['', ...Array.from({ length: state.classroom.cols }, (_, i) => `C${i + 1}`)].join(','));
      for (let r = 0; r < state.classroom.rows; r++) {
        const out = [`R${r + 1}`];
        for (let c = 0; c < state.classroom.cols; c++) {
          const sid = seats?.[r]?.[c] ?? '';
          const s = sid ? studentMap.get(sid) : null;
          const cell = s ? `${s.seat_number ?? ''} ${s.name}`.trim() : '';
          out.push('"' + String(cell).replaceAll('"', '""') + '"');
        }
        rows.push(out.join(','));
      }
      downloadText(`seating_${new Date().toISOString().slice(0, 10)}.csv`, rows.join('\n'), 'text/csv');
    });

    if (el.export_xlsx) {
      el.export_xlsx.addEventListener('click', () => {
        pythonExport('xlsx');
      });
    }

    if (el.export_pdf) {
      el.export_pdf.addEventListener('click', () => {
        pythonExport('pdf');
      });
    }

    el.clear_arrangement.addEventListener('click', () => {
      commit(() => {
        const lockedSet = buildLockedSeatSet();
        const emptySet = buildEmptySeatSet();
        for (let r = 0; r < state.classroom.rows; r++) {
          for (let c = 0; c < state.classroom.cols; c++) {
            const key = seatKey(r, c);
            if (emptySet.has(key)) {
              state.arrangement.seats[r][c] = null;
              continue;
            }
            if (!lockedSet.has(key)) state.arrangement.seats[r][c] = null;
          }
        }
      }, '已清空座位（保留鎖定）');
    });

    // Unassign dropzone
    el.unassigned_drop.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      el.unassigned_drop.classList.add('dragover');
      ev.dataTransfer.dropEffect = 'move';
    });
    el.unassigned_drop.addEventListener('dragleave', () => {
      el.unassigned_drop.classList.remove('dragover');
    });
    el.unassigned_drop.addEventListener('drop', (ev) => {
      ev.preventDefault();
      el.unassigned_drop.classList.remove('dragover');
      const payload = getDragPayload(ev);
      if (!payload?.studentId) return;
      commit(() => {
        const ok = unassignStudent(payload.studentId);
        if (!ok) state.status_message = '無法移出（座位可能已鎖定或未安排）';
      }, '已移出座位');
    });

    el.clear_local.addEventListener('click', () => {
      localStorage.removeItem(STORAGE_KEY);
      state.status_message = '已清除本機暫存';
      render();
    });
  }

  let saveTimer = null;
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        const payload = {
          version: 1,
          classroom: state.classroom,
          students: state.students,
          arrangement: state.arrangement,
          rules: state.rules,
          ui: state.ui,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        // ignore
      }
    }, 250);
  }

  function loadFromLocalStorage() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = safeParseJson(raw);
    if (!parsed.ok) return false;
    const obj = parsed.value;
    if (!obj?.classroom || !obj?.arrangement || !obj?.rules) return false;
    state.classroom = obj.classroom;
    state.students = normalizeStudents(obj.students ?? []);
    state.arrangement = obj.arrangement;
    state.rules = normalizeRules(obj.rules ?? {});
    state.ui = obj.ui ?? state.ui;
    state.ui.engine = state.ui.engine || 'browser';
    // ensure matrix size
    state.classroom.rows = clampInt(state.classroom.rows, 1, 30);
    state.classroom.cols = clampInt(state.classroom.cols, 1, 30);
    state.arrangement.seats = normalizeSeatsMatrix(state.arrangement.seats ?? [], state.classroom.rows, state.classroom.cols);
    return true;
  }

  function initState() {
    const base = defaultState();
    state.classroom = base.classroom;
    state.students = base.students;
    state.arrangement = base.arrangement;
    state.rules = base.rules;
    loadFromLocalStorage();
    state.ui.engine = state.ui.engine || 'browser';
  }

  function init() {
    bindElements();
    initState();
    bindEvents();
    render();
    checkApiHealth().finally(() => render());
    scheduleSave();
  }

  window.addEventListener('DOMContentLoaded', init);
})();
