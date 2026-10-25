// Длинные тексты ДЗ сворачиваются: показываются первые строки и кнопка «Показать полностью» / «Свернуть».
// Работает поверх приложения (app.js не правится): подбирает тексты ДЗ на вкладках «Сегодня», «Неделя», «ДЗ» (в том числе архив) и в карточке предмета; заодно снимает лимит 1000 символов в поле правки ДЗ. Подключается после app.js
(function () {
  const MAX_CHARS = 350;
  const MAX_LINES = 7;
  const SEL = 'section.hwc > p, .lesson .hw, .hw-archive section.card > p, #subj-panel .linkform > p';

  const css = document.createElement('style');
  css.textContent = '.hw-clamp{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:6;overflow:hidden}';
  document.head.append(css);

  function fold() {
    // Поле правки ДЗ у ассистента раньше обрезало текст на 1000 символах (maxlength в hwx.js): снимаем ограничение
    for (const ta of document.querySelectorAll('.hw-editor textarea[maxlength]')) ta.removeAttribute('maxlength');
    for (const el of document.querySelectorAll(SEL)) {
      if (el.dataset.fold) continue;
      el.dataset.fold = '1';
      const t = el.textContent || '';
      if (t.length <= MAX_CHARS && t.split('\n').length <= MAX_LINES) continue;
      el.classList.add('hw-clamp');
      const btn = document.createElement('button');
      btn.className = 'mini alt';
      btn.textContent = 'Показать полностью';
      btn.addEventListener('click', () => {
        try { if (typeof buzz !== 'undefined') buzz.tap(); } catch (e) {}
        const collapsed = el.classList.toggle('hw-clamp');
        btn.textContent = collapsed ? 'Показать полностью' : 'Свернуть';
      });
      el.after(btn);
    }
  }

  let raf = 0;
  new MutationObserver(() => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; try { fold(); } catch (e) {} });
  }).observe(document.body, { childList: true, subtree: true });
  fold();
})();
