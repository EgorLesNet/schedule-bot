// Правка ДЗ с историей версий, черновики формы, архив заданий и анимации. Подключается после menu.js
(function () {
  // ---------- Анимации: короткое появление; отключаются при настройке системы «уменьшить движение» ----------
  const css = document.createElement('style');
  css.textContent = [
    '@keyframes sbIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}',
    '.lesson-menu,.hw-form-toggle+.card,.hw-editor,.hw-hist,.hw-preview,.hw-draft,.hw-archive .card,.exam-card{animation:sbIn .22s ease both}',
    '.sb-toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:60;padding:10px 16px;border-radius:16px;background:var(--tg-theme-button-color,#2481cc);color:var(--tg-theme-button-text-color,#fff);font-size:14px;animation:sbIn .2s ease both;pointer-events:none}',
    '.sb-toast.out{opacity:0;transition:opacity .3s ease}',
    '@media (prefers-reduced-motion:reduce){.lesson-menu,.hw-form-toggle+.card,.hw-editor,.hw-hist,.hw-preview,.hw-draft,.hw-archive .card,.exam-card,.sb-toast{animation:none!important}.sb-toast.out{transition:none}}',
  ].join('');
  document.head.append(css);

  const toast = (msg) => {
    const t = h('div', { class: 'sb-toast' }, msg);
    document.body.append(t);
    setTimeout(() => t.classList.add('out'), 1800);
    setTimeout(() => t.remove(), 2200);
  };
  const ru = (d) => d.split('-').reverse().join('.');
  const whenOf = (ms) => {
    const dt = new Date(ms + 3 * 3600000);
    const day = dt.toISOString().slice(0, 10);
    const now = nowMsk().date;
    const label = day === now ? 'сегодня' : day === add(now, -1) ? 'вчера' : ru(day).slice(0, 5);
    return label + ' ' + hhmm(dt.getUTCHours() * 60 + dt.getUTCMinutes());
  };

  // ---------- Правка ДЗ: текст, дата, отдельные файлы, предпросмотр перед сохранением ----------
  function editor(item) {
    const text = h('textarea', { rows: 4, maxlength: '1000' });
    text.value = item.text;
    const date = h('input', { type: 'date', value: item.date });
    const removed = new Set();
    const pick = new Set();
    let inbox = [];
    const filesBox = h('div', {});
    const drawFiles = () => {
      filesBox.replaceChildren(...(item.files || []).map((f) => {
        const gone = removed.has(f.uid);
        return h('div', { class: 'erow' },
          h('span', { style: gone ? 'text-decoration:line-through;opacity:.5' : '' }, '📎 ' + f.name),
          h('button', { class: 'mini' + (gone ? '' : ' danger'), onclick: () => { buzz.tap(); if (gone) removed.delete(f.uid); else removed.add(f.uid); drawFiles(); } }, gone ? 'Вернуть' : 'Убрать'));
      }));
    };
    drawFiles();
    const inboxBox = h('div', {});
    call('files', { action: 'inbox' }).then((r) => {
      inbox = (r && r.items) || [];
      if (!inbox.length) return;
      inboxBox.replaceChildren(h('div', { class: 'muted' }, 'Добавить из присланных боту:'), ...inbox.map((f) => {
        const cb = h('input', { type: 'checkbox' });
        cb.addEventListener('change', () => { if (cb.checked) pick.add(f.id); else pick.delete(f.id); });
        return h('label', { class: 'row' }, cb, '📄 ' + f.name);
      }));
    }).catch(() => {});
    const preview = h('div', {});
    const showPreview = () => {
      if (!text.value.trim()) { buzz.err(); return; }
      const names = (item.files || []).filter((f) => !removed.has(f.uid)).map((f) => f.name).concat(inbox.filter((f) => pick.has(f.id)).map((f) => f.name));
      const moved = date.value && date.value !== item.date;
      preview.replaceChildren(h('div', { class: 'hw-preview linkform' },
        h('b', {}, 'Так увидят студенты'),
        h('div', { class: 'muted' }, item.subject + ' · ' + ru(date.value || item.date) + (moved ? ' (перенос с ' + ru(item.date) + ')' : '')),
        h('p', { style: 'white-space:pre-wrap' }, linkify(text.value)),
        names.length ? h('div', { class: 'muted' }, '📎 ' + names.join(', ')) : null,
        h('button', { class: 'mini', onclick: safe(async () => {
          await call('homework', { action: 'edit', subject: item.subject, date: item.date, newDate: date.value || item.date, text: text.value, removeFiles: [...removed], files: [...pick] });
          toast('✓ Сохранено');
          render();
        }) }, '✓ Сохранить'),
        h('button', { class: 'mini alt', onclick: () => { buzz.tap(); preview.replaceChildren(); } }, 'Изменить')));
    };
    return h('div', { class: 'linkform hw-editor' }, text,
      h('label', {}, h('span', { class: 'muted' }, 'Дата'), date),
      filesBox, inboxBox,
      h('button', { class: 'mini alt', onclick: () => { buzz.tap(); showPreview(); } }, '👁 Предпросмотр'),
      preview);
  }

  // ---------- История версий с возвратом ----------
  function historyPanel(item) {
    const box = h('div', { class: 'linkform hw-hist' }, h('p', { class: 'muted' }, 'Загрузка…'));
    call('homework', { action: 'history', subject: item.subject, date: item.date }).then((r) => {
      const vs = (r && r.versions) || [];
      box.replaceChildren(h('b', {}, 'История версий'), ...(vs.length ? vs.map((v, k) => h('div', { class: 'linkform' },
        h('div', { class: 'muted' }, v.t ? whenOf(v.t) + (v.by ? ' · ' + v.by : '') : 'до появления истории'),
        h('div', { style: 'white-space:pre-wrap' }, v.text.slice(0, 200)),
        k === 0
          ? h('div', { class: 'muted' }, 'Текущая версия')
          : h('button', { class: 'mini', onclick: safe(async () => {
            if (!(await ask('Вернуть эту версию текста? Вложения не изменятся.'))) return false;
            await call('homework', { action: 'restore', subject: item.subject, date: item.date, index: v.i });
            toast('✓ Версия возвращена');
            render();
          }) }, 'Вернуть'))) : [h('p', { class: 'muted' }, 'История пока пуста')]));
    }).catch(() => box.replaceChildren(h('p', { class: 'err' }, 'Не удалось загрузить историю')));
    return box;
  }

  // ---------- Карточки ДЗ: пометка «Изменено…» и кнопки «Редактировать», «История» (ассистентам) ----------
  function cardTools(root) {
    for (const el of root.querySelectorAll('.hwc')) {
      if (el.querySelector('.hw-tools')) continue;
      const title = (el.querySelector('b') || {}).textContent || '';
      const item = S.hwItems && S.hwItems[title];
      if (!item) continue;
      const tools = h('div', { class: 'hw-tools' });
      if (item.edited) tools.append(h('div', { class: 'muted' }, '✏️ Изменено · ' + (item.edited.by || 'староста') + ' · ' + whenOf(item.edited.t)));
      if (S.boot && S.boot.assistant) {
        const slot = h('div', {});
        const open = (kind, build) => () => {
          buzz.tap();
          if (slot.dataset.k === kind) { slot.replaceChildren(); slot.dataset.k = ''; } else { slot.replaceChildren(build()); slot.dataset.k = kind; }
        };
        tools.append(
          h('button', { class: 'mini alt', onclick: open('edit', () => editor(item)) }, '✏️ Редактировать'),
          h('button', { class: 'mini alt', onclick: open('hist', () => historyPanel(item)) }, '🕘 История'),
          slot);
      }
      el.append(tools);
    }
  }

  // ---------- Архив: «Актуальные» / «Архив» с поиском и подгрузкой ----------
  function archiveCard(x) {
    const c = h('section', { class: 'card' }, h('b', {}, x.subject + ' · ' + ru(x.date)), h('p', { style: 'white-space:pre-wrap' }, linkify(x.text)));
    if (x.files && x.files.length) {
      c.append(h('div', { class: 'muted' }, '📎 ' + x.files.map((f) => f.name).join(', ')),
        h('button', { class: 'mini', onclick: safe(async () => {
          const r = await call('files', { action: 'send', subject: x.subject, date: x.date });
          alertMsg('Отправлено в чат с ботом: ' + r.sent + ' из ' + r.total);
        }) }, '📎 Получить файлы в чат'));
    }
    return c;
  }

  function initArchive(box) {
    let q = '';
    let offset = 0;
    let seq = 0;
    let timer = 0;
    const input = h('input', { type: 'text', class: 'hw-q', placeholder: 'Поиск по предмету и тексту' });
    const list = h('div', {});
    const info = h('p', { class: 'muted center' }, '');
    const more = h('button', { class: 'mini alt', style: 'display:none' }, 'Показать ещё');
    const load = async (reset) => {
      const my = ++seq;
      if (reset) { offset = 0; list.replaceChildren(); }
      info.textContent = 'Загрузка…';
      try {
        const r = await call('homework', { action: 'archive', q, offset });
        if (my !== seq) return;
        for (const x of r.items) list.append(archiveCard(x));
        offset += r.items.length;
        more.style.display = r.more ? '' : 'none';
        info.textContent = offset ? '' : 'Ничего не найдено';
      } catch (e) {
        if (my === seq) info.textContent = 'Не удалось загрузить архив';
      }
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { q = input.value.trim(); load(true); }, 350); });
    more.addEventListener('click', () => { buzz.tap(); load(false); });
    box.append(input, info, list, more);
    load(true);
  }

  function archiveTabs(root) {
    if (root.querySelector('.hw-tabs')) return;
    const toggle = root.querySelector('.hw-form-toggle');
    const form = toggle && toggle.nextElementSibling;
    if (!form) return;
    const tabNow = h('button', { class: 'chip on' }, 'Актуальные');
    const tabOld = h('button', { class: 'chip' }, 'Архив');
    const bar = h('div', { class: 'toolbar hw-tabs' }, tabNow, tabOld);
    const box = h('div', { class: 'hw-archive', style: 'display:none' });
    form.after(bar);
    bar.after(box);
    const show = (arch) => {
      tabNow.className = 'chip' + (arch ? '' : ' on');
      tabOld.className = 'chip' + (arch ? ' on' : '');
      for (const e of root.querySelectorAll('.hwc, .hw-group')) e.style.display = arch ? 'none' : '';
      box.style.display = arch ? '' : 'none';
      if (arch && !box.dataset.ready) { box.dataset.ready = '1'; initArchive(box); }
    };
    tabNow.addEventListener('click', () => { buzz.tap(); show(false); });
    tabOld.addEventListener('click', () => { buzz.tap(); show(true); });
  }

  // ---------- Черновик формы ДЗ: текст, предмет, дата и отмеченные файлы; хранится на устройстве 7 дней ----------
  const dkey = () => {
    const u = (S.boot && S.boot.user) || {};
    return 'sb-draft:' + (S.boot && S.boot.assistant ? 'add' : 'propose') + ':' + (u.course || '') + ':' + (u.stream || '');
  };
  const readDraft = () => {
    try {
      const d = JSON.parse(localStorage.getItem(dkey()) || 'null');
      return d && Date.now() - d.t < 7 * 86400000 ? d : null;
    } catch (e) { return null; }
  };
  const formOf = (root) => [...root.querySelectorAll('section.card')].find((s) => {
    const t = s.querySelector('h3');
    return t && /^(Добавить ДЗ|💡 Предложить ДЗ)$/.test(t.textContent.trim());
  });

  async function restoreDate(form, date) {
    const [y, m, dd] = date.split('-').map(Number);
    const want = MONTHS[m - 1] + ' ' + y;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 120));
      const cal = form.querySelector('.cal');
      const head = cal && cal.querySelector('.head b');
      if (!head) continue;
      if (head.textContent !== want) {
        const [prev, next] = cal.querySelectorAll('.head button');
        const cur = head.textContent.split(' ');
        const curIdx = Number(cur[1]) * 12 + MONTHS.indexOf(cur[0]);
        (curIdx > y * 12 + (m - 1) ? prev : next).click();
        continue;
      }
      const btn = [...cal.querySelectorAll('button.d')].find((b) => b.textContent.trim() === String(dd) && !b.disabled);
      if (btn) btn.click();
      return;
    }
  }

  function resume(form, sel, ta, d) {
    const toggle = form.previousElementSibling;
    if (form.style.display === 'none' && toggle && toggle.classList.contains('hw-form-toggle')) toggle.click();
    ta.value = d.text;
    if ([...sel.options].some((o) => o.value === d.subject)) {
      sel.value = d.subject;
      sel.dispatchEvent(new Event('change'));
    }
    S.hwPick = new Set(d.pick || []);
    const refresh = [...form.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Обновить');
    if (refresh) refresh.click();
    if (d.date) restoreDate(form, d.date);
  }

  function draftForm(root) {
    const form = formOf(root);
    if (!form || form.dataset.draft) return;
    const sel = form.querySelector('select');
    const ta = form.querySelector('textarea');
    if (!sel || !ta) return;
    form.dataset.draft = '1';
    const dateOf = () => {
      const p = [...form.querySelectorAll('p')].find((x) => /^Выбрано: /.test(x.textContent));
      const m = p && /(\d{2})\.(\d{2})\.(\d{4})/.exec(p.textContent);
      return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
    };
    let tm = 0;
    const save = () => {
      clearTimeout(tm);
      tm = setTimeout(() => {
        if (!document.body.contains(form)) return;
        if (!ta.value.trim()) { localStorage.removeItem(dkey()); return; }
        localStorage.setItem(dkey(), JSON.stringify({ t: Date.now(), subject: sel.value, text: ta.value, date: dateOf(), pick: [...(S.hwPick || [])] }));
      }, 400);
    };
    form.addEventListener('input', save);
    form.addEventListener('change', save);
    form.addEventListener('click', save);
    const d = readDraft();
    if (d && !ta.value && !root.querySelector('.hw-draft')) {
      const banner = h('section', { class: 'card hw-draft' },
        h('b', {}, '📝 Есть черновик'),
        h('div', { class: 'muted' }, d.subject + ' · ' + (d.date ? ru(d.date) : 'дата не выбрана') + ' · сохранён ' + whenOf(d.t)),
        h('button', { class: 'mini', onclick: () => { buzz.tap(); resume(form, sel, ta, d); banner.remove(); } }, 'Продолжить'),
        h('button', { class: 'mini danger', onclick: safe(async () => { localStorage.removeItem(dkey()); banner.remove(); }, 'none') }, 'Удалить'));
      (root.querySelector('.hw-form-toggle') || form).before(banner);
    }
  }

  const view = document.getElementById('view');
  if (view) {
    new MutationObserver(() => {
      try { cardTools(view); } catch (e) {}
      try { archiveTabs(view); } catch (e) {}
      try { draftForm(view); } catch (e) {}
    }).observe(view, { childList: true, subtree: true });
  }

  // Список ДЗ с полями (текст, файлы с uid, пометка «Изменено») запоминаем для карточек; после успешного добавления черновик удаляется
  const prevCall = call;
  call = function (name, p, cache) {
    const adding = (name === 'homework' || name === 'proposal') && p && p.action === 'add';
    const r = prevCall(name, p, cache);
    if (name === 'homework') {
      r.then((list) => {
        if (!Array.isArray(list)) return;
        const m = {};
        for (const x of list) m[x.subject + ' · ' + ru(x.date)] = x;
        S.hwItems = m;
      }).catch(() => {});
    }
    if (adding) r.then(() => { try { localStorage.removeItem(dkey()); } catch (e) {} }).catch(() => {});
    return r;
  };
})();
