(function () {
  const view = document.getElementById('view');
  if (!view) return;
  const permitted = () => S.boot && (S.boot.assistant || S.boot.admin);
  const field = (name, control) => h('label', {}, h('span', { class: 'muted' }, name), control);
  function open() {
    if (!permitted() || document.getElementById('schedule-editor')) return;
    const { course, stream } = S.boot.user;
    const dialog = h('dialog', { id: 'schedule-editor', style: 'max-width:560px;width:90%;max-height:85vh;overflow:auto;background:var(--sb-bg);color:var(--sb-text);border:1px solid var(--sb-edge);border-radius:18px' });
    const date = h('input', { type: 'date', value: S.date || nowMsk().date });
    const content = h('div', {}), addSlot = h('div', {}), status = h('p', { role: 'status' });
    let busy = false, seq = 0, formSeq = 0;
    const valid = () => dialog.isConnected && permitted() && S.boot.user.course === course && S.boot.user.stream === stream;
    const guard = () => { if (!valid()) throw new Error('Поток изменился. Откройте редактор заново.'); };
    const button = (title, fn, cls = 'mini') => h('button', { type: 'button', class: cls, onclick: fn }, title);
    const request = (action, more = {}) => call('lessonManage', { course, stream, date: date.value, action, ...more });
    async function load() {
      const ticket = ++seq;
      content.replaceChildren(h('p', {}, 'Загрузка…'));
      try {
        guard();
        const selected = date.value;
        const data = await request('list');
        if (ticket !== seq || !valid() || selected !== date.value) return;
        content.replaceChildren();
        for (const item of data.items) {
          const slot = h('div', {});
          const base = { original: item.original, summary: item.summary, date: selected, start: item.start };
          const row = h('section', { class: 'card' }, h('b', {}, item.start + '–' + item.end + ' ' + item.summary), h('p', { class: 'muted' }, [item.teacher, item.room].filter(Boolean).join(' · ')));
          row.append(button('Отменить пару', () => run(async () => {
            if (!(await ask('Отменить пару для всего потока?'))) return false;
            await call('schedit', { ...base, action: 'cancel' });
            status.textContent = 'Пара отменена. Рассылка изменений запрошена.';
          }), 'mini danger'));
          if (item.removable) row.append(button('Убрать добавленную пару', () => run(async () => {
            if (!(await ask('Удалить добавленную пару для всего потока?'))) return false;
            report(await request('remove', { key: item.key }), 'Пара удалена');
          }), 'mini danger'));
          row.append(button('Перенести', () => {
            const nd = h('input', { type: 'date', value: selected, min: nowMsk().date });
            const ns = h('input', { type: 'time', value: item.start }), ne = h('input', { type: 'time', value: item.end });
            slot.replaceChildren(field('Новая дата', nd), field('Начало', ns), field('Окончание', ne), button('Подтвердить перенос', () => run(async () => {
              check(nd.value, ns.value, ne.value);
              const target = await call('range', { from: nd.value, days: 1, editorRead: Date.now() }); guard();
              const clash = target[0].items.some(x => !(nd.value === selected && x.start === item.start && x.summary === item.summary) && ns.value < x.end && ne.value > x.start);
              if (clash && !(await ask('Есть пересечение с другой парой. Продолжить?'))) return false;
              if (!(await ask(('Было: ' + selected + ' ' + item.start + '. Станет: ' + nd.value + ' ' + ns.value + '–' + ne.value + '. Перенести?').slice(0, 256)))) return false;
              guard();
              await call('schedit', { ...base, action: 'move', newDate: nd.value, newStart: ns.value, newEnd: ne.value, teacher: item.teacher, room: item.room });
              status.textContent = 'Пара перенесена. Рассылка изменений запрошена.';
            })));
          }), button('Аудитория', () => {
            const room = h('input', { type: 'text', maxlength: 40, value: item.room || '' });
            const apply = scope => run(async () => {
              if (!(await ask(scope === 'all' ? 'Изменить аудиторию всех будущих пар предмета?' : 'Изменить аудиторию этой пары и следующих подряд пар того же предмета?'))) return false;
              await call('schedit', { ...base, action: 'room', room: room.value, scope });
              status.textContent = 'Аудитория сохранена. Уведомления отправляются при изменении.';
            });
            slot.replaceChildren(field('Аудитория', room), h('p', { class: 'muted' }, 'Пустое значение возвращает исходную аудиторию.'), button('Для этой пары и пар подряд', () => apply('one')), button('Для всех будущих пар', () => apply('all')));
          }), slot);
          content.append(row);
        }
        if (!data.items.length) content.append(h('p', {}, 'Занятий нет'));
        if (data.cancelled.length) content.append(h('h3', {}, 'Отменённые пары'));
        for (const item of data.cancelled) content.append(h('section', { class: 'card' }, h('p', {}, item.title), button('Восстановить', () => run(async () => {
          if (!(await ask('Восстановить пару для всего потока?'))) return false;
          report(await request('restore', { key: item.key }), 'Пара восстановлена');
        }))));
      } catch (e) { if (ticket === seq) content.replaceChildren(h('p', { class: 'err' }, String(e.message || e))); }
    }
    function report(result, message) { status.textContent = message + (result.notified == null ? '. Результат рассылки неизвестен.' : '. Уведомлений отправлено: ' + result.notified); }
    function check(d, start, end) { if (!d || d < nowMsk().date || !start || !end || start >= end) throw new Error('Проверьте дату и время'); }
    async function run(fn) {
      if (busy) return;
      busy = true;
      dialog.querySelectorAll('button,input,select').forEach(el => el.disabled = true);
      try {
        guard();
        const result = await fn();
        if (result !== false) { S.marks = {}; await load(); }
      } catch (e) { status.textContent = String(e.message || e) + '. Если связь прервалась, проверьте расписание перед повторной попыткой.'; }
      finally { busy = false; dialog.querySelectorAll('button,input,select').forEach(el => el.disabled = false); }
    }
    const addButton = button('＋ Добавить пару', safe(async () => {
      if (busy) return false;
      const ticket = ++formSeq;
      if (addSlot.firstChild) { addSlot.replaceChildren(); return; }
      const selected = date.value;
      addSlot.append(h('p', {}, 'Загрузка предметов…'));
      try {
        const subjects = await call('subjects'); guard();
        if (ticket !== formSeq || selected !== date.value) return;
        const subject = h('select', {}, subjects.map(name => h('option', { value: name }, name)));
        const start = h('input', { type: 'time' }), end = h('input', { type: 'time' });
        const teacher = h('input', { type: 'text', maxlength: 100 }), room = h('input', { type: 'text', maxlength: 60 });
        addSlot.replaceChildren(field('Предмет', subject), field('Начало', start), field('Окончание', end), field('Преподаватель', teacher), field('Аудитория', room), button('Добавить и уведомить поток', () => run(async () => {
          check(date.value, start.value, end.value);
          if (!subject.value) throw new Error('Выберите предмет');
          const payload = { course, stream, date: date.value, subject: subject.value, start: start.value, end: end.value, teacher: teacher.value, room: room.value };
          let result = await call('addLesson', payload); guard();
          if (!result.added) {
            if (!(await ask('Есть пересечения с другими парами. Всё равно добавить?'))) return false;
            guard(); result = await call('addLesson', { ...payload, allowOverlap: true });
          }
          if (!result.added) throw new Error('Пара не добавлена');
          addSlot.replaceChildren(); report(result, 'Пара добавлена');
        })));
      } catch (e) { if (ticket === formSeq) addSlot.replaceChildren(); throw e; }
    }));
    const close = () => { if (busy) return; ++seq; ++formSeq; dialog.close(); dialog.remove(); S.marks = {}; render(); };
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
    date.addEventListener('change', () => { ++formSeq; addSlot.replaceChildren(); load(); });
    const back = button('← Назад', close, 'mini alt');
    back.setAttribute('aria-label', 'Вернуться к расписанию');
    const header = h('div', { class: 'toolbar sheet-head', style: 'position:sticky;top:0;z-index:2;background:var(--sb-bg);padding:8px 0' }, back, h('b', {}, 'Изменить расписание'));
    dialog.setAttribute('aria-label', 'Изменить расписание');
    dialog.append(header, field('Дата — выбор через календарь', date), status, content, addButton, addSlot, button('Закрыть', close, 'alt'));
    document.body.append(dialog); dialog.showModal(); load();
  }
  function mount() {
    if (!permitted() || !['day', 'week'].includes(S.tab)) return;
    if (view.querySelector('.schedule-editor-open')) return;
    const content = view.firstElementChild;
    if (!content || content.classList.contains('sk-wrap') || (content.tagName === 'P' && /Загрузка|Подключение/.test(content.textContent))) return;
    const entry = h('button', { type: 'button', class: 'big schedule-editor-open', onclick: open }, 'Изменить расписание');
    const anchor = view.querySelector('.toolbar');
    if (anchor) anchor.after(entry);
    else if (content.tagName === 'DIV') content.prepend(entry);
    else view.prepend(entry);
    for (const old of view.querySelectorAll('.add-lesson')) old.remove();
  }
  view.addEventListener('click', e => {
    const button = e.target.closest('button');
    if (permitted() && button && button.textContent.trim() === '⚙️' && button.closest('.lesson')) { e.preventDefault(); e.stopImmediatePropagation(); open(); }
  }, true);
  new MutationObserver(mount).observe(view, { childList: true, subtree: true });
  mount();
})();
