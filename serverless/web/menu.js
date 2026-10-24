// Меню под каждой парой: кнопка «⋯» раскрывает другие действия (избранное, заметка, ссылка, правка, ошибка).
// Всегда на виду остаются «Подключиться» и кнопка добавления ДЗ.
// Подключается после more.js: кнопки, добавленные другими скриптами позже, попадают в меню при следующем проходе.
(function () {
  const KEEP = /^(?:[＋+]\s*|💡\s*)ДЗ$|Подключиться/;

  function lessonMenu(root) {
    for (const row of root.querySelectorAll('.lesson')) {
      const acts = row.querySelector('.acts');
      if (!acts) continue;
      let menu = row.querySelector('.lesson-menu');
      let toggle = acts.querySelector('.lesson-menu-btn');
      const rest = [...acts.children].filter((b) => b.tagName === 'BUTTON' && b !== toggle && !KEEP.test(b.textContent.trim()));
      if (!rest.length && !menu) continue;
      if (!menu) {
        menu = h('div', { class: 'acts lesson-menu', style: 'display:none' });
        acts.after(menu);
        toggle = h('button', { class: 'mini alt lesson-menu-btn', title: 'Меню' }, '⋯');
        toggle.addEventListener('click', () => {
          buzz.tap();
          const open = menu.style.display === 'none';
          menu.style.display = open ? 'flex' : 'none';
          toggle.textContent = open ? '✕' : '⋯';
        });
        acts.append(toggle);
      }
      for (const b of rest) menu.append(b);
    }
  }

  const view = document.getElementById('view');
  if (view) {
    new MutationObserver(() => {
      try { lessonMenu(view); } catch (e) {}
    }).observe(view, { childList: true, subtree: true });
  }
})();
