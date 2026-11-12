// Targeted UX additions on the existing layout. No global recolouring or data migration.
(function () {
  if (typeof h !== 'function' || typeof call !== 'function') return;
  const view = document.getElementById('view');
  if (!view) return;
  const originalH = h, originalCall = call;
  const tasks = new Set(), locks = new WeakMap();
  let executing = null, frame = 0, days = [], daysContext = '', feed = null, feedTicket = 0;
  const context = () => { const user = S.boot?.user || {}; return JSON.stringify([user.course || '', user.stream || '']); };
  const readActions = new Set(['list','stats','assistants','inbox','refresh','history','archive','track','feed','photo','send']);
  const write = (name, p) => ['settings','alerts','hwAlerts','remindAt'].includes(name) || Boolean(p?.action && !p.preview && !readActions.has(p.action));
  const style = document.createElement('style');
  style.textContent = '.lesson .ui-room{font-weight:650;background:rgba(36,129,204,.1);box-shadow:inset 0 0 0 1px var(--tg-theme-button-color,#2481cc)}@supports(background:color-mix(in srgb,red,transparent)){.lesson .ui-room{background:color-mix(in srgb,var(--tg-theme-button-color,#2481cc) 10%,transparent)}}.ux-change-info{font-size:12px;margin:6px 0}.ux-change-info>summary{cursor:pointer;color:var(--tg-theme-link-color,#2481cc)}.ux-change-info p{margin:4px 0}.lesson-menu>.ux-action-context{flex-basis:100%;font-size:12px;color:var(--tg-theme-hint-color,#777);margin:4px 0}.ux-save-result{font-size:13px;margin:6px 0;overflow-wrap:anywhere}.ux-club-description{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}.ux-event-date{font-weight:600}';
  document.head.append(style);
  function node(tag, text, className) { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; }
  function result(task, text, error) {
    const host = task.button.closest('.linkform,section.card,dialog.lesson-sheet') || task.button.parentElement;
    if (!host?.isConnected) return;
    let message = [...host.children].find(child => child.classList.contains('ux-save-result'));
    if (!message) { message = node('p', '', 'ux-save-result'); host.append(message); }
    message.textContent = text; message.classList.toggle('err', error); message.setAttribute('role', error ? 'alert' : 'status');
  }
  function busy(task, params) {
    if (task.started) return; task.started = true;
    const button = task.button;
    task.disabled = button.disabled; task.ariaBusy = button.getAttribute('aria-busy'); task.nodes = [...button.childNodes];
    task.busyText = /delete|remove|clear|drop|cancel/.test(params?.action || '') ? 'Удаляем…' : 'Сохраняем…';
    button.disabled = true; button.setAttribute('aria-busy', 'true');
    if (button.textContent.trim().length >= 4) { task.labelChanged = true; button.replaceChildren(task.busyText); }
  }
  h = function (tag, attrs, ...children) {
    let element;
    if (tag === 'button' && typeof attrs?.onclick === 'function') {
      const handler = attrs.onclick;
      attrs = { ...attrs, onclick: async function (event) {
        if (locks.has(element)) return;
        const task = { button: element, requests: 0, error: null, started: false };
        locks.set(element, task); tasks.add(task);
        const previous = executing; executing = task;
        try {
          let returned;
          try { returned = handler.call(this, event); } finally { executing = previous; }
          await returned;
          if (task.requests) result(task, task.error ? task.error + ' Проверьте результат перед повторной отправкой.' : 'Сохранено', Boolean(task.error));
        } catch (error) { result(task, error.message || String(error), true); }
        finally {
          tasks.delete(task); locks.delete(element);
          if (task.started) {
            element.disabled = task.disabled;
            if (task.ariaBusy === null) element.removeAttribute('aria-busy'); else element.setAttribute('aria-busy', task.ariaBusy);
            if (task.labelChanged && element.textContent === task.busyText) element.replaceChildren(...task.nodes);
          }
        }
      } };
    }
    element = originalH(tag, attrs, ...children);
    return element;
  };
  call = function (name, input, cache) {
    let params = input || {}, target = name;
    const task = executing || (tasks.size === 1 ? tasks.values().next().value : null);
    const isWrite = write(name, params);
    if (name === 'clubs' && ['feed','feed_add','feed_edit','feed_delete'].includes(params.action)) {
      target = 'clubFeed';
      if (params.action === 'feed_add' || params.action === 'feed_edit') {
        const form = task?.button.closest('.linkform');
        const date = form?.querySelector('[data-ux-event-date]'), time = form?.querySelector('[data-ux-event-time]');
        if (date && time) params = { ...params, eventDate: date.value, eventTime: time.value };
      }
    }
    const capturedContext = context();
    const ticket = target === 'clubFeed' && params.action === 'feed' ? ++feedTicket : 0;
    if (isWrite && task) { task.requests++; busy(task, params); }
    let request;
    try { request = originalCall(target, params, cache); } catch (error) { request = Promise.reject(error); }
    request.then(data => {
      if (name === 'range' && context() === capturedContext && Array.isArray(data)) { days = data; daysContext = capturedContext; schedule(); }
      if (ticket && ticket === feedTicket) { feed = data; schedule(); }
    }, error => { if (isWrite && task) task.error = error.message || String(error); });
    return request;
  };
  function describeSlot(slot) { return [slot.date, slot.start + (slot.end ? '–' + slot.end : '')].filter(Boolean).join(' '); }
  function lessons() {
    for (const row of view.querySelectorAll('.lesson')) {
      const body = row.querySelector(':scope>.grow'), title = body?.querySelector(':scope>b');
      if (!body || !title) continue;
      const menu = row.querySelector('.lesson-menu');
      if (menu && !menu.querySelector('.ux-action-context')) menu.prepend(node('div', 'Действия: ' + title.textContent + '. Избранное и заметки — личные; правки и ссылки — для потока.', 'ux-action-context'));
      const edit = [...row.querySelectorAll('.linkform')].find(form => [...form.children].some(child => child.tagName === 'BUTTON' && child.textContent.trim() === 'Отменить пару'));
      if (edit && !edit.querySelector('.ux-edit-context')) edit.prepend(node('p', 'Изменения занятия применяются к выбранному потоку. Для массовых действий проверьте область применения.', 'muted ux-edit-context'));
      if (daysContext !== context() || body.querySelector('.ux-change-info')) continue;
      const header = row.closest('section.card')?.querySelector('h3')?.textContent;
      const day = days.find(d => d.label === header) || (S.tab === 'day' ? days.find(d => d.date === S.date) : null);
      const start = row.querySelector(':scope>.time')?.textContent.slice(0, 5);
      const summary = title.textContent.replace(/^★\s*/, '').replace(/\s*💻$/, '').trim();
      const matches = (day?.items || []).filter(item => item.start === start && item.summary === summary);
      if (matches.length !== 1 || !matches[0].uiChanges) continue;
      const changes = matches[0].uiChanges, labels = [];
      if (changes.room) labels.push('Аудитория изменена'); if (changes.time) labels.push('Перенесено');
      if (!labels.length) continue;
      const details = node('details', undefined, 'ux-change-info'); details.append(node('summary', labels.join(' · ')));
      if (changes.room) details.append(node('p', 'Аудитория: ' + (changes.room.before === null ? 'исходная неизвестна' : changes.room.before || 'не указана') + ' → ' + (changes.room.after || 'не указана')));
      if (changes.time) details.append(node('p', 'Было: ' + describeSlot(changes.time.before) + '. Стало: ' + describeSlot(changes.time.after)));
      const meta = body.querySelector(':scope>.ui-meta'); if (meta) meta.after(details); else title.after(details);
    }
  }
  function clubs() {
    if (S.tab !== 'clubs') return;
    for (const card of view.querySelectorAll('section.card[role=button]')) card.querySelector(':scope>p:last-of-type')?.classList.add('ux-club-description');
    const box = view.querySelector('.club-feed');
    if (!box || !feed?.club || view.querySelector('.club-about h3')?.textContent !== feed.club.name) return;
    for (const row of [...box.children].filter(child => child.classList.contains('linkform'))) {
      const title = row.querySelector(':scope>h3'), body = row.querySelector(':scope>p:not(.muted)'), publication = row.querySelector(':scope>p.muted');
      if (!title || !body || !publication) continue;
      const matches = (feed.items || []).filter(post => post.title === title.textContent && post.text === body.textContent && publication.textContent.includes(new Date(post.at).toLocaleString('ru-RU')) && publication.textContent.includes(post.by));
      if (matches.length !== 1) continue;
      const post = matches[0]; row.classList.add('ux-club-post'); row.dataset.uxPost = post.id;
      if (!publication.dataset.uxPublication) { publication.dataset.uxPublication = '1'; publication.textContent = 'Опубликовано: ' + publication.textContent; }
      let dateLine = row.querySelector(':scope>.ux-event-date');
      if (!dateLine) { dateLine = node('p', '', 'ux-event-date'); publication.before(dateLine); }
      const label = post.eventDate ? 'Мероприятие: ' + post.eventDate.split('-').reverse().join('.') + (post.eventTime ? ', ' + post.eventTime + ' МСК' : '') : 'Дата мероприятия не указана';
      if (dateLine.textContent !== label) dateLine.textContent = label;
    }
    for (const title of box.querySelectorAll('input[placeholder="Заголовок анонса"]')) {
      const form = title.closest('.linkform'); if (!form || form.querySelector('[data-ux-event-date]')) continue;
      const id = form.closest('.ux-club-post')?.dataset.uxPost;
      const old = (feed.items || []).find(post => post.id === id);
      const dateLabel = node('label', 'Дата мероприятия (необязательно)'), date = node('input'); date.type = 'date'; date.dataset.uxEventDate = '1'; date.value = old?.eventDate || ''; dateLabel.append(date);
      const timeLabel = node('label', 'Время мероприятия, МСК (необязательно)'), time = node('input'); time.type = 'time'; time.dataset.uxEventTime = '1'; time.value = old?.eventTime || ''; timeLabel.append(time);
      const button = [...form.children].find(child => child.tagName === 'BUTTON');
      if (button) button.before(dateLabel, timeLabel);
    }
  }
  function decorate() { frame = 0; lessons(); clubs(); }
  function schedule() { if (!frame) frame = requestAnimationFrame(decorate); }
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
})();
