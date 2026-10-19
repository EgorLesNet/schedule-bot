// Подключается после app.js: в настройках направления зависят от курса, ссылка на календарь работает с путями вида docs/...
(function () {
  const LABEL = /^(.*) \(([0-9]+) курс\)$/;
  const RAW_FILES = 'https://raw.githubusercontent.com/EgorLesNet/schedule-bot/tgcloud/';

  function cascade(root) {
    const sel = root.querySelectorAll('select');
    const fac = sel[0];
    const course = sel[1];
    const dir = sel[2];
    const F = (S.boot && S.boot.faculties) || [];
    if (!fac || !course || !dir || !F.length || !fac.options.length || fac.options[0].textContent !== F[0].name) return;
    if (fac.dataset.cascade) return;
    fac.dataset.cascade = '1';
    const rebuild = () => {
      const f = F[Number(fac.value)] || { directions: [] };
      const prev = dir.value;
      const opts = [];
      f.directions.forEach((label, i) => {
        const m = LABEL.exec(label);
        if (m && m[2] === course.value) opts.push(h('option', { value: String(i), selected: String(i) === prev }, m[1]));
      });
      dir.replaceChildren(...opts);
      dir.dispatchEvent(new Event('change'));
    };
    fac.addEventListener('change', rebuild);
    course.addEventListener('change', rebuild);
    rebuild();
  }

  // Экран настроек определяется по элементам на странице, а не подменой функции: не зависит от того, как app.js вызывает viewSet
  const view = document.getElementById('view');
  if (view) {
    new MutationObserver(() => { try { cascade(view); } catch (e) {} }).observe(view, { childList: true, subtree: true });
  }

  // После успешного сохранения настроек обновляем данные пользователя в памяти, чтобы вкладка настроек показывала новый выбор
  const baseCall = call;
  call = function (name, p, cache) {
    const r = baseCall(name, p, cache);
    if (name === 'settings') {
      r.then((user) => {
        if (user && typeof user === 'object' && S.boot) S.boot.user = Object.assign({}, S.boot.user, user);
      }).catch(() => {});
    }
    return r;
  };

  subCard = function () {
    const c = h('section', { class: 'card' }, h('h3', {}, 'Календарь'));
    const file = myFile();
    if (!file) { c.append(h('p', { class: 'muted' }, 'Сначала выберите курс и расписание')); return c; }
    const raw = RAW_FILES + file.split('/').map(encodeURIComponent).join('/');
    const web = raw.replace('https://', 'webcal://');
    c.append(h('p', { class: 'muted' }, 'Подписка на исходное расписание из файла. Отмены и переносы из приложения в календаре не отражаются.'),
      h('button', { onclick: () => { buzz.tap(); openLink(web); } }, 'Подписаться: Apple Календарь'),
      h('button', { class: 'alt', onclick: () => { buzz.tap(); openLink('https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(web)); } }, 'Подписаться: Google Календарь'),
      h('button', { class: 'alt', onclick: () => copy(raw) }, 'Копировать ссылку'));
    return c;
  };
})();
