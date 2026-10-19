// Подключается после app.js: направления в настройках зависят от курса, календарь (подписка и экспорт с правками), рекламные плашки
(function () {
  const LABEL = /^(.*) \(([0-9]+) курс\)$/;
  const RAW_FILES = 'https://raw.githubusercontent.com/EgorLesNet/schedule-bot/tgcloud/';
  const AD_W = 900;
  const AD_H = 163;

  // ---------- Реклама: картинки docs/ads/ad1.*, ad2.*, ... размером 900×163 ----------
  let ADS = [];
  let adsReady = null;

  function loadAds() {
    if (!adsReady) {
      adsReady = call('ads', { action: 'list' }, true)
        .then((r) => { ADS = (r && r.ads) || []; return r; })
        .catch(() => { adsReady = null; return null; });
    }
    return adsReady;
  }

  function adBanner() {
    const items = ADS.slice();
    if (!items.length) return null;
    const card = document.querySelector('.card');
    const radius = card ? getComputedStyle(card).borderRadius : '16px';
    const box = h('div', { class: 'ad', style: 'position:relative;overflow:hidden;width:100%;aspect-ratio:' + AD_W + ' / ' + AD_H + ';margin:12px 0;user-select:none;background:rgba(127,127,127,.12);border-radius:' + radius });
    const imgs = items.map((a, i) => {
      const im = h('img', { src: a.src, alt: '', draggable: 'false', style: 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:opacity .8s ease;opacity:' + (i === 0 ? '1' : '0') });
      im.addEventListener('error', () => { im.dataset.bad = '1'; });
      return im;
    });
    box.append(...imgs);
    let cur = 0;
    const urlOf = (i) => { const a = ADS.find((x) => x.id === items[i].id); return a ? a.url : ''; };
    const sync = () => { box.style.cursor = urlOf(cur) ? 'pointer' : 'default'; };
    sync();
    box.addEventListener('click', () => {
      const u = urlOf(cur);
      if (u) { buzz.tap(); openLink(u); }
    });
    if (imgs.length > 1) {
      const t = setInterval(() => {
        if (!box.isConnected) { clearInterval(t); return; }
        let next = cur;
        for (let k = 1; k <= imgs.length; k++) {
          const c = (cur + k) % imgs.length;
          if (!imgs[c].dataset.bad) { next = c; break; }
        }
        if (next === cur) return;
        imgs[cur].style.opacity = '0';
        imgs[next].style.opacity = '1';
        cur = next;
        sync();
      }, 5000);
    }
    return box;
  }

  // Сегодня: внизу экрана. Неделя: сразу под выбором недели, перед расписанием.
  function placeAds(view) {
    if (view.querySelector('.ad')) return;
    const week = view.querySelector('.nav');
    const cal = view.querySelector('.cal');
    const day = !week && cal && view.querySelector('input[type="search"]');
    if (!week && !day) return;
    if (!ADS.length) { loadAds().then(() => { if (ADS.length) placeAds(view); }); return; }
    const box = adBanner();
    if (!box) return;
    if (week) week.insertAdjacentElement('afterend', box);
    else cal.parentElement.append(box);
  }

  // Настройки (только админ): ссылка для каждой картинки и проверка размера
  function adminAds(root) {
    if (root.querySelector('.ad-admin')) return;
    const card = h('section', { class: 'card ad-admin' }, h('h3', {}, 'Реклама'),
      h('p', { class: 'muted' }, 'Картинки берутся из docs/ads (ad1, ad2, …), размер строго ' + AD_W + '×' + AD_H + '. Для каждой задайте ссылку, на которую перейдёт пользователь.'));
    const list = h('div', {});
    card.append(list);
    const draw = () => {
      if (!ADS.length) { list.replaceChildren(h('p', { class: 'muted' }, 'Картинок в docs/ads пока нет')); return; }
      list.replaceChildren(...ADS.map((a) => {
        const url = h('input', { type: 'url', placeholder: 'https://…', value: a.url });
        const note = h('span', { class: 'muted' }, '');
        const im = h('img', { src: a.src, alt: a.id, style: 'width:100%;aspect-ratio:' + AD_W + ' / ' + AD_H + ';object-fit:cover;border-radius:10px' });
        im.addEventListener('load', () => {
          const ok = im.naturalWidth === AD_W && im.naturalHeight === AD_H;
          note.textContent = im.naturalWidth + '×' + im.naturalHeight + (ok ? ' ✓' : ' — нужен размер ' + AD_W + '×' + AD_H);
        });
        return h('div', { class: 'linkform' },
          im, h('b', {}, a.id), note, url,
          h('button', { class: 'mini', onclick: safe(async () => {
            const r = await call('ads', { action: 'set', id: a.id, url: url.value.trim() });
            ADS = (r && r.ads) || ADS;
            draw();
          }) }, 'Сохранить'));
      }));
    };
    card.append(h('button', { class: 'mini alt', onclick: safe(async () => {
      const r = await call('ads', { action: 'refresh' });
      ADS = (r && r.ads) || ADS;
      draw();
    }) }, 'Обновить список картинок'));
    root.append(card);
    loadAds().then(draw);
  }

  // ---------- Настройки: направления по курсу ----------
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
    if (S.boot && S.boot.admin) adminAds(root);
  }

  // Экраны определяются по элементам на странице, а не подменой функций: не зависит от того, как app.js вызывает экраны
  const view = document.getElementById('view');
  if (view) {
    new MutationObserver(() => {
      try { cascade(view); } catch (e) {}
      try { placeAds(view); } catch (e) {}
    }).observe(view, { childList: true, subtree: true });
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

  // ---------- Календарь: подписка на исходный файл и экспорт с правками ----------
  async function exportIcs() {
    const r = await call('ics', {});
    const file = new File([r.text], r.name, { type: 'text/calendar' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); } catch (e) { if (e && e.name === 'AbortError') return false; throw e; }
      return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = r.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  subCard = function () {
    const c = h('section', { class: 'card' }, h('h3', {}, 'Календарь'));
    const file = myFile();
    if (!file) { c.append(h('p', { class: 'muted' }, 'Сначала выберите курс и расписание')); return c; }
    const raw = RAW_FILES + file.split('/').map(encodeURIComponent).join('/');
    const web = raw.replace('https://', 'webcal://');
    c.append(h('p', { class: 'muted' }, 'С правками: файл с переносами, отменами, переименованиями и ин. язом на текущий момент. Чтобы обновить календарь, скачайте файл заново.'),
      h('button', { onclick: safe(exportIcs) }, 'Скачать с правками (.ics)'),
      h('p', { class: 'muted' }, 'Подписка на исходное расписание из файла (без правок и ин. яза), обновляется сама:'),
      h('button', { class: 'alt', onclick: () => { buzz.tap(); openLink(web); } }, 'Подписаться: Apple Календарь'),
      h('button', { class: 'alt', onclick: () => { buzz.tap(); openLink('https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(web)); } }, 'Подписаться: Google Календарь'),
      h('button', { class: 'alt', onclick: () => copy(raw) }, 'Копировать ссылку'));
    return c;
  };
})();
