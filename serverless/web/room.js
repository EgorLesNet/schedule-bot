// Аудитория пары для старост: в форме ⚙️ (там же, где отмена, перенос и переименование) появляется поле «Аудитория».
// Изменение видят все студенты потока, им приходит уведомление; кнопка «Сбросить» возвращает аудиторию из исходного расписания. Подключается после app.js, app.js не правится
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
      const send = (room) => safe(async () => {
        await call('schedit', { action: 'room', date, start, summary, room });
        render();
      });
      form.append(
        h('label', {}, h('span', { class: 'muted' }, 'Аудитория (увидят все студенты потока)'), input),
        h('button', { class: 'mini', onclick: () => send(input.value)() }, 'Сохранить аудиторию'),
        h('button', { class: 'mini alt', onclick: safe(async () => {
          if (!(await ask('Вернуть аудиторию из исходного расписания?'))) return false;
          await call('schedit', { action: 'room', date, start, summary, room: '' });
          render();
        }) }, 'Сбросить'));
    }
  }

  new MutationObserver(() => {
    try { hook(view); } catch (e) {}
  }).observe(view, { childList: true, subtree: true });
})();
