// Карточка предмета: нажмите на название предмета в расписании. Подключается после plan.js
(function () {
  const ru = (d) => d.slice(8) + '.' + d.slice(5, 7);
  const files = (x) => (x.files && x.files.length ? [
    h('div', { class: 'muted' }, '📎 ' + x.files.map((f) => f.name).join(', ')),
    h('button', { class: 'mini', onclick: safe(async () => {
      const r = await call('files', { action: 'send', subject: x.subject, date: x.date });
      alertMsg('Отправлено в чат с ботом: ' + r.sent + ' из ' + r.total);
    }) }, '📎 Получить файлы в чат'),
  ] : []);

  function sections(d) {
    const out = [];
    if (d.link) out.push(h('button', { class: 'big', onclick: () => { buzz.tap(); openLink(d.link); } }, '🔗 Подключиться (постоянная ссылка)'));

    const lessons = h('section', { class: 'card' }, h('h3', {}, 'Ближайшие занятия'));
    if (!d.lessons.length) lessons.append(h('p', { class: 'muted' }, 'Ближайших занятий нет'));
    for (const l of d.lessons) {
      lessons.append(h('div', { class: 'erow' },
        h('span', {}, fullLabel(l.date) + ' · ' + l.start + '–' + l.end + (l.room ? ' · 🏫 ' + l.room : '') + (l.teacher ? ' · 👤 ' + l.teacher : '')),
        l.link ? h('button', { class: 'mini', onclick: () => { buzz.tap(); openLink(l.link); } }, '🔗') : null));
    }
    out.push(lessons);

    const next = h('section', { class: 'card' }, h('h3', {}, 'Домашние задания'));
    if (!d.next.length) next.append(h('p', { class: 'muted' }, 'Актуальных заданий нет'));
    for (const x of d.next) next.append(h('div', { class: 'linkform' }, h('b', {}, ru(x.date)), h('p', { style: 'white-space:pre-wrap' }, linkify(x.text)), ...files({ subject: d.subject, date: x.date, files: x.files })));
    out.push(next);

    if (d.past.length) {
      const past = h('section', { class: 'card' }, h('h3', {}, 'Прошедшие задания'));
      for (const x of d.past) past.append(h('div', { class: 'erow' }, h('span', {}, ru(x.date) + ' · ' + x.text.slice(0, 100) + (x.text.length > 100 ? '…' : ''))));
      out.push(past);
    }

    if (d.materials.length) {
      const mat = h('section', { class: 'card' }, h('h3', {}, 'Материалы'));
      for (const x of d.materials) mat.append(h('div', { class: 'linkform' }, h('b', {}, ru(x.date)), ...files({ subject: d.subject, date: x.date, files: x.files })));
      out.push(mat);
    }

    const note = h('textarea', { rows: 3, maxlength: '1000', placeholder: 'Личная заметка по предмету (видна только вам)' });
    note.value = d.note || '';
    out.push(h('section', { class: 'card' }, h('h3', {}, 'Моя заметка'), note,
      h('button', { onclick: safe(async () => {
        await call('subject', { action: 'note', subject: d.subject, text: note.value });
        alertMsg('Заметка сохранена');
      }) }, 'Сохранить')));
    return out;
  }

  async function openSubject(subject) {
    if (document.getElementById('subj-panel')) return;
    const cs = getComputedStyle(document.body);
    const bg = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : '#ffffff';
    const panel = h('div', { id: 'subj-panel', style: 'position:fixed;inset:0;z-index:90;overflow:auto;padding:12px;box-sizing:border-box;animation:sbIn .22s ease both;background:' + bg + ';color:' + cs.color });
    const body = h('div', {}, h('p', { class: 'muted center' }, 'Загрузка…'));
    panel.append(h('div', { class: 'toolbar' }, h('button', { class: 'mini alt', onclick: () => { buzz.tap(); panel.remove(); } }, '← Назад'), h('b', {}, subject)), body);
    document.body.append(panel);
    try {
      body.replaceChildren(...sections(await call('subject', { subject })));
    } catch (e) {
      body.replaceChildren(h('p', { class: 'err' }, 'Ошибка: ' + ((e && e.message) || e)));
    }
  }

  // Название предмета в строке пары становится нажимаемым
  function hook(root) {
    for (const row of root.querySelectorAll('.lesson')) {
      const b = row.querySelector('b');
      if (!b || b.dataset.sc) continue;
      const subject = b.textContent.replace(/^★\s*/, '').replace(/\s*💻$/, '').trim();
      if (!subject) continue;
      b.dataset.sc = '1';
      b.style.cursor = 'pointer';
      b.style.borderBottom = '1px dotted currentColor';
      b.title = 'Карточка предмета';
      b.addEventListener('click', () => { buzz.tap(); openSubject(subject); });
    }
  }

  const view = document.getElementById('view');
  if (view) {
    new MutationObserver(() => {
      try { hook(view); } catch (e) {}
    }).observe(view, { childList: true, subtree: true });
  }
})();
