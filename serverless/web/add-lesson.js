(function () {
  const view = document.getElementById('view');
  if (!view) return;
  const field = (title, control) => h('label', {}, h('span', { class: 'muted' }, title), control);
  function mount() {
    const boot = S.boot;
    if (S.tab !== 'day' || !boot || !(boot.assistant || boot.admin) || S.date < nowMsk().date) return;
    const { course, stream } = boot.user;
    const calendar = view.querySelector('.cal');
    if (!course || !stream || !calendar || view.querySelector('.add-lesson')) return;
    const day = S.date;
    const slot = h('div', {});
    const box = h('section', { class: 'card add-lesson' });
    const active = () => box.isConnected && S.tab === 'day' && S.date === day && S.boot?.user?.course === course && S.boot?.user?.stream === stream;
    const toggle = h('button', { type: 'button', class: 'mini', onclick: safe(async () => {
      if (slot.firstChild) { slot.replaceChildren(); return; }
      const pending = h('p', { class: 'muted' }, 'Загрузка предметов…');
      slot.append(pending);
      try {
        const subjects = await call('subjects');
        if (!active() || !pending.isConnected) return;
        if (!subjects.length) { pending.textContent = 'В расписании потока нет предметов'; return; }
        const subject = h('select', {}, subjects.map(name => h('option', { value: name }, name)));
        const date = h('input', { type: 'date', min: nowMsk().date, value: day });
        const start = h('input', { type: 'time' });
        const end = h('input', { type: 'time' });
        const teacher = h('input', { type: 'text', maxlength: 100 });
        const room = h('input', { type: 'text', maxlength: 60 });
        const save = h('button', { type: 'button', onclick: safe(async () => {
          if (!active() || save.disabled) return false;
          if (!start.value || !end.value || start.value >= end.value || !date.value || date.value < nowMsk().date) throw new Error('Проверьте дату и время пары');
          const payload = { course, stream, subject: subject.value, date: date.value, start: start.value, end: end.value, teacher: teacher.value, room: room.value };
          save.disabled = true;
          toggle.disabled = true;
          try {
            let result = await call('addLesson', payload);
            if (!result.added) {
              const rows = result.overlaps.slice(0, 3).map(x => x.start + '–' + x.end + ' ' + x.summary);
              if (!active() || !(await ask(('В это время уже есть пары: ' + rows.join('; ') + '. Всё равно добавить?').slice(0, 256))) || !active()) return false;
              result = await call('addLesson', { ...payload, allowOverlap: true });
            }
            if (!result.added) throw new Error('Пара не добавлена');
            slot.replaceChildren();
            S.marks = {};
            if (active()) {
              S.date = payload.date;
              S.cm = payload.date.slice(0, 7);
              render();
            }
            alertMsg(result.notified == null ? 'Пара добавлена. Результат рассылки неизвестен.' : 'Пара добавлена. Уведомлений отправлено: ' + result.notified);
          } finally { save.disabled = false; toggle.disabled = false; }
        }) }, 'Добавить и уведомить поток');
        slot.replaceChildren(field('Предмет', subject), field('Дата', date), field('Начало', start), field('Окончание', end), field('Преподаватель (необязательно)', teacher), field('Аудитория (необязательно)', room), save);
      } catch (e) { if (pending.isConnected) slot.replaceChildren(); throw e; }
    }, 'tap') }, '＋ Добавить пару');
    box.append(toggle, slot);
    calendar.after(box);
  }
  new MutationObserver(mount).observe(view, { childList: true, subtree: true });
  mount();
})();
