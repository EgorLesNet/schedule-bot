// Аудитория пары для старост: в форме ⚙️ (там же, где отмена, перенос и переименование) появляется блок «Аудитория».
// «Для этой пары» меняет аудиторию этой пары и пар того же предмета, идущих подряд с ней; «Для всех пар» — всех пар предмета, начиная с сегодняшнего дня.
// Изменение видят все студенты потока, им приходит уведомление; «Сбросить» возвращает аудиторию из исходного расписания. Подключается после app.js, app.js не правится
(function () {
  if (typeof h !== 'function' || typeof call !== 'function') return;
  const view = document.getElementById('view');
  if (!view) return;

  // Текущая аудитория пары: берём из строки пары («👤 преподаватель · 🏫 аудитория»)
  function roomOf(row) {
    if (!row) return '';
    for (const m of row.querySelectorAll('.muted')) {
      const x = /🏫\s*([^·\n]+)/.exec(m.textContent || '');
      if (x) return x[1].trim();
    }
    return '';
  }

  function hook(root) {
    for (const form of root.querySelectorAll('.linkform')) {
      if (form.dataset.room) continue;
      const isEdit = Array.from(form.children).some((b) => b.tagName === 'BUTTON' && b.textContent.trim() === 'Отменить пару');
      if (!isEdit) continue;
      form.dataset.room = '1';
      // Дата, время начала и название берутся из полей формы в момент её появления (пока их никто не менял)
      const date = (form.querySelector('input[type=date]') || {}).value;
      const start = (form.querySelector('input[type=time]') || {}).value;
      const summary = ((form.querySelector('input[type=text]') || {}).value || '').trim();
      if (!date || !start || !summary) continue;
      const input = h('input', { type: 'text', maxlength: '40', placeholder: 'Например: 305 или «Актовый зал»', value: roomOf(form.closest('.lesson')) });

      // scope: 'one' — эта пара (и пары подряд с ней), 'all' — все пары предмета; room '' — сброс; msg — вопрос перед действием
      const run = (scope, getRoom, msg) => safe(async () => {
        const room = getRoom();
        if (room === null) { buzz.err(); alertMsg('Введите аудиторию или нажмите «Сбросить»'); return false; }
        if (msg) {
          buzz.warn();
          if (!(await ask(typeof msg === 'function' ? msg(room) : msg))) return false;
        }
        const r = await call('schedit', { action: 'room', date, start, summary, room, scope });
        const n = (r && r.roomCount) || 0;
        if (!n) alertMsg('Без изменений: аудитория уже такая');
        else if (n > 1) alertMsg('✓ Аудитория изменена у пар: ' + n);
        render();
      });
      const typed = () => (input.value.trim() ? input.value : null);

      form.append(
        h('label', {}, h('span', { class: 'muted' }, 'Аудитория (увидят все студенты потока)'), input),
        h('p', { class: 'muted', style: 'margin:4px 0' }, 'Если две пары этого предмета идут подряд, «для этой пары» сохранит аудиторию для обеих.'),
        h('button', { class: 'mini', onclick: run('one', typed) }, 'Сохранить для этой пары'),
        h('button', { class: 'mini', onclick: run('all', typed, (room) => 'Сохранить аудиторию «' + room + '» для всех будущих пар предмета «' + summary + '»?') }, 'Сохранить для всех пар'),
        h('button', { class: 'mini alt', onclick: run('one', () => '', 'Вернуть исходную аудиторию у этой пары?') }, 'Сбросить для этой пары'),
        h('button', { class: 'mini alt', onclick: run('all', () => '', 'Вернуть исходную аудиторию у всех будущих пар предмета «' + summary + '»?') }, 'Сбросить для всех пар'));
    }
  }

  new MutationObserver(() => {
    try { hook(view); } catch (e) {}
  }).observe(view, { childList: true, subtree: true });
})();
