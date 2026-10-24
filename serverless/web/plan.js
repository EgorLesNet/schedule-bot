// Предпросмотр массового сдвига пар: таблица «было → станет» с замечаниями, применение только после подтверждения. Подключается после hwx.js
(function () {
  const ru = (d) => d.slice(8) + '.' + d.slice(5, 7);

  function previewPanel(data, params, slot) {
    const rows = [];
    for (const r of data.rows) {
      rows.push(h('tr', {}, h('td', {}, ru(r.date)), h('td', {}, r.from), h('td', { style: 'font-weight:600' }, r.to)));
      for (const t of r.problems) rows.push(h('tr', {}, h('td', { colspan: '3', style: 'color:#d33;padding:0 0 6px' }, '⛔ ' + t)));
      for (const t of r.warns) rows.push(h('tr', {}, h('td', { colspan: '3', style: 'color:#c80;padding:0 0 6px' }, '⚠️ ' + t)));
    }
    const table = h('table', { style: 'width:100%;border-collapse:collapse;font-size:13px;text-align:left' },
      h('tr', {}, h('th', {}, 'Дата'), h('th', {}, 'Было'), h('th', {}, 'Станет')), ...rows);
    const allow = h('input', { type: 'checkbox' });
    const apply = h('button', { class: 'mini', onclick: safe(async () => {
      await call('schedit', Object.assign({ action: 'shift', token: data.token, allowOverlap: allow.checked }, params));
      alertMsg('✓ Время пар (' + data.count + ') сдвинуто, студентам отправлено уведомление');
      render();
    }) }, '✓ Применить');
    const box = h('div', { class: 'hw-preview linkform' }, h('b', {}, 'Предпросмотр: ' + data.count + ' пар'), table);
    if (data.hard) {
      box.append(h('p', { class: 'err' }, 'Есть проблемы, которые блокируют применение. Выберите другой сдвиг или область.'));
    } else {
      if (data.overlaps) {
        apply.disabled = true;
        allow.addEventListener('change', () => { apply.disabled = !allow.checked; });
        box.append(h('label', { class: 'row' }, allow, 'Всё равно применить, несмотря на пересечения'));
      }
      box.append(apply);
    }
    box.append(h('button', { class: 'mini alt', onclick: () => { buzz.tap(); slot.replaceChildren(); } }, 'Закрыть'));
    return box;
  }

  // В блоке «Сдвинуть все пары предмета» (files.js) кнопка «Сдвинуть» заменяется на «Предпросмотр сдвига»
  function hook(root) {
    for (const box of root.querySelectorAll('.shift-box')) {
      if (box.dataset.plan) continue;
      const old = [...box.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Сдвинуть');
      const sels = box.querySelectorAll('select');
      const form = box.closest('.linkform');
      if (!old || sels.length < 2 || !form) continue;
      const date = (form.querySelector('input[type=date]') || {}).value;
      const summary = ((form.querySelector('input[type=text]') || {}).value || '').trim();
      if (!date || !summary) continue;
      box.dataset.plan = '1';
      const [sel, scope] = sels;
      const slot = h('div', {});
      const btn = h('button', { class: 'mini', onclick: safe(async () => {
        const params = { summary, date, minutes: Number(sel.value), scope: scope.value };
        const data = await call('schedit', Object.assign({ action: 'shift', preview: true }, params));
        slot.replaceChildren(previewPanel(data, params, slot));
      }) }, '👁 Предпросмотр сдвига');
      old.replaceWith(btn);
      box.append(slot);
    }
  }

  const view = document.getElementById('view');
  if (view) {
    new MutationObserver(() => {
      try { hook(view); } catch (e) {}
    }).observe(view, { childList: true, subtree: true });
  }
})();
