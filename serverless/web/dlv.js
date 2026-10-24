// Вкладка «Рассылки» в админ-панели: итоги последних рассылок, причины ошибок, повтор отправки. Подключается после subj.js
(function () {
  const stamp = (ms) => {
    const d = new Date(ms + 3 * 3600000);
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getUTCDate()) + '.' + p(d.getUTCMonth() + 1) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
  };

  function card(x, redraw) {
    const c = h('section', { class: 'card' },
      h('b', {}, stamp(x.t) + ' · ' + x.kind),
      h('div', { class: 'muted' }, x.scope),
      h('p', {}, '✅ ' + x.ok + ' из ' + x.expected + (x.failed ? ' · ❌ ' + x.failed : '')));
    const bad = Object.entries(x.reasons).map(([k, n]) => k + ': ' + n)
      .concat(Object.entries(x.transient).map(([k, n]) => k + ': ' + n + ' — временная ошибка'));
    for (const t of bad) c.append(h('div', { class: 'muted' }, '• ' + t));
    if (x.canRetry) {
      c.append(h('button', { class: 'mini', onclick: safe(async () => {
        if (!(await ask('Повторить отправку ' + x.retry + ' получателям?'))) return false;
        const r = await call('dlv', { action: 'retry', id: x.id });
        alertMsg('Доставлено: ' + r.retried.ok + ', осталось с ошибкой: ' + r.retried.left);
        redraw();
      }) }, '🔁 Повторить (' + x.retry + ')'));
    } else if (x.auto) {
      c.append(h('div', { class: 'muted' }, 'Временные ошибки напоминаний повторяются автоматически, пока идёт время рассылки'));
    }
    return c;
  }

  function draw(body, chip) {
    body.replaceChildren(h('p', { class: 'muted center' }, 'Загрузка…'));
    call('dlv', { action: 'list' }).then((r) => {
      if (!chip.classList.contains('on')) return;
      const items = (r && r.items) || [];
      body.replaceChildren(h('section', { class: 'card' }, h('h3', {}, 'Рассылки'),
        h('p', { class: 'muted' }, 'Последние отправки сообщений: сколько ожидалось, доставлено и почему не дошли. «Доставлено» значит, что Telegram принял сообщение, но не что его прочитали.')),
        ...(items.length ? items.map((x) => card(x, () => draw(body, chip))) : [h('p', { class: 'muted center' }, 'Рассылок пока не было')]));
    }).catch((e) => {
      if (chip.classList.contains('on')) body.replaceChildren(h('p', { class: 'err' }, 'Ошибка: ' + ((e && e.message) || e)));
    });
  }

  // Админ-панель создаётся в settings.js: [панель-заголовок, вкладки, содержимое]. Добавляем вкладку «Рассылки»
  function hook() {
    const panel = document.getElementById('admin-panel');
    if (!panel || panel.dataset.dlv) return;
    const tabs = panel.children[1];
    const body = panel.children[2];
    if (!tabs || !body) return;
    panel.dataset.dlv = '1';
    const chip = h('button', { class: 'chip', 'data-k': 'dlv' }, 'Рассылки');
    chip.addEventListener('click', () => {
      buzz.tap();
      for (const b of tabs.children) b.className = 'chip' + (b === chip ? ' on' : '');
      draw(body, chip);
    });
    tabs.append(chip);
  }

  new MutationObserver(() => {
    try { hook(); } catch (e) {}
  }).observe(document.body, { childList: true });
})();
