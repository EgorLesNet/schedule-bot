import * as store from './store.js';
import { send } from './bot.js';

// Журнал массовых рассылок (kv dlvlog): сколько сообщений ожидалось и доставлено, почему не дошли, кому можно повторить.
// Хранится до 50 записей и не дольше 14 дней. Для повтора сохраняется текст (только если есть кому повторять).
// «Доставлено» значит, что Telegram принял сообщение, а не что его прочитали.
const KEY = 'dlvlog';
const MAX = 50;
const KEEP_MS = 14 * 86400000;
const SKIPPED = 'Не успели отправить (лимит времени)';

// Причина ошибки по ответу Telegram и признак «имеет смысл повторить»
export function classify(e) {
  const code = e && e.code;
  const desc = String((e && (e.description || e.message)) || '');
  if (/blocked/i.test(desc)) return { reason: 'Бот заблокирован пользователем', retry: false };
  if (/deactivated/i.test(desc)) return { reason: 'Аккаунт удалён или отключён', retry: false };
  if (/chat not found|user not found/i.test(desc)) return { reason: 'Чат не найден (не нажимал «Старт»)', retry: false };
  if (code === 429 || /too many requests/i.test(desc)) return { reason: 'Лимит Telegram (429)', retry: true };
  if (code >= 500 || /timeout|timed out|network|fetch failed|econn/i.test(desc)) return { reason: 'Сбой Telegram или сети', retry: true };
  return { reason: desc.replace(/\s+/g, ' ').slice(0, 80) || 'Неизвестная ошибка', retry: false };
}

export class Batch {
  constructor(kind, scope, text) {
    this.kind = kind;
    this.scope = scope || {};
    this.text = text || '';
    this.expected = 0;
    this.ok = 0;
    this.reasons = {};
    this.transient = {};
    this.retry = [];
  }
  hit() { this.expected++; this.ok++; }
  miss(id, err) {
    this.expected++;
    const c = classify(err);
    const bucket = c.retry ? this.transient : this.reasons;
    bucket[c.reason] = (bucket[c.reason] || 0) + 1;
    if (c.retry) this.retry.push(id);
    return c;
  }
  skip(ids) {
    for (const id of ids) { this.expected++; this.retry.push(id); }
    if (ids.length) this.transient[SKIPPED] = (this.transient[SKIPPED] || 0) + ids.length;
  }
}

export const listLog = () => store.get(KEY, []);

export async function record(b) {
  if (!b.expected) return;
  const now = Date.now();
  const list = (await listLog()).filter((x) => now - x.t < KEEP_MS);
  list.push({
    id: now.toString(36), t: now, kind: b.kind, course: b.scope.course || '', stream: b.scope.stream || '',
    expected: b.expected, ok: b.ok, reasons: b.reasons, transient: b.transient,
    retry: b.retry.slice(0, 100), text: b.retry.length ? b.text.slice(0, 600) : '', retried: 0,
  });
  await store.set(KEY, list.slice(-MAX));
}

// Повторная отправка тем, у кого была временная ошибка (только для рассылок с общим текстом)
export async function retryEntry(id) {
  const all = await listLog();
  const x = all.find((e) => e.id === id);
  if (!x) throw new Error('Рассылка не найдена');
  if (!x.text || !x.retry.length) throw new Error('Повторять нечего');
  const b = new Batch(x.kind, {}, x.text);
  for (let i = 0; i < x.retry.length; i += 3) {
    const part = x.retry.slice(i, i + 3);
    const res = await Promise.allSettled(part.map((u) => send(u, x.text)));
    res.forEach((r, k) => { if (r.status === 'fulfilled') b.hit(); else b.miss(part[k], r.reason); });
  }
  x.ok += b.ok;
  x.retry = b.retry;
  x.transient = b.transient;
  for (const [k, n] of Object.entries(b.reasons)) x.reasons[k] = (x.reasons[k] || 0) + n;
  x.retried += 1;
  if (!x.retry.length) x.text = '';
  await store.set(KEY, all);
  return { ok: b.ok, left: x.retry.length };
}
