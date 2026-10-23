// Вложения к ДЗ и сдвиг всех пар предмета. Подключается после extras.js
(function () {
  const SHIFTS = [[30, '+30 минут'], [60, '+1 час'], [90, '+1,5 часа'], [120, '+2 часа'], [180, '+3 часа'], [-30, '−30 минут'], [-60, '−1 час'], [-120, '−2 часа']];
  const ICON = { document: '📄', photo: '🖼', video: '🎞', audio: '🎵', voice: '🎤', video_note: '⭕', animation: '🎬' };
  const sz = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' МБ' : n > 1024 ? Math.round(n / 1024) + ' КБ' : n ? n + ' Б' : '');
  let inbox = { username: '', items: [] };
  S.hwPick = new Set();
  S.hwFiles = {};

  // ---------- Форма ДЗ: список файлов, присланных боту ----------
  function filesBox(root) {
    for (const sec of root.querySelectorAll('section.card')) {
      const head = sec.querySelector('h3');
      if (!head || !/^(Добавить ДЗ|💡 Предложить ДЗ)$/.test(head.textContent.trim())) continue;
      if (sec.querySelector('.files-box')) continue;
      const last = sec.lastElementChild;
      if (!last || last.tagName !== 'BUTTON') continue;
      const list = h('div', {});
      const draw = () => {
        const keep = new Set(inbox.items.map((f) => f.id));
        for (const id of [...S.hwPick]) if (!keep.has(id)) S.hwPick.delete(id);
        list.replaceChildren(...(inbox.items.length ? inbox.items.map((f) => {
          const cb = h('input', { type: 'checkbox', checked: S.hwPick.has(f.id) });
          cb.addEventListener('change', () => { buzz.pick(); if (cb.checked) S.hwPick.add(f.id); else S.hwPick.delete(f.id); });
          return h('label', { class: 'row' }, cb, (ICON[f.kind] || '📄') + ' ' + f.name + (f.size ? ' · ' + sz(f.size) : ''));
        }) : [h('p', { class: 'muted' }, 'Пока нет файлов')]));
      };
      const load = async () => {
        try { inbox = await call('files', { action: 'inbox' }); draw(); }
        catch (e) { list.replaceChildren(h('p', { class: 'err' }, 'Не удалось загрузить список файлов')); }
      };
      const box = h('div', { class: 'files-box' },
        h('p', { class: 'muted' }, '📎 Файлы любого формата: отправьте их боту в чат, затем нажмите «Обновить» и отметьте нужные. Фото лучше отправлять как файл, чтобы не терять качество.'),
        h('div', { class: 'toolbar' },
          h('button', { class: 'mini alt', onclick: () => { buzz.tap(); if (inbox.username) openLink('https://t.me/' + inbox.username); else alertMsg('Откройте чат с ботом и отправьте файл'); } }, 'Открыть чат с ботом'),
          h('button', { class: 'mini alt', onclick: () => { buzz.tap(); load(); } }, 'Обновить')),
        list);
      last.before(box);
      draw();
      load();
    }
  }

  // ---------- Карточки ДЗ: вложения и кнопка «Получить файлы» ----------
  function hwFileRows(root) {
    for (const el of root.querySelectorAll('.hwc')) {
      if (el.querySelector('.hw-files')) continue;
      const title = (el.querySelector('b') || {}).textContent || '';
      const files = S.hwFiles[title];
      const m = /^(.*) · (\d{2})\.(\d{2})\.(\d{4})$/.exec(title);
      if (!files || !files.length || !m) continue;
      const subject = m[1];
      const date = m[4] + '-' + m[3] + '-' + m[2];
      const row = h('div', { class: 'hw-files' },
        h('div', { class: 'muted' }, '📎 ' + files.map((f) => f.name).join(', ')),
        h('button', { class: 'mini', onclick: safe(async () => {
          const r = await call('files', { action: 'send', subject, date });
          alertMsg('Отправлено в чат с ботом: ' + r.sent + ' из ' + r.total);
        }) }, '📎 Получить файлы в чат'));
      if (S.boot && S.boot.assistant) {
        row.append(h('button', { class: 'mini danger', onclick: safe(async () => {
          buzz.heavy();
          if (!(await ask('Убрать вложения у этого ДЗ?'))) return false;
          await call('files', { action: 'clear', subject, date });
          render();
        }, 'none') }, 'Убрать вложения'));
      }
      el.append(row);
    }
  }

  // ---------- Форма правки пары (⚙️): сдвиг всех пар предмета ----------
  function shiftBox(root) {
    for (const f of root.querySelectorAll('.linkform')) {
      if (f.querySelector('.shift-box') || !/Отменить пару/.test(f.textContent)) continue;
      const date = (f.querySelector('input[type=date]') || {}).value;
      const subject = ((f.querySelector('input[type=text]') || {}).value || '').trim();
      if (!date || !subject) continue;
      const sel = h('select', {}, SHIFTS.map(([v, l]) => h('option', { value: String(v), selected: v === 60 }, l)));
      const scope = h('select', {}, [h('option', { value: 'from' }, 'Начиная с этой даты'), h('option', { value: 'all' }, 'Все будущие пары')]);
      f.append(h('div', { class: 'shift-box' },
        h('span', { class: 'muted' }, 'Сдвинуть все пары предмета «' + subject + '»'),
        sel, scope,
        h('button', { class: 'mini', onclick: safe(async () => {
          const label = sel.options[sel.selectedIndex].textContent;
          if (!(await ask('Сдвинуть все пары «' + subject + '» (' + label + ', ' + scope.options[scope.selectedIndex].textContent.toLowerCase() + ')? Студентам придёт уведомление.'))) return false;
          await call('schedit', { action: 'shift', summary: subject, date, minutes: Number(sel.value), scope: scope.value });
          render();
        }) }, 'Сдвинуть'),
        h('button', { class: 'mini danger', onclick: safe(async () => {
          if (!(await ask('Вернуть исходное время всех перенесённых пар «' + subject + '»?'))) return false;
          await call('schedit', { action: 'unshift', summary: subject, date, scope: scope.value });
          render();
        }, 'none') }, 'Вернуть время всех пар')));
    }
  }

  const view = document.getElementById('view');
  if (view) {
    new MutationObserver(() => {
      try { filesBox(view); } catch (e) {}
      try { hwFileRows(view); } catch (e) {}
      try { shiftBox(view); } catch (e) {}
    }).observe(view, { childList: true, subtree: true });
  }

  // К добавлению ДЗ и предложению подмешиваем отмеченные файлы; список ДЗ с вложениями запоминаем для карточек
  const prevCall = call;
  call = function (name, p, cache) {
    const adding = (name === 'homework' || name === 'proposal') && p && p.action === 'add';
    const q = adding && S.hwPick.size ? Object.assign({}, p, { files: [...S.hwPick] }) : p;
    const r = prevCall(name, q, cache);
    if (adding) r.then(() => { S.hwPick = new Set(); }).catch(() => {});
    if (name === 'homework') {
      r.then((list) => {
        if (!Array.isArray(list)) return;
        const m = {};
        for (const x of list) m[x.subject + ' · ' + x.date.split('-').reverse().join('.')] = x.files || [];
        S.hwFiles = m;
      }).catch(() => {});
    }
    return r;
  };
})();
