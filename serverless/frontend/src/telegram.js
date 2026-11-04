export const telegram = () => window.Telegram?.WebApp;
const CACHE_PREFIX = 'schedule-react-v1:';
const READ_CACHE = new Set(['range', 'subjects', 'subjectDates']);
export function clearReadCache() {
  try { for (const key of Object.keys(sessionStorage)) if (key.startsWith(CACHE_PREFIX)) sessionStorage.removeItem(key); } catch {}
}
export function initTelegram(onTheme) {
  const tg = telegram();
  tg?.ready();
  tg?.expand();
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const update = () => {
    const scheme = tg?.colorScheme || (media.matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = scheme;
    const p = tg?.themeParams || {};
    const defaults = scheme === 'dark' ? { bg: '#10151e', text: '#edf2fa', hint: '#aebad0' } : { bg: '#f1f5fc', text: '#182438', hint: '#576781' };
    for (const [key, value] of Object.entries({ bg: p.bg_color || defaults.bg, text: p.text_color || defaults.text, muted: p.hint_color || defaults.hint, accent: p.button_color || '#2481cc', 'accent-text': p.button_text_color || '#ffffff' })) document.documentElement.style.setProperty('--app-' + key, value);
    onTheme?.(scheme);
  };
  update();
  tg?.onEvent?.('themeChanged', update);
  media.addEventListener?.('change', update);
  return () => { tg?.offEvent?.('themeChanged', update); media.removeEventListener?.('change', update); };
}
export async function waitForServerless() {
  const deadline = Date.now() + 10000;
  while (!telegram()?.Serverless?.call) {
    if (Date.now() > deadline) throw new Error('Откройте приложение из Telegram Serverless. В обычном браузере backend недоступен.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
export function call(name, params = {}, options = {}) {
  const user = telegram()?.initDataUnsafe?.user?.id;
  const cacheable = options.cache && READ_CACHE.has(name) && user;
  const key = CACHE_PREFIX + user + ':' + name + ':' + JSON.stringify(params);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        if (cacheable && error.type !== 'ENDPOINT_ERROR') {
          try {
            const stored = JSON.parse(sessionStorage.getItem(key));
            if (stored && Date.now() - stored.at < 3600000) return resolve({ data: stored.data, cached: true });
          } catch {}
        }
        reject(new Error(error.message || String(error)));
      } else {
        if (cacheable) { try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data: result })); } catch {} }
        resolve({ data: result, cached: false });
      }
    };
    const timer = setTimeout(() => finish({ message: 'Сервер не ответил вовремя. Если вы сохраняли изменения, проверьте результат перед повтором.' }), 25000);
    try {
      const bridge = telegram()?.Serverless;
      if (!bridge?.call) return finish({ message: 'Telegram Serverless недоступен' });
      bridge.call(name, params, finish);
    } catch (error) { finish(error); }
  });
}
export function openLink(url) {
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Неподдерживаемая ссылка');
    const tg = telegram();
    if (parsed.hostname === 't.me' && tg?.openTelegramLink) tg.openTelegramLink(parsed.href);
    else if (tg?.openLink) tg.openLink(parsed.href);
    else window.open(parsed.href, '_blank', 'noopener,noreferrer');
  } catch (error) { throw new Error(error.message || 'Не удалось открыть ссылку'); }
}
export function confirmDelete(message) {
  const tg = telegram();
  return tg?.showConfirm ? new Promise(resolve => tg.showConfirm(message, resolve)) : Promise.resolve(window.confirm(message));
}
