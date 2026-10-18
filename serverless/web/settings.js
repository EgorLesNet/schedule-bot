// Подключается после app.js: в настройках направления зависят от курса, ссылка на календарь работает с путями вида docs/...
(function () {
  const baseViewSet = viewSet;
  const LABEL = /^(.*) \(([0-9]+) курс\)$/;

  function cascade(root) {
    const sel = root.querySelectorAll('select');
    const fac = sel[0];
    const course = sel[1];
    const dir = sel[2];
    const F = (S.boot && S.boot.faculties) || [];
    if (!fac || !course || !dir || !F.length || !fac.options.length || fac.options[0].textContent !== F[0].name) return;
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

  viewSet = async function () {
    const root = await baseViewSet();
    try { cascade(root); } catch (e) {}
    return root;
  };

  subCard = function () {
    const c = h('section', { class: 'card' }, h('h3', {}, 'Календарь'));
    const file = myFile();
    if (!file) { c.append(h('p', { class: 'muted' }, 'Сначала выберите курс и расписание')); return c; }
    const raw = RAW + file.split('/').map(encodeURIComponent).join('/');
    const web = raw.replace('https://', 'webcal://');
    c.append(h('p', { class: 'muted' }, 'Подписка на исходное расписание из файла. Отмены и переносы из приложения в календаре не отражаются.'),
      h('button', { onclick: () => { buzz.tap(); openLink(web); } }, 'Подписаться: Apple Календарь'),
      h('button', { class: 'alt', onclick: () => { buzz.tap(); openLink('https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(web)); } }, 'Подписаться: Google Календарь'),
      h('button', { class: 'alt', onclick: () => copy(raw) }, 'Копировать ссылку'));
    return c;
  };
})();
