// UX improvements. Does not reassign const alertMsg or const safe.
(function () {
  const view = document.getElementById('view');
  if (!view) return;
  const style = document.createElement('style');
  style.textContent = '.ux-hero{border-left:4px solid var(--tg-theme-button-color,#2481cc);padding:16px}.ux-title{font-size:21px;line-height:1.3;margin:6px 0}.ux-meta{font-size:14px;line-height:1.5}.ux-group{border-radius:18px;background:var(--tg-theme-secondary-bg-color,#f1f1f4);margin-bottom:12px}.ux-group>summary{padding:16px;cursor:pointer;font-weight:600}.ux-body{padding:0 8px 8px}.ux-body>.card{margin-bottom:8px}.ux-toast{position:fixed;z-index:150;bottom:calc(100px + env(safe-area-inset-bottom,0px));left:50%;transform:translateX(-50%);max-width:85vw;padding:12px 18px;border-radius:16px;background:var(--tg-theme-button-color,#2481cc);color:var(--tg-theme-button-text-color,#fff);box-shadow:0 4px 18px #0003;font-size:14px;pointer-events:none}';
  document.head.append(style);
  let notice, timer, serial = 0;
  function toast(message) {
    serial++;
    if (notice) notice.remove();
    clearTimeout(timer);
    notice = h('div', {class:'ux-toast',role:'status','aria-live':'polite'}, message);
    document.body.append(notice);
    timer = setTimeout(() => { if (notice) notice.remove(); notice = null; }, 2400);
  }
  const api = window.Telegram && window.Telegram.WebApp;
  if (api && typeof api.showAlert === 'function') {
    const original = api.showAlert.bind(api);
    try {
      api.showAlert = function (message, callback) {
        if (!/^(?:✓|✅|Заметка сохранена|Отправлено в чат с ботом:|Отправлено на проверку ассистенту)/.test(String(message))) return original(message, callback);
        toast(message);
        if (callback) setTimeout(callback, 0);
      };
    } catch (e) {}
  }
  // Only confirmed successful writes get a toast. No automatic retries.
  const labels = {
    settings: { '': 'Настройки сохранены' },
    alerts: { '': 'Настройки уведомлений сохранены' },
    hwAlerts: { '': 'Настройки уведомлений сохранены' },
    remindAt: { '': 'Время напоминания сохранено' },
    homework: { add:'ДЗ сохранено', delete:'ДЗ удалено' },
    link: { set:'Ссылка сохранена', delete:'Ссылка удалена' },
    clubs: { club_add:'Клуб добавлен', club_edit:'Клуб сохранён', club_delete:'Клуб удалён', club_move:'Порядок обновлён', section_add:'Раздел добавлен', section_edit:'Раздел сохранён', section_delete:'Раздел удалён', visibility:'Видимость страницы обновлена' }
  };
  const previousCall = call;
  call = function (name, input, cache) {
    const result = previousCall(name, input, cache);
    const label = labels[name] && labels[name][input && input.action || ''];
    if (label) result.then(() => {
      const seen = serial;
      setTimeout(() => { if (seen === serial) toast(label); }, 500);
    }).catch(() => {});
    return result;
  };
  // This is a function declaration in app.js, not a const binding.
  liveBanner = function (day) {
    const box = h('section', {class:'card ux-hero'});
    let fingerprint = '';
    function draw() {
      const now = nowMsk();
      box.hidden = day.date !== now.date;
      if (box.hidden) return;
      const items = day.items.filter(i => !/обед|перерыв/i.test(i.summary)).slice().sort((a,b) => a.start.localeCompare(b.start));
      const current = items.find(i => mins(i.start) <= now.min && now.min < mins(i.end));
      const item = current || items.find(i => mins(i.start) > now.min);
      const next = JSON.stringify([now.min,item,!!current]);
      if (next === fingerprint) return;
      fingerprint = next;
      if (!item) {
        box.replaceChildren(h('div',{class:'muted'},'Сегодня'),h('h2',{class:'ux-title'},items.length ? 'Пары закончились' : 'Сегодня без занятий'));
        return;
      }
      const label = current ? 'Сейчас идёт · до конца ' + fmtMin(mins(item.end)-now.min) : 'Следующая пара · через ' + fmtMin(mins(item.start)-now.min);
      box.replaceChildren(h('div',{class:'muted'},label),h('h2',{class:'ux-title'},item.summary),h('div',{class:'ux-meta'},item.start+'–'+item.end),h('div',{class:'ux-meta'},[item.room ? 'Аудитория: '+item.room : 'Аудитория не указана',item.teacher || ''].filter(Boolean).join(' · ')));
      if (item.link) box.append(h('button',{onclick:()=>{buzz.tap();openLink(item.link);}},'Подключиться'));
    }
    draw();
    clearInterval(S.timer);
    S.timer = setInterval(draw,30000);
    return box;
  };
  const opened = new Map();
  function group() {
    if (S.tab !== 'set') return;
    const cards = Array.from(view.querySelectorAll('section.card'));
    const heading = c => c.querySelector('h3')?.textContent.trim();
    const definitions = [
      ['schedule','Моё расписание',true,c=>c.querySelectorAll('select').length>=3],
      ['notifications','Уведомления',true,c=>c.matches('.alerts-card,.remind-card,.hwalerts-card')],
      ['calendar','Календарь и быстрый доступ',false,c=>['Календарь','Быстрый доступ'].includes(heading(c))],
      ['changes','Изменения расписания',false,c=>heading(c)==='Изменения расписания'],
      ['admin','Администрирование',false,c=>c.matches('.ad-admin')]
    ];
    for (const [id,title,initial,matches] of definitions) {
      const targets = cards.filter(matches);
      if (!targets.length) continue;
      let section = view.querySelector('[data-ux-group="'+id+'"]');
      if (!section) {
        section = h('details',{class:'ux-group','data-ux-group':id},h('summary',{},title),h('div',{class:'ux-body'}));
        section.open = opened.has(id) ? opened.get(id) : initial;
        section.addEventListener('toggle',()=>opened.set(id,section.open));
        targets[0].before(section);
      }
      const body = section.querySelector('.ux-body');
      for (const card of targets) if (card.parentElement !== body) body.append(card);
    }
  }
  let queued = false;
  new MutationObserver(()=>{
    if (queued) return;
    queued = true;
    requestAnimationFrame(()=>{queued=false;try{group();}catch(e){}});
  }).observe(view,{childList:true,subtree:true});
  group();
})();
