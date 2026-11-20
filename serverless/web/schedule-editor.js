(function () {
  const view = document.getElementById('view');
  if (!view) return;
  let busy = false;
  const permitted = () => S.boot && (S.boot.assistant || S.boot.admin);
  const field = (name, input) => h('label', {}, h('span', { class: 'muted' }, name), input);
  function open() {
    if (!permitted() || document.getElementById('schedule-editor')) return;
    const { course, stream } = S.boot.user;
    const scope = () => permitted() && S.boot.user.course === course && S.boot.user.stream === stream;
    const dialog = h('dialog', { id: 'schedule-editor', style: 'max-width:560px;width:90%;max-height:85vh;overflow:auto;background:var(--sb-bg);color:var(--sb-text);border:1px solid var(--sb-edge);border-radius:18px' });
    const date = h('input', { type: 'date', value: S.date || nowMsk().date });
    const content = h('div', {}), status = h('p', { role: 'status' });
    let seq = 0;
    const guard = () => { if (!scope() || !dialog.isConnected) throw new Error('Поток изменился. Откройте редактор заново.'); };
    async function mutate(fn) {
      if (busy) return;
      busy = true;
      dialog.querySelectorAll('button,input,select').forEach(el => el.disabled = true);
      try { guard(); await fn(); }
      catch (e) { status.textContent = String(e.message || e); }
      finally { busy = false; dialog.querySelectorAll('button,input,select').forEach(el => el.disabled = false); }
    }
    async function write(name, payload) {
      guard();
      status.textContent = 'Сохранение…';
      const result = await call(name, payload);
      guard();
      return result;
    }
    async function load() {
      const ticket = ++seq, selected = date.value;
      if (!selected) return;
      content.replaceChildren(h('p', {}, 'Загрузка…'));
      try {
        guard();
        const days = await call('range', { from: selected, days: 1, editorRead: Date.now() });
        if (ticket !== seq || !scope() || !dialog.isConnected) return;
        const cards = [];
        for (const item of days[0].items) {
          if (item.lang) continue;
          const slot = h('div', {});
          const row = h('section', { class: 'card' }, h('b', {}, item.start + '–' + item.end + ' ' + item.summary));
          const base = { original: item.original || item.summary, summary: item.summary, date: selected, start: item.start };
          row.append(h('button', { type: 'button', class: 'mini danger', onclick: () => mutate(async () => {
            if (!(await ask('Отменить пару «' + item.summary + '» для потока?'))) return;
            await write('schedit', { ...base, action: 'cancel' });
            status.textContent = 'Пара отменена. Рассылка изменений запрошена.';
            S.marks = {}; await load();
          }) }, 'Отменить пару'), h('button', { type: 'button', class: 'mini', onclick: () => {
            if (slot.firstChild) { slot.replaceChildren(); return; }
            const nd = h('input', { type: 'date', value: selected, min: nowMsk().date });
            const ns = h('input', { type: 'time', value: item.start });
            const ne = h('input', { type: 'time', value: item.end });
            slot.append(field('Новая дата', nd), field('Начало', ns), field('Окончание', ne), h('button', { type: 'button', onclick: () => mutate(async () => {
              if (!nd.value || nd.value < nowMsk().date || !ns.value || !ne.value || ns.value >= ne.value) throw new Error('Проверьте дату и время');
              const target = await call('range', { from: nd.value, days: 1, editorRead: Date.now() });
              guard();
              const overlap = target[0].items.some(x => !(nd.value === selected && x.start === item.start && x.summary === item.summary) && ns.value < x.end && ne.value > x.start);
              const message = 'Перенести «' + item.summary + '» с ' + selected + ' ' + item.start + ' на ' + nd.value + ' ' + ns.value + '–' + ne.value + '?' + (overlap ? ' Есть пересечение с другими парами.' : '');
              if (!(await ask(message.slice(0, 256)))) return;
              await write('schedit', { ...base, action: 'move', newDate: nd.value, newStart: ns.value, newEnd: ne.value, teacher: item.teacher, room: item.room });
              status.textContent = 'Пара перенесена. Рассылка изменений запрошена.';
              S.marks = {}; await load();
            }) }, 'Подтвердить перенос'));
          } }, 'Перенести'), slot);
          cards.push(row);
        }
        content.replaceChildren(...cards);
        if (!cards.length) content.append(h('p', {}, 'В этот день нет доступных для изменения пар'));
      } catch (e) { if (ticket === seq) content.replaceChildren(h('p', { class: 'err' }, String(e.message || e))); }
    }
    const addSlot = h('div', {});
    const addButton = h('button', { type: 'button', onclick: safe(async () => {
      if (busy) return false;
      if (addSlot.firstChild) { addSlot.replaceChildren(); return; }
      addSlot.append(h('p', {}, 'Загрузка предметов…'));
      try {
        const subjects = await call('subjects'); guard();
        const subject = h('select', {}, subjects.map(s => h('option', { value: s }, s)));
        const start = h('input', { type: 'time' }), end = h('input', { type: 'time' });
        const teacher = h('input', { type: 'text', maxlength: 100 }), room = h('input', { type: 'text', maxlength: 60 });
        addSlot.replaceChildren(field('Предмет', subject), field('Начало', start), field('Окончание', end), field('Преподаватель', teacher), field('Аудитория', room), h('button', { type: 'button', onclick: () => mutate(async () => {
          const payload = { course, stream, date: date.value, subject: subject.value, start: start.value, end: end.value, teacher: teacher.value, room: room.value };
          if (!payload.subject || !payload.date || payload.date < nowMsk().date || !payload.start || !payload.end || payload.start >= payload.end) throw new Error('Проверьте предмет, дату и время');
          let result = await write('addLesson', payload);
          if (!result.added) {
            if (!(await ask('Есть пересечения с другими парами. Всё равно добавить?'))) { status.textContent = 'Добавление отменено'; return; }
            result = await write('addLesson', { ...payload, allowOverlap: true });
          }
          if (!result.added) throw new Error('Пара не добавлена');
          addSlot.replaceChildren(); S.marks = {};
          status.textContent = result.notified == null ? 'Пара добавлена. Результат рассылки неизвестен.' : 'Пара добавлена. Уведомлений отправлено: ' + result.notified;
          await load();
        }) }, 'Добавить и уведомить поток'));
      } catch (e) { addSlot.replaceChildren(); throw e; }
    }) }, '＋ Добавить пару');
    const close = () => { if (busy) return; ++seq; dialog.close(); dialog.remove(); S.marks = {}; render(); };
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
    date.addEventListener('change', () => { addSlot.replaceChildren(); load(); });
    dialog.append(h('h2', {}, 'Изменить расписание'), field('Дата — нажмите для выбора в календаре', date), status, content, addButton, addSlot, h('button', { type: 'button', class: 'alt', onclick: close }, 'Закрыть'));
    document.body.append(dialog); dialog.showModal(); load();
  }
  function mount() {
    if (!permitted() || !['day', 'week'].includes(S.tab)) return;
    const anchor = view.querySelector('.toolbar');
    if (!anchor || view.querySelector('.schedule-editor-open')) return;
    anchor.after(h('button', { type: 'button', class: 'mini schedule-editor-open', onclick: open }, 'Изменить расписание'));
    for (const old of view.querySelectorAll('.add-lesson')) old.remove();
  }
  // Route existing per-lesson edit shortcuts into the same editor.
  view.addEventListener('click', e => {
    const button = e.target.closest('button');
    if (permitted() && button && button.textContent.trim() === '⚙️' && button.closest('.lesson')) {
      e.preventDefault(); e.stopImmediatePropagation(); open();
    }
  }, true);
  new MutationObserver(mount).observe(view, { childList: true, subtree: true });
  mount();
})();
