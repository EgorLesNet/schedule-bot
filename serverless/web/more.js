// Уведомления о ДЗ, экзамены выбранного расписания и сообщения об ошибках.
(function () {
  function hwAlertsCard(root) {
    if (root.querySelector('.hwalerts-card')) return;
    const anchor = root.querySelector('.alerts-card');
    if (!anchor) return;
    const u = (S.boot && S.boot.user) || {};
    const box = h('input', { type: 'checkbox', checked: u.hwAlerts !== false });
    box.addEventListener('change', safe(async () => {
      const r = await call('hwAlerts', { value: box.checked });
      if (S.boot) S.boot.user = Object.assign({}, S.boot.user, { hwAlerts: r.hwAlerts });
    }));
    anchor.insertAdjacentElement('afterend', h('section', { class: 'card hwalerts-card' }, h('h3', {}, 'Новое ДЗ'),
      h('label', { class: 'row' }, box, 'Присылать в чат сообщение, когда появляется новое или изменённое ДЗ')));
  }

  // Nonempty versioned request parameters isolate both fast.js and app.js cache keys.
  const exCache = new Map();
  function examScope() {
    const boot = S.boot, user = boot && boot.user;
    if (!user || !user.course || !user.stream) return null;
    const course = String(user.course);
    const group = (boot.schedules || []).find(item => String(item.course) === course);
    const entry = group && group.streams.find(item => item.key === user.stream);
    const faculty = Number.isInteger(user.faculty) ? (boot.faculties || [])[user.faculty]?.name : user.faculty;
    if (!entry || !entry.file || !faculty || entry.faculty !== faculty) return null;
    return { faculty, course, stream: entry.key, file: entry.file };
  }
  const scopeKey = scope => scope ? JSON.stringify([scope.faculty, scope.course, scope.stream, scope.file]) : '';
  function loadEx(scope) {
    const day = nowMsk().date;
    const key = scopeKey(scope) + '|' + day;
    const cached = exCache.get(key);
    if (cached && Date.now() - cached.at < 300000) return cached.promise;
    const record = { at: Date.now(), promise: null };
    record.promise = call('exams', { scopeVersion: 2, scope, day }, false).catch(error => {
      if (exCache.get(key) === record) exCache.delete(key);
      throw error;
    });
    exCache.set(key, record);
    if (exCache.size > 8) exCache.delete(exCache.keys().next().value);
    return record.promise;
  }
  const dayWord = n => n % 10 === 1 && n % 100 !== 11 ? 'день' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'дня' : 'дней';
  const when = date => {
    const n = Math.round((P(date) - P(nowMsk().date)) / 86400000);
    return n <= 0 ? 'сегодня' : n === 1 ? 'завтра' : 'через ' + n + ' ' + dayWord(n);
  };
  function examBox(root) {
    const scope = examScope(), key = scopeKey(scope);
    const existing = root.querySelector('.exams-box');
    if (existing && existing.dataset.examScope === key && key) return;
    for (const old of root.querySelectorAll('.exams-box')) old.remove();
    if (!scope) return;
    const search = root.querySelector('input[type=search]');
    if (!search || !root.querySelector('.cal') || root.querySelector('.nav')) return;
    const bar = search.closest('.toolbar') || search;
    const box = h('div', { class: 'exams-box' });
    box.dataset.examScope = key;
    bar.before(box);
    loadEx(scope).then(d => {
      // A slow response for faculty A must never be rendered after switching to B.
      if (!box.isConnected || scopeKey(examScope()) !== key || !d || scopeKey(d.scope) !== key || !Array.isArray(d.items) || !d.items.length) return;
      const c = h('section', { class: 'card exam-card' }, h('h3', {}, '🎓 Экзамены и зачёты'));
      for (const e of d.items.slice(0, 3)) {
        c.append(h('div', { class: 'erow' },
          h('span', {}, e.summary + ' · ' + fullLabel(e.date) + ', ' + e.start + (e.room ? ' · 🏫 ' + e.room : '')),
          h('b', {}, when(e.date))));
      }
      box.append(c);
    }).catch(() => {});
  }

  function lessonDate(root, row) {
    if (!root.querySelector('.nav')) return S.date;
    const card = row.closest('section.card');
    const head = card && card.querySelector('h3');
    const label = head ? head.textContent : '';
    for (let i = 0; i < 7; i++) {
      const d = add(S.week, i);
      if (fullLabel(d) === label) return d;
    }
    return '';
  }
  function reportBtns(root) {
    for (const row of root.querySelectorAll('.lesson')) {
      if (row.querySelector('.report-btn')) continue;
      const acts = row.querySelector('.acts');
      const body = row.querySelector('.grow');
      if (!acts || !body) continue;
      const date = lessonDate(root, row);
      if (!date) continue;
      const title = (row.querySelector('b') || {}).textContent || '';
      const summary = title.replace(/^★\s*/, '').replace(/\s*💻$/, '').trim();
      const start = ((row.querySelector('.time') || {}).textContent || '').slice(0, 5);
      if (!summary || !/^[0-9]{2}:[0-9]{2}$/.test(start)) continue;
      const slot = h('div', {});
      const btn = h('button', { class: 'mini alt report-btn', onclick: () => {
        buzz.tap();
        if (slot.firstChild) { slot.replaceChildren(); return; }
        const text = h('textarea', { rows: 2, maxlength: '500', placeholder: 'Что не так: время, аудитория, преподаватель…' });
        slot.replaceChildren(h('div', { class: 'linkform' }, text,
          h('button', { class: 'mini', onclick: safe(async () => {
            if (!text.value.trim()) { buzz.err(); return false; }
            await call('report', { action: 'add', date, start, summary, text: text.value });
            slot.replaceChildren();
            alertMsg('Спасибо! Сообщение отправлено ассистентам.');
          }) }, 'Отправить')));
      } }, '⚠️ Ошибка');
      acts.append(btn); body.append(slot);
    }
  }
  function reportsBox(root) {
    if (S.tab !== 'hw' || !(S.boot && S.boot.assistant) || root.querySelector('.reports-box')) return;
    const wrap = root.firstElementChild;
    if (!wrap) return;
    const box = h('div', { class: 'reports-box' });
    wrap.prepend(box);
    call('report', { action: 'list' }).then(d => {
      const list = (d && d.pending) || [];
      if (!box.isConnected || !list.length) return;
      const c = h('section', { class: 'card' }, h('h3', {}, '⚠️ Ошибки в расписании · ' + list.length));
      for (const r of list) c.append(h('div', { class: 'linkform' },
        h('b', {}, r.summary + ' · ' + r.date.split('-').reverse().join('.') + ' ' + r.start),
        h('p', { style: 'white-space:pre-wrap' }, r.text),
        h('div', { class: 'muted' }, 'от ' + (r.uname ? '@' + r.uname : 'студента')),
        h('button', { class: 'mini alt', onclick: () => { buzz.tap(); S.date = r.date; S.cm = r.date.slice(0, 7); S.tab = 'day'; render(); } }, 'Открыть день'),
        h('button', { class: 'mini', onclick: safe(async () => { await call('report', { action: 'resolve', id: r.id, ok: true }); render(); }) }, '✓ Исправлено'),
        h('button', { class: 'mini danger', onclick: safe(async () => { await call('report', { action: 'resolve', id: r.id, ok: false }); render(); }, 'none') }, 'Отклонить')));
      box.append(c);
    }).catch(() => {});
  }

  const previousCall = call;
  call = function (name, params, cache) {
    const result = previousCall(name, params, cache);
    if (name === 'settings') result.then(() => {
      exCache.clear();
      const root = document.getElementById('view');
      if (root) { for (const box of root.querySelectorAll('.exams-box')) box.remove(); examBox(root); }
    }).catch(() => {});
    return result;
  };
  const view = document.getElementById('view');
  if (view) new MutationObserver(() => {
    try { hwAlertsCard(view); } catch (e) {}
    try { examBox(view); } catch (e) {}
    try { reportBtns(view); } catch (e) {}
    try { reportsBox(view); } catch (e) {}
  }).observe(view, { childList: true, subtree: true });
})();
