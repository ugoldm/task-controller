/* ---------- state ---------- */
const state = { streams: [], tasks: [], today: '', aiEnabled: false };
let view = 'today', openTaskId = null, reviewState = {}, addMode = 'choose';
let expandedDone = {};
// Feature flag: показывать бейдж «перенесено ×N».
// false — функционал скрыт; поставить true, чтобы быстро вернуть обратно.
const SHOW_CARRY_BADGE = false;

const esc = (s) => (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const streamById = (id) => state.streams.find((s) => s.id === id);
const task = (id) => state.tasks.find((t) => t.id === id);

/* ---------- API ---------- */
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { showLogin(); throw new Error('unauthorized'); }
  if (!res.ok) throw new Error('api ' + res.status);
  return res.status === 204 ? null : res.json();
}
function persist(method, path, body) {
  api(method, path, body).catch((e) => console.error('persist failed:', e));
}

/* ---------- boot / auth ---------- */
async function boot() {
  try {
    const me = await (await fetch('/api/me')).json();
    if (me.authRequired && !me.authed) return showLogin();
  } catch { /* ignore */ }
  await loadState();
  setView('today');
}
async function loadState() {
  const s = await api('GET', '/api/state');
  Object.assign(state, s);
}
function showLogin() { document.getElementById('login').classList.add('show'); }
function hideLogin() { document.getElementById('login').classList.remove('show'); }
async function doLogin() {
  const password = document.getElementById('loginPass').value;
  const res = await fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
  });
  if (res.ok) { hideLogin(); await loadState(); setView('today'); }
  else document.getElementById('loginErr').classList.add('show');
}

/* ---------- views ---------- */
function setView(v) {
  view = v;
  document.querySelectorAll('.nav-item[data-view]').forEach((n) =>
    n.classList.toggle('active', n.dataset.view === v));
  document.getElementById('viewTitle').textContent = v === 'today' ? 'Сегодня' : 'Стримы';
  const sub = document.getElementById('viewSub');
  if (v === 'today') {
    const d = state.today ? new Date(state.today) : new Date();
    sub.textContent = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  } else {
    sub.textContent = state.streams.length + ' стрим(ов)';
  }
  render();
}
function render() { view === 'today' ? renderToday() : renderStreams(); }

function taskRowToday(t) {
  const overdue = t.deadline && t.deadline <= state.today && !t.done;
  const meta = [
    SHOW_CARRY_BADGE && t.carry > 0 ? `<span class="badge badge-carry">↻ перенесена ×${t.carry}</span>` : '',
    overdue ? `<span class="badge badge-due">⏰ дедлайн сегодня</span>` : '',
    t.notes ? `<span class="badge badge-note">✎ заметка</span>` : '',
  ].join('');
  return `<div class="task ${t.done ? 'done' : ''}" draggable="true" onclick="openTask(${t.id})"
    ondragstart="dragStart(event,${t.id})" ondragend="dragEnd(event)"
    ondragover="dragOver(event,${t.id})" ondragleave="dragLeave(event)" ondrop="dragDrop(event,${t.id})">
    <div class="check" onclick="event.stopPropagation();toggleDone(${t.id})">
      <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6l3 3 5-6" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
    <div class="task-body">
      <div class="task-title">${esc(t.title)}</div>
      ${meta ? `<div class="task-meta">${meta}</div>` : ''}
    </div>
    <button class="iconbtn remove-today" title="Убрать из сегодня (останется в стриме)"
      onclick="event.stopPropagation();removeFromToday(${t.id})">↩</button>
    <span class="drag-handle" title="Перетащите, чтобы изменить порядок" onclick="event.stopPropagation()">⠿</span>
  </div>`;
}

function renderToday() {
  const c = document.getElementById('content');
  const today = state.tasks.filter((t) => t.today);
  let html = '';
  state.streams.forEach((s) => {
    const list = today.filter((t) => t.stream === s.id);
    if (!list.length) return;
    html += `<div class="stream">
      <div class="stream-head"><span class="cdot" style="background:${s.color}"></span>${esc(s.name)}</div>
      ${list.map(taskRowToday).join('')}
      <div class="quick-add">
        <input placeholder="+ Задача в «${esc(s.name)}»" autocomplete="off" onkeydown="if(event.key==='Enter')quickAdd('${s.id}',this)">
      </div>
    </div>`;
  });
  if (!html) html = `<div class="empty">План на сегодня пуст. Запустите «Ревью дня» или добавьте задачу.</div>`;
  c.innerHTML = html;
}

function renderStreams() {
  const c = document.getElementById('content');
  let html = '';
  state.streams.forEach((s) => {
    const list = state.tasks.filter((t) => t.stream === s.id);
    html += `<div class="stream">
      <div class="stream-head">
        <span class="cdot" style="background:${s.color}"></span>${esc(s.name)}
        <button class="iconbtn stream-edit" onclick="openStream('${s.id}')">✎</button>
      </div>`;
    const open = list.filter((t) => !t.done);
    const done = list.filter((t) => t.done).sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
    if (!list.length) html += `<div class="empty">Пока пусто</div>`;
    open.forEach((t) => { html += streamTaskRow(t); });
    const expanded = !!expandedDone[s.id];
    (expanded ? done : done.slice(0, 2)).forEach((t) => { html += streamTaskRow(t); });
    if (done.length > 2) {
      html += `<button class="btn-link" onclick="toggleExpandDone('${s.id}')">${
        expanded ? '▴ Свернуть выполненные' : `▾ Показать ещё ${done.length - 2} выполненных`}</button>`;
    }
    html += `<div class="quick-add">
        <input placeholder="+ Задача в «${esc(s.name)}»" autocomplete="off" onkeydown="if(event.key==='Enter')quickAdd('${s.id}',this)">
      </div></div>`;
  });
  html += `<button class="btn add-stream" onclick="openStream()">＋ Новый стрим</button>`;
  c.innerHTML = html;
}

function streamTaskRow(t) {
  const s = streamById(t.stream);
  const color = s ? s.color : 'var(--accent)';
  const meta = [
    SHOW_CARRY_BADGE && t.carry > 0 ? `<span class="badge badge-carry">↻ ×${t.carry}</span>` : '',
    t.notes ? '<span class="badge badge-note">✎ заметка</span>' : '',
  ].join('');
  return `<div class="task ${t.done ? 'done' : ''} ${t.today ? 'in-today' : ''}" style="--stream:${color}" draggable="true"
    ondragstart="dragStart(event,${t.id})" ondragend="dragEnd(event)"
    ondragover="dragOver(event,${t.id})" ondragleave="dragLeave(event)" ondrop="dragDrop(event,${t.id})">
    <div class="check" onclick="toggleDone(${t.id})">
      <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6l3 3 5-6" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
    <div class="task-body" onclick="openTask(${t.id})">
      <div class="task-title">${esc(t.title)}</div>
      ${meta ? `<div class="task-meta">${meta}</div>` : ''}
    </div>
    <div class="today-block">
      ${t.done ? '' : (t.today
        ? `<button class="btn today-btn" onclick="removeFromToday(${t.id})">↩ Из сегодня</button>`
        : `<button class="btn today-btn" onclick="toToday(${t.id})">→ В сегодня</button>`)}
    </div>
    <span class="drag-handle" title="Перетащите, чтобы изменить порядок">⠿</span>
  </div>`;
}

function toggleExpandDone(streamId) { expandedDone[streamId] = !expandedDone[streamId]; render(); }

/* ---------- task actions ---------- */
function toggleDone(id) {
  const t = task(id); t.done = !t.done; t.closedAt = t.done ? Date.now() : null;
  render(); if (openTaskId === id) renderDrawer();
  persist('PATCH', '/api/tasks/' + id, { done: t.done });
}
function toToday(id) { const t = task(id); t.today = true; render(); persist('PATCH', '/api/tasks/' + id, { today: true }); }
function removeFromToday(id) {
  const t = task(id); t.today = false; render(); if (openTaskId === id) renderDrawer();
  persist('PATCH', '/api/tasks/' + id, { today: false });
}
async function quickAdd(streamId, el) {
  const title = el.value.trim(); if (!title) return;
  el.value = '';
  const t = await api('POST', '/api/tasks', { title, streamId, today: view === 'today' });
  state.tasks.push(t); render();
}

function persistReorder(streamId) {
  const orderedIds = state.tasks.filter((t) => t.stream === streamId).map((t) => t.id);
  persist('POST', '/api/tasks/reorder', { orderedIds });
}

/* ---------- drag & drop ---------- */
let draggingTaskId = null;
function dragStart(e, id) {
  draggingTaskId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(id));
  e.currentTarget.classList.add('dragging');
}
function dragEnd() {
  draggingTaskId = null;
  document.querySelectorAll('.task').forEach((el) => el.classList.remove('dragging', 'drag-over'));
}
function dragOver(e, tgtId) {
  if (draggingTaskId == null || draggingTaskId === tgtId) return;
  const src = task(draggingTaskId), tgt = task(tgtId);
  if (!src || !tgt || src.stream !== tgt.stream) return;
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}
function dragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
function dragDrop(e, tgtId) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (draggingTaskId == null) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const after = e.clientY - rect.top > rect.height / 2;
  const src = task(draggingTaskId), tgt = task(tgtId);
  draggingTaskId = null;
  if (!src || !tgt || src === tgt || src.stream !== tgt.stream) return;
  state.tasks.splice(state.tasks.indexOf(src), 1);
  let tgtIdx = state.tasks.indexOf(tgt);
  if (after) tgtIdx++;
  state.tasks.splice(tgtIdx, 0, src);
  render();
  persistReorder(src.stream);
}

/* ---------- drawer ---------- */
function openTask(id) {
  openTaskId = id; renderDrawer();
  document.getElementById('overlay').classList.add('show');
  document.getElementById('drawer').classList.add('show');
  lockScroll();
}
function renderDrawer() {
  const t = task(openTaskId); if (!t) return;
  document.getElementById('drawerBody').innerHTML = `
    <div class="field">
      <label>Формулировка</label>
      <input value="${esc(t.title)}" autocomplete="off" onchange="updateField(${t.id},'title',this.value)">
    </div>
    <div class="field">
      <label>Стрим</label>
      <select onchange="updateField(${t.id},'stream',this.value)">
        ${state.streams.map((s) => `<option value="${s.id}" ${s.id === t.stream ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>Статус</label>
      <div style="display:flex;gap:8px">
        <button class="chip ${!t.done ? 'sel-today' : ''}" onclick="setDone(${t.id},false)">Открыта</button>
        <button class="chip ${t.done ? 'sel-done' : ''}" onclick="setDone(${t.id},true)">Выполнена</button>
      </div>
    </div>
    <div class="field">
      <label>План на сегодня</label>
      <div style="display:flex;gap:8px">
        ${t.today
          ? `<button class="chip sel-today" onclick="removeFromToday(${t.id})">↩ Убрать из сегодня</button>`
          : `<button class="chip" onclick="toToday(${t.id});renderDrawer()">→ В сегодня</button>`}
      </div>
    </div>
    <div class="field">
      <label>Дедлайн (опционально)</label>
      <input type="date" value="${t.deadline}" onchange="updateField(${t.id},'deadline',this.value)">
    </div>
    <div class="field">
      <label>Заметки и контекст</label>
      <textarea autocomplete="off" placeholder="Мысли по задаче, ссылки, ход обсуждения…" onchange="updateField(${t.id},'notes',this.value)">${esc(t.notes)}</textarea>
    </div>
    <div class="ai-note" style="background:var(--bg);color:var(--muted)">
      <span>ℹ️</span><span>Переносилась ${t.carry} раз(а)</span>
    </div>
    <button class="btn" style="color:var(--danger)" onclick="deleteTask(${t.id})">Удалить задачу</button>`;
}
function updateField(id, field, value) {
  const t = task(id); t[field] = value; render();
  persist('PATCH', '/api/tasks/' + id, { [field]: value });
}
function setDone(id, done) {
  const t = task(id); t.done = done; t.closedAt = done ? Date.now() : null;
  render(); renderDrawer();
  persist('PATCH', '/api/tasks/' + id, { done });
}
function deleteTask(id) {
  state.tasks = state.tasks.filter((t) => t.id !== id);
  persist('DELETE', '/api/tasks/' + id);
  closeAll(); render();
}

/* ---------- review ---------- */
function openReview() {
  const carried = state.tasks.filter((t) => !t.done && !t.today);
  reviewState = {}; carried.forEach((t) => (reviewState[t.id] = 'keep'));
  let html = '';
  if (!carried.length) {
    html = '<div class="empty">Нет незавершённых задач со вчера 🎉</div>';
  } else {
    html = `<div class="ai-note"><span>✨</span><span><b>AI:</b> со вчера осталось ${carried.length} задач${
      carried.length > 4 ? '. Это много — отметьте на сегодня только 3–4 ключевые, остальное оставьте в бэклоге.' : '. Разберите каждую.'}</span></div>`;
    carried.forEach((t) => {
      const s = streamById(t.stream);
      html += `<div class="rev-item">
        <div class="rt"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${s ? s.color : '#ccc'};margin-right:6px"></span>${esc(t.title)}
          ${t.carry > 0 ? `<span class="badge badge-carry" style="margin-left:6px">↻ ×${t.carry}</span>` : ''}</div>
        <div class="rev-actions">
          <button class="chip" onclick="setRev(${t.id},'today',this)">→ На сегодня</button>
          <button class="chip sel-keep" onclick="setRev(${t.id},'keep',this)">В бэклоге</button>
          <button class="chip" onclick="setRev(${t.id},'done',this)">✓ Выполнена</button>
          <button class="chip" onclick="setRev(${t.id},'del',this)">🗑 Удалить</button>
        </div>
      </div>`;
    });
  }
  document.getElementById('reviewBody').innerHTML = html;
  showModal('reviewModal');
}
function setRev(id, val, btn) {
  reviewState[id] = val;
  const row = btn.parentElement;
  row.querySelectorAll('.chip').forEach((c) => c.classList.remove('sel-today', 'sel-keep', 'sel-done', 'sel-del'));
  btn.classList.add('sel-' + val);
}
async function applyReview() {
  const ops = [];
  Object.entries(reviewState).forEach(([id, val]) => {
    id = +id;
    if (val === 'today') ops.push(api('PATCH', '/api/tasks/' + id, { today: true, incrementCarry: true }));
    else if (val === 'done') ops.push(api('PATCH', '/api/tasks/' + id, { done: true }));
    else if (val === 'del') ops.push(api('DELETE', '/api/tasks/' + id));
  });
  await Promise.all(ops).catch((e) => console.error(e));
  await loadState();
  closeAll(); setView('today');
}

/* ---------- add task: manual / recognize ---------- */
function openAdd() { addMode = 'choose'; renderAdd(); showModal('addModal'); }
function renderAdd() {
  const body = document.getElementById('addBody');
  const foot = document.getElementById('addFoot');
  const ttl = document.getElementById('addTitle');
  const sub = document.getElementById('addSub');
  if (addMode === 'choose') {
    ttl.textContent = 'Новая задача'; sub.textContent = 'Как добавить задачу?';
    body.innerHTML = `
      <button class="add-option" onclick="addMode='manual';renderAdd()">
        <span class="ico">✍️</span>
        <span><span class="ttl">Ввести вручную</span><span class="desc">Сами задаёте формулировку и стрим</span></span>
      </button>
      <button class="add-option" onclick="addMode='recognize';renderAdd()">
        <span class="ico">✨</span>
        <span><span class="ttl">Разобрать из текста</span><span class="desc">Пишете в свободной форме — система распознаёт и разбивает на отдельные задачи${
          state.aiEnabled ? '' : ' (без ключа Claude — простая эвристика)'}</span></span>
      </button>`;
    foot.innerHTML = `<button class="btn" onclick="closeAll()">Закрыть</button>`;
  } else if (addMode === 'manual') {
    ttl.textContent = 'Ввести вручную'; sub.textContent = 'Сами задаёте формулировку и стрим';
    body.innerHTML = `
      <button class="back-link" onclick="addMode='choose';renderAdd()">← Назад</button>
      <div class="field"><label>Формулировка</label><input id="mTitle" placeholder="Что нужно сделать" autocomplete="off"></div>
      <div class="field" style="margin-bottom:0"><label>Стрим</label>
        <select id="mStream">${state.streams.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
      </div>`;
    foot.innerHTML = `<button class="btn" onclick="closeAll()">Отмена</button>
      <button class="btn btn-primary" onclick="saveManual()">Создать задачу</button>`;
  } else {
    ttl.textContent = 'Разобрать из текста'; sub.textContent = 'Опишите в свободной форме, что нужно сделать';
    body.innerHTML = `
      <button class="back-link" onclick="addMode='choose';renderAdd()">← Назад</button>
      <div class="field"><label>Свободный текст</label>
        <textarea id="recRaw" autocomplete="off" placeholder="Напр.: До конца недели разобраться со стратегией retention. Ещё нужно посмотреть PRD Артёма по сплит-платежам и не забыть ответить продуктовому совету."></textarea>
      </div>
      <button class="btn btn-primary btn-sm" onclick="runRecognize(this)">✨ Распознать задачи</button>
      <div id="recResult"></div>`;
    foot.innerHTML = `<button class="btn" onclick="closeAll()">Отмена</button>
      <button class="btn btn-primary" id="recSave" onclick="saveRecognized()" style="display:none">Создать задачи</button>`;
  }
}
async function saveManual() {
  const title = document.getElementById('mTitle').value.trim(); if (!title) return;
  const t = await api('POST', '/api/tasks', { title, streamId: document.getElementById('mStream').value, today: true });
  state.tasks.push(t); closeAll(); setView('today');
}
async function runRecognize(btn) {
  const text = document.getElementById('recRaw').value.trim(); if (!text) return;
  btn.disabled = true; btn.textContent = '⏳ Распознаю…';
  let found = [];
  try { found = (await api('POST', '/api/ai/parse', { text })).tasks; }
  catch (e) { console.error(e); }
  btn.disabled = false; btn.textContent = '✨ Распознать задачи';
  const res = document.getElementById('recResult');
  if (!found.length) {
    res.innerHTML = '<div class="empty">Не удалось выделить задачи — уточните текст.</div>';
    document.getElementById('recSave').style.display = 'none';
    return;
  }
  res.innerHTML = `<div class="ai-parse">
    <div class="lbl">✨ Распознано задач: ${found.length}</div>
    <div style="font-size:12px;color:var(--muted);margin:6px 0 10px">Проверьте формулировки и стримы, снимите галочку с лишнего.</div>
    ${found.map((t) => `<div class="det-item">
      <input type="checkbox" class="det-cb" checked style="margin-top:11px">
      <div style="flex:1">
        <input class="det-title" value="${esc(t.title)}" autocomplete="off" style="width:100%;padding:7px 9px;border:1px solid var(--line);border-radius:7px;background:var(--surface);margin-bottom:6px">
        <select class="det-stream" style="width:100%;padding:7px 9px;border:1px solid var(--line);border-radius:7px;background:var(--surface)">
          ${state.streams.map((s) => `<option value="${s.id}" ${s.id === t.streamId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
        </select>
      </div>
    </div>`).join('')}
  </div>`;
  document.getElementById('recSave').style.display = '';
}
async function saveRecognized() {
  const items = [...document.querySelectorAll('#recResult .det-item')];
  const creates = [];
  items.forEach((it) => {
    if (!it.querySelector('.det-cb').checked) return;
    const title = it.querySelector('.det-title').value.trim(); if (!title) return;
    creates.push(api('POST', '/api/tasks', { title, streamId: it.querySelector('.det-stream').value, today: true }));
  });
  if (!creates.length) return;
  const created = await Promise.all(creates);
  state.tasks.push(...created);
  closeAll(); setView('today');
}

/* ---------- streams ---------- */
const palette = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b'];
let newStreamColor = palette[0], editingStreamId = null;
function openStream(id) {
  editingStreamId = id || null;
  const s = editingStreamId ? streamById(editingStreamId) : null;
  newStreamColor = s ? s.color : palette[0];
  document.getElementById('strName').value = s ? s.name : '';
  document.getElementById('strModalTitle').textContent = s ? 'Редактировать стрим' : 'Новый стрим';
  document.getElementById('strModalFoot').innerHTML = s
    ? `<button class="btn" style="color:var(--danger)" onclick="deleteStream()">Удалить</button>
       <span class="spacer"></span>
       <button class="btn" onclick="closeAll()">Отмена</button>
       <button class="btn btn-primary" onclick="saveStream()">Сохранить</button>`
    : `<button class="btn" onclick="closeAll()">Отмена</button>
       <button class="btn btn-primary" onclick="saveStream()">Создать стрим</button>`;
  renderSwatches();
  showModal('streamModal');
}
function renderSwatches() {
  document.getElementById('strSwatches').innerHTML = palette.map((c) =>
    `<button type="button" class="swatch ${c === newStreamColor ? 'sel' : ''}" style="background:${c}" onclick="newStreamColor='${c}';renderSwatches()"></button>`).join('');
}
async function saveStream() {
  const name = document.getElementById('strName').value.trim(); if (!name) return;
  if (editingStreamId) await api('PATCH', '/api/streams/' + editingStreamId, { name, color: newStreamColor });
  else await api('POST', '/api/streams', { name, color: newStreamColor });
  await loadState(); closeAll(); setView('streams');
}
async function deleteStream() {
  if (!editingStreamId) return;
  const n = state.tasks.filter((t) => t.stream === editingStreamId).length;
  if (n && !confirm('Удалить стрим вместе с задачами в нём (' + n + ')?')) return;
  await api('DELETE', '/api/streams/' + editingStreamId);
  await loadState(); closeAll(); setView('streams');
}

/* ---------- modal helpers ---------- */
function showModal(id) {
  document.getElementById('overlay').classList.add('show');
  document.getElementById(id).classList.add('show');
  lockScroll();
}
function closeAll() {
  document.getElementById('overlay').classList.remove('show');
  document.getElementById('drawer').classList.remove('show');
  document.querySelectorAll('.modal').forEach((m) => m.classList.remove('show'));
  openTaskId = null;
  unlockScroll();
}

// Блокировка прокрутки фона, пока открыта карточка/модалка (фикс scroll-bleed на мобильных).
let scrollLocked = false, savedScrollY = 0;
function lockScroll() {
  if (scrollLocked) return;
  scrollLocked = true;
  savedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${savedScrollY}px`;
  document.body.style.width = '100%';
}
function unlockScroll() {
  if (!scrollLocked) return;
  scrollLocked = false;
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  window.scrollTo(0, savedScrollY);
}

// expose handlers used in inline onclick
Object.assign(window, {
  setView, openTask, toggleDone, toToday, removeFromToday, quickAdd,
  dragStart, dragEnd, dragOver, dragLeave, dragDrop, toggleExpandDone,
  updateField, setDone, deleteTask, openReview, setRev, applyReview,
  openAdd, renderAdd, saveManual, runRecognize, saveRecognized,
  openStream, renderSwatches, saveStream, deleteStream, closeAll, doLogin,
});

boot();
