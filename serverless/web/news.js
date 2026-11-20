// Public announcements on the day screen; management lives in the shared editor.
(function () {
  const view = document.getElementById('view');
  const context = () => JSON.stringify([S.boot?.user?.course, S.boot?.user?.stream]);
  const read = () => call('news', { action: 'list' });
  const fmt = date => date.split('-').reverse().join('.');
  const style = document.createElement('style');
  style.textContent = '#schedule-editor [hidden]{display:none!important}#schedule-editor .editor-tabs{display:flex;gap:8px;margin:8px 0 16px}#schedule-editor .editor-tabs button{flex:1;min-height:44px}#schedule-editor .editor-tabs [aria-selected=true]{outline:2px solid var(--tg-theme-button-color,#2481cc);outline-offset:2px}.news-public-list{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory}.news-public-list>.card{flex:0 0 100%;box-sizing:border-box;scroll-snap-align:start}';
  document.head.append(style);
  function publicCard(item) {
    return h('section', { class: 'card news-card' }, h('b', {}, 'Объявление' + (item.by ? ' · ' + item.by : '')), h('p', { style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, linkify(item.text)), h('div', { class: 'muted' }, 'Актуально до ' + fmt(item.until)));
  }
  async function refreshPublic(box) {
    const ctx = context();
    try {
      const data = await read();
      if (!box.isConnected || ctx !== context()) return;
      box.replaceChildren(h('div', { class: 'news-public-list' }, (data.items || []).map(publicCard)));
    } catch (_) {}
  }
  function mountPublic() {
    if (!view || view.querySelector('.news-box')) return;
    const search = view.querySelector('input[type=search]');
    if (!search || !view.querySelector('.cal') || view.querySelector('.nav')) return;
    const box = h('div', { class: 'news-box' });
    (search.closest('.toolbar') || search).before(box);
    refreshPublic(box);
  }
  function mountEditor() {
    const dialog = document.getElementById('schedule-editor');
    if (!dialog || dialog.dataset.announcementTabs) return;
    const header = dialog.querySelector('.sheet-head');
    if (!header) return;
    dialog.dataset.announcementTabs = '1';
    const heading = header.querySelector('b');
    if (heading) heading.textContent = 'Редактирование';
    dialog.setAttribute('aria-label', 'Редактирование расписания и объявлений');
    const original = [...dialog.children].filter(node => node !== header);
    const close = original.find(node => node.tagName === 'BUTTON' && node.textContent.trim() === 'Закрыть');
    const add = original.find(node => node.tagName === 'BUTTON' && node.textContent.trim() === '＋ Добавить пару');
    if (add) add.className = 'big';
    if (close) close.className = 'big alt';
    const schedule = h('div', { id: 'editor-schedule-panel', role: 'tabpanel', 'aria-labelledby': 'editor-schedule-tab' });
    const news = h('div', { id: 'editor-news-panel', role: 'tabpanel', 'aria-labelledby': 'editor-news-tab' });
    for (const node of original) if (node !== close) schedule.append(node);
    news.hidden = true;
    const ctx = context();
    let ticket = 0, loaded = false, writing = false;
    const alive = () => dialog.isConnected && context() === ctx;
    const guard = () => { if (!alive()) throw new Error('Курс или поток изменился. Откройте редактор заново.'); };
    const message = h('p', { role: 'status' });
    async function write(params) {
      guard();
      if (writing) return false;
      writing = true;
      const controls = [...dialog.querySelectorAll('button,input,textarea,select')].map(node => [node, node.disabled]);
      controls.forEach(([node]) => node.disabled = true);
      try {
        await call('news', params);
        guard();
        message.textContent = params.action === 'delete' ? 'Объявление удалено' : 'Объявление опубликовано';
        await loadManager();
        for (const box of view?.querySelectorAll('.news-box') || []) refreshPublic(box);
        return true;
      } catch (e) {
        message.textContent = String(e.message || e) + '. При обрыве связи проверьте список перед повторной отправкой.';
        return false;
      } finally {
        writing = false;
        controls.forEach(([node, disabled]) => node.disabled = disabled);
      }
    }
    async function loadManager() {
      const seq = ++ticket;
      news.replaceChildren(message, h('p', {}, 'Загрузка объявлений…'));
      try {
        const data = await read();
        if (!alive() || seq !== ticket) return;
        loaded = true;
        const body = h('div', {});
        news.replaceChildren(message, body);
        if (data.canPost) {
          const text = h('textarea', { rows: 4, maxlength: 500, placeholder: 'Текст объявления' });
          const today = nowMsk().date;
          const until = h('input', { type: 'date', value: add(today, 7), min: today, max: add(today, 120) });
          const target = h('select', {}, h('option', { value: 'stream' }, 'Только выбранный поток'), h('option', { value: 'scope' }, 'Выбранный курс — потоки в моей зоне контроля'));
          const form = h('section', { class: 'card' }, h('h3', {}, 'Новое объявление · ' + data.course + ' курс'), text, h('label', {}, 'Показывать до (включительно)', until), h('label', {}, 'Получатели', target));
          form.append(h('button', { class: 'big', type: 'button', onclick: safe(async () => {
            guard();
            if (writing) return false;
            if (!text.value.trim() || !until.value || until.value < today || until.value > add(today, 120)) throw new Error('Проверьте текст и срок объявления');
            return write({ action: 'add', text: text.value, until: until.value, target: target.value, course: data.course, stream: data.stream });
          }) }, 'Опубликовать'));
          body.append(form);
        } else body.append(h('p', { class: 'muted' }, 'Нет права публиковать объявления для выбранного потока.'));
        const list = h('section', { class: 'card' }, h('h3', {}, 'Мои активные объявления'));
        if (!data.mine?.length) list.append(h('p', { class: 'muted' }, 'Активных объявлений нет'));
        for (const item of data.mine || []) list.append(h('div', { class: 'linkform' }, h('p', { style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, item.text), h('p', { class: 'muted' }, 'До ' + fmt(item.until) + (item.legacy ? ' · Скрыто: требуется повторная публикация' : ' · ' + item.course + ' курс')), h('button', { type: 'button', class: 'big alt', onclick: safe(async () => {
          guard();
          if (writing) return false;
          if (!(await ask('Удалить объявление?'))) return false;
          return write({ action: 'delete', id: item.id });
        }) }, 'Удалить объявление')));
        body.append(list);
      } catch (e) {
        if (alive() && seq === ticket) {
          loaded = false;
          news.replaceChildren(message, h('p', { class: 'err' }, String(e.message || e)), h('button', { type: 'button', class: 'big', onclick: () => { if (!writing) loadManager(); } }, 'Повторить загрузку'));
        }
      }
    }
    const tabs = h('div', { class: 'editor-tabs', role: 'tablist', 'aria-label': 'Раздел редактирования' });
    function select(name) {
      if (writing || [...dialog.querySelectorAll('button')].some(node => node.disabled)) return;
      schedule.hidden = name !== 'schedule'; news.hidden = name !== 'news';
      for (const button of tabs.children) {
        const active = button.dataset.panel === name;
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
      }
      if (name === 'news' && !loaded) loadManager();
    }
    for (const [key, title] of [['schedule', 'Расписание'], ['news', 'Объявления']]) {
      const button = h('button', { type: 'button', class: 'chip', id: 'editor-' + key + '-tab', role: 'tab', 'data-panel': key, 'aria-controls': 'editor-' + key + '-panel', 'aria-selected': String(key === 'schedule'), tabindex: key === 'schedule' ? '0' : '-1', onclick: () => select(key) }, title);
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'schedule' : event.key === 'End' ? 'news' : key === 'schedule' ? 'news' : 'schedule';
        select(next);
        tabs.querySelector('[aria-selected=true]')?.focus();
      });
      tabs.append(button);
    }
    header.after(tabs, schedule, news);
    if (close) dialog.append(close);
  }
  let queued = false;
  function scan() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; mountPublic(); mountEditor(); });
  }
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
})();
