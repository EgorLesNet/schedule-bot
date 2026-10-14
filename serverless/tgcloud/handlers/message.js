import * as store from '../lib/store.js';
import { send } from '../lib/bot.js';
import * as V from '../lib/views.js';
import { sendReminders } from '../lib/remind.js';
import { toOriginal } from '../lib/schedule.js';
import { applyHw, syncExisting } from '../lib/hwsync.js';
import { APP_URL, NL } from '../lib/config.js';

const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const HELP = [
  '/menu - меню', '/today, /tomorrow, /week - расписание', '/hw - домашние задания', '/app - мини-приложение',
  '', 'Ассистенты:', '/addhw Предмет | 2026-10-20 | текст', '/delhw Предмет | 2026-10-20',
  '', 'Админ:', '/assistant add @user, /assistant del @user, /assistants', '/announce текст, /stats, /remind_now, /synchw',
].join(NL);

export default async function (message) {
  if (!message.text || !message.from || message.chat.type !== 'private') return;
  const chat = message.chat.id;
  const uname = message.from.username || '';
  const text = message.text.trim();
  const sp = text.indexOf(' ');
  const cmd = (sp < 0 ? text : text.slice(0, sp)).split('@')[0].toLowerCase();
  const arg = sp < 0 ? '' : text.slice(sp + 1).trim();
  const user = await store.getUser(message.from.id);
  const show = (v) => send(chat, v.text, v.markup);
  const deny = () => send(chat, '❌ Нет прав для этой команды');
  const needCourse = async () => { if (user.course) return false; await show(await V.coursesView()); return true; };

  switch (cmd) {
    case '/start':
    case '/menu':
      return show(user.course ? await V.menuView(user) : await V.coursesView());
    case '/today':
      if (await needCourse()) return;
      return show(await V.dayView(user, 0));
    case '/tomorrow':
      if (await needCourse()) return;
      return show(await V.dayView(user, 1));
    case '/week':
      if (await needCourse()) return;
      return show(await V.weekView(user, 0));
    case '/hw':
      if (await needCourse()) return;
      return show(await V.hwView(user));
    case '/app':
      if (!APP_URL) return send(chat, 'Мини-приложение ещё не подключено: впишите APP_URL в lib/config.js');
      return send(chat, 'Открыть расписание:', { inline_keyboard: [[{ text: '📱 Открыть приложение', web_app: { url: APP_URL } }]] });
    case '/help':
      return send(chat, HELP);
    case '/addhw':
    case '/delhw': {
      if (!(await store.isAssistant(uname))) return deny();
      if (await needCourse()) return;
      const p = arg.split('|').map((s) => s.trim());
      if (!p[0] || !DATE.test(p[1] || '') || (cmd === '/addhw' && !p[2])) return send(chat, 'Формат: ' + cmd + ' Предмет | ГГГГ-ММ-ДД' + (cmd === '/addhw' ? ' | текст' : ''));
      const original = await toOriginal(user.course, user.stream, p[0]);
      const n = await applyHw(user.course, user.stream, original, p[1], cmd === '/addhw' ? p.slice(2).join(' | ') : '');
      return send(chat, (cmd === '/addhw' ? '✅ ДЗ сохранено' : '🗑 ДЗ удалено') + (n ? ' (синхронизировано с другими потоками: ' + n + ')' : ''));
    }
    case '/synchw': {
      if (!store.isAdmin(uname)) return deny();
      if (await needCourse()) return;
      const r = await syncExisting(user.course);
      return send(chat, '🔄 Синхронизация ДЗ: скопировано ' + r.copied + ', расхождений (не тронуты) ' + r.conflicts);
    }
    case '/assistant': {
      if (!store.isAdmin(uname)) return deny();
      const p = arg.split(' ');
      const name = (p[1] || '').split('@').join('').toLowerCase();
      if (!name || (p[0] !== 'add' && p[0] !== 'del')) return send(chat, 'Формат: /assistant add @user или /assistant del @user');
      let list = await store.get('assistants', []);
      list = list.filter((x) => x !== name);
      if (p[0] === 'add') list.push(name);
      await store.set('assistants', list);
      return send(chat, '✅ Ассистенты: ' + (list.join(', ') || 'нет'));
    }
    case '/assistants':
      if (!store.isAdmin(uname)) return deny();
      return send(chat, 'Ассистенты: ' + ((await store.get('assistants', [])).join(', ') || 'нет'));
    case '/announce': {
      if (!store.isAdmin(uname)) return deny();
      if (!arg) return send(chat, 'Формат: /announce текст');
      let ok = 0, fail = 0;
      for (const id of await store.get('users', [])) {
        try { await send(id, '📢 Объявление от администратора:' + NL + NL + arg); ok++; } catch (e) { fail++; }
      }
      return send(chat, '✅ Отправлено: ' + ok + ', не доставлено: ' + fail);
    }
    case '/stats': {
      if (!store.isAdmin(uname)) return deny();
      const ids = await store.get('users', []);
      const by = {};
      let rem = 0;
      for (const id of ids) {
        const u = await store.getUser(id);
        const k = u.course ? u.course + ' курс' : 'не выбран';
        by[k] = (by[k] || 0) + 1;
        if (u.reminders) rem++;
      }
      return send(chat, '📊 Пользователей: ' + ids.length + NL + Object.entries(by).map(([k, v]) => k + ': ' + v).join(NL) + NL + 'Напоминания включены: ' + rem);
    }
    case '/remind_now':
      if (!store.isAdmin(uname)) return deny();
      return send(chat, '🔔 Разослано напоминаний: ' + (await sendReminders()));
    default:
      return send(chat, cmd.startsWith('/') ? 'Неизвестная команда. /help' : 'Нажми /menu');
  }
}
