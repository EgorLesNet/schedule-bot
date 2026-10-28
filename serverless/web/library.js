// Постоянная библиотека в существующей карточке предмета. Файлы поступают из входящих бота, отдельно от ДЗ.
(function () {
  const label = (t, el) => h('label', {}, h('span', { class: 'muted' }, t), el);
  const ctx = () => JSON.stringify([S.boot && S.boot.user && S.boot.user.course, S.boot && S.boot.user && S.boot.user.stream]);
  function mount(panel) {
    if (panel.querySelector('.subject-library')) return;
    const head = panel.querySelector('.toolbar b');
    if (!head || !S.boot || !S.boot.user) return;
    const subject = head.textContent, initial = ctx();
    const base = { subject, course: S.boot.user.course, stream: S.boot.user.stream };
    const box = h('section', { class: 'card subject-library' }, h('h3', {}, '📚 Постоянная библиотека'));
    panel.append(box);
    const request = (p) => {
      if (ctx() !== initial) throw new Error('Курс или поток изменился. Откройте предмет заново.');
      return call('library', { ...base, ...p });
    };
    const refresh = async () => { const d = await request({ action: 'list' }); if (box.isConnected && ctx() === initial) draw(d); };
    const act = (p, question) => safe(async () => {
      if (question && !(await ask(question))) return false;
      await request(typeof p === 'function' ? p() : p); await refresh();
    });
    function form(d, old = {}) {
      const title = h('input', { type: 'text', maxlength: '160', value: old.title || '', placeholder: 'Название материала' });
      const category = h('select', {}, Object.entries(d.categories).map(([value, name]) => h('option', { value, selected: value === (old.category || 'other') }, name)));
      const text = h('textarea', { rows: 5, maxlength: '6000', placeholder: 'Описание, требования или список литературы' }); text.value = old.text || '';
      const url = h('input', { type: 'url', value: old.url || '', placeholder: 'https://…' });
      const pinned = h('input', { type: 'checkbox', checked: old.pinned });
      const clear = h('input', { type: 'checkbox' });
      const attach = h('div', {}), selected = new Set();
      const inbox = safe(async () => {
        const r = await call('files', { action: 'inbox' }); selected.clear();
        attach.replaceChildren(...r.items.map((f) => {
          const check = h('input', { type: 'checkbox' });
          check.addEventListener('change', () => { if (check.checked) selected.add(f.id); else selected.delete(f.id); });
          return h('label', { class: 'row' }, check, f.name);
        }));
        if (!r.items.length) attach.append(h('p', { class: 'muted' }, 'Входящих файлов нет. Сначала отправьте файл в чат с ботом.'));
      });
      const form = h('div', { class: 'linkform' }, label('Название', title), label('Категория', category), label('Текст', text), label('Ссылка', url),
        h('p', { class: 'muted' }, 'Для вложения отправьте файл в чат с ботом, вернитесь сюда и нажмите «Выбрать файлы». До 5 новых файлов за один раз.'),
        h('button', { class: 'mini alt', onclick: inbox }, '📎 Выбрать файлы'), attach,
        old.files && old.files.length ? h('label', { class: 'row' }, clear, 'Удалить прежние вложения: ' + old.files.map((f) => f.name).join(', ')) : null,
        d.editor ? h('label', { class: 'row' }, pinned, 'Закрепить вверху') : null,
        h('button', { onclick: act(() => ({ action: old.id ? 'edit' : 'add', id: old.id, title: title.value, category: category.value,
          text: text.value, url: url.value, pinned: pinned.checked, clearFiles: clear.checked, files: [...selected] })) }, d.editor ? 'Опубликовать' : 'Предложить на проверку'));
      return form;
    }
    function row(x, d) {
      const card = h('div', { class: 'linkform' }, h('b', {}, (x.pinned ? '📌 ' : '') + x.title),
        h('div', { class: 'muted' }, (d.categories[x.category] || '') + ' · ' + x.by + ' · ' + new Date(x.at).toLocaleDateString('ru-RU')));
      if (x.text) card.append(h('p', { style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, linkify(x.text)));
      if (x.url) card.append(h('button', { class: 'mini', onclick: () => openLink(x.url) }, 'Открыть ссылку ↗'));
      if (x.files.length) card.append(h('div', { class: 'muted' }, '📎 ' + x.files.map((f) => f.name).join(', ')),
        h('button', { class: 'mini', onclick: safe(async () => {
          const r = await request({ action: 'send', id: x.id }); alertMsg('Отправлено в чат с ботом: ' + r.sent + ' из ' + r.total);
        }) }, 'Получить файлы в чат'));
      if (x.status === 'pending') card.append(h('p', { class: 'muted' }, '⏳ На проверке'));
      if (x.status === 'rejected') card.append(h('p', { class: 'muted' }, 'Отклонено' + (x.reason ? ': ' + x.reason : '')));
      if (d.editor && x.status === 'pending') {
        const reason = h('input', { type: 'text', maxlength: '500', placeholder: 'Причина отклонения (необязательно)' });
        card.append(h('button', { class: 'mini', onclick: act({ action: 'approve', id: x.id }) }, '✓ Одобрить'), reason,
          h('button', { class: 'mini danger', onclick: act(() => ({ action: 'reject', id: x.id, reason: reason.value }), 'Отклонить предложение?') }, 'Отклонить'));
      }
      if (d.editor && x.status === 'published') {
        const slot = h('div', {});
        card.append(h('button', { class: 'mini alt', onclick: act({ action: 'pin', id: x.id, pinned: !x.pinned }) }, x.pinned ? 'Открепить' : '📌 Закрепить'),
          h('button', { class: 'mini alt', onclick: () => slot.replaceChildren(...(slot.firstChild ? [] : [form(d, x)])) }, 'Изменить'), slot);
      }
      if (d.editor || (x.mine && x.status !== 'published')) card.append(h('button', { class: 'mini danger', onclick: act({ action: 'delete', id: x.id }, 'Удалить материал?') }, 'Удалить'));
      return card;
    }
    function draw(d) {
      box.replaceChildren(h('h3', {}, '📚 Постоянная библиотека'), h('p', { class: 'muted' }, 'Материалы предмета для выбранного потока. Не привязаны к датам ДЗ.'));
      const list = h('div', {}), filter = h('select', {}, h('option', { value: '' }, 'Все категории'), ...Object.entries(d.categories).map(([value, name]) => h('option', { value }, name)));
      const paint = () => {
        const published = d.items.filter((x) => x.status === 'published' && (!filter.value || x.category === filter.value));
        list.replaceChildren(...published.map((x) => row(x, d)));
        if (!published.length) list.append(h('p', { class: 'muted' }, 'Опубликованных материалов пока нет'));
      };
      filter.addEventListener('change', paint); paint(); box.append(filter, list);
      const pending = d.items.filter((x) => x.status !== 'published');
      if (pending.length) box.append(h('h3', {}, d.editor ? 'Предложения студентов' : 'Мои предложения'), ...pending.map((x) => row(x, d)));
      const slot = h('div', {});
      box.append(h('button', { class: 'mini', onclick: () => slot.replaceChildren(...(slot.firstChild ? [] : [form(d)])) }, d.editor ? '＋ Добавить материал' : '＋ Предложить материал'), slot);
    }
    refresh().catch((e) => { if (box.isConnected) box.append(h('p', { class: 'err' }, String(e.message || e)), h('button', { class: 'mini', onclick: safe(refresh) }, 'Повторить')); });
  }
  new MutationObserver(() => { const panel = document.getElementById('subj-panel'); if (panel) mount(panel); }).observe(document.body, { childList: true, subtree: true });
})();
