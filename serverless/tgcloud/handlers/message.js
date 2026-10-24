import { api } from 'sdk';
import * as store from '../lib/store.js';
import { send } from '../lib/bot.js';
import { secure } from '../lib/auth.js';
import { sendReminders } from '../lib/remind.js';
import { allEntries, loadEvents } from '../lib/schedule.js';
import { syncExisting } from '../lib/hwsync.js';
import { inviteView } from '../lib/invite.js';
import { attachmentOf, addInbox } from '../lib/files.js';
import { APP_URL, NL } from '../lib/config.js';

const DAY = 86400000;
const SHORT = 'Расписание ГАУГН в приложении: пары, ДЗ, календарь. Откройте кнопкой внизу.';
const LONG = 'Расписание ГАУГН в удобном приложении: неделя и день, поиск по предметам и преподавателям, домашние задания, заметки, ссылки на онлайн-пары и календарь. Нажмите «Старт» и откройте приложение. Уведомления об отменах и переносах пар приходят в этот чат. Быстрое расписание в любом чате: напишите имя бота и выберите «Сегодня» или «Неделя».';
const ADMIN_HELP = [
  'Расписание, ДЗ и настройки — в приложении. В чате доступны:',
  '/alerts - уведомления об изменениях расписания (вкл/выкл)',
  '/myid - ваш Telegram id',
  '', 'Админ:', '/stats - статистика', '/announce текст - рассылка всем', '/assistant add @user, /assistant del @user, /assistants',
  '/refresh - перечитать расписание из GitHub, не дожидаясь часа',
  '/remind_now, /synchw', '/setmenu - кнопка приложения, описание бота и список команд',
].join(NL);

export default async function (message) {
  if (!message.from || message.chat.type !== 'private') return;
  // Файл любого формата: запоминаем во «входящих», в ДЗ его прикрепляют в приложении
  const att = attachmentOf(message);
  if (att) {
    await store.touch(message.from.id);
    const first = await addInbox(message.from.id, att);
    if (!first) return;
    return send(message.chat.id, '📎 Файл получен: ' + att.name + NL + 'Откройте приложение, вкладку «ДЗ», и отметьте его при составлении задания. Файлы ждут там 7 дней.' + (att.kind === 'photo' ? NL + 'Совет: чтобы не терять качество, отправляйте фото как файл.' : ''));
  }
  if (!message.text) return;
  const chat = message.chat.id;
  // Ник проверяется вместе с id: если с таким ником пишет чужой аккаунт, права не даются
  const uname = (await secure(message.from)).username || '';
  const text = message.text.trim();
  const sp = text.indexOf(' ');
  const cmd = (sp < 0 ? text : text.slice(0, sp)).split('@')[0].toLowerCase();
  const arg = sp < 0 ? '' : text.slice(sp + 1).trim();
  const user = await store.touch(message.from.id);
  const deny = () => send(chat, '❌ Нет прав для этой команды');
  const invite = async () => { const v = await inviteView(); return send(chat, v.text, v.markup); };

  switch (cmd) {
    case '/myid':
      return send(chat, '🆔 Ваш Telegram id: ' + message.from.id);
    case '/alerts': {
      const u2 = await store.saveUser(message.from.id, { alerts: user.alerts === false });
      return send(chat, u2.alerts === false ? '🔕 Уведомления об изменениях расписания выключены' : '🔔 Уведомления об изменениях расписания включены');
    }
    case '/help':
      return store.isAdmin(uname) ? send(chat, ADMIN_HELP) : invite();
    case '/refresh': {
      if (!store.isAdmin(uname)) return deny();
      // Список файлов перечитываем сразу, затем каждый файл (с рассылкой уведомлений об изменениях); не дольше 20 секунд за раз
      const before = (await allEntries()).length;
      const list = await allEntries(true);
      const t0 = Date.now();
      let done = 0;
      for (const e of list) {
        if (Date.now() - t0 > 20000) break;
        try {
          const c = await store.get('cache:ics:' + e.file);
          if (c && Date.now() - c.at < 120000) { done++; continue; }
          await loadEvents(e.course, e.key, true);
          done++;
        } catch (err) {}
      }
      return send(chat, '🔄 Расписание обновлено' + NL + 'Файлов в списке: ' + list.length + ' (было в кэше: ' + before + ')' + NL + 'Перечитано: ' + done + ' из ' + list.length + (done < list.length ? NL + 'Не все успели, повторите /refresh через минуту.' : ''));
    }
    case '/synchw': {
      if (!store.isAdmin(uname)) return deny();
      if (!user.course) return send(chat, 'Сначала выберите расписание в приложении.');
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
      else {
        const roles = await store.get('roles', {});
        delete roles[name];
        await store.set('roles', roles);
      }
      await store.set('assistants', list);
      return send(chat, '✅ Ассистенты: ' + (list.join(', ') || 'нет'));
    }
    case '/assistants': {
      if (!store.isAdmin(uname)) return deny();
      const list = await store.get('assistants', []);
      const roles = await store.get('roles', {});
      return send(chat, 'Ассистенты: ' + (list.map((n) => '@' + n + (roles[n] && roles[n].length ? ' (ограничен)' : '')).join(', ') || 'нет'));
    }
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
      const entries = await allEntries();
      const byKey = new Map(entries.map((e) => [e.course + '|' + e.key, e]));
      const now = Date.now();
      const tree = {};
      const total = {};
      let none = 0, lost = 0, rem = 0, d1 = 0, d7 = 0, d30 = 0, fresh = 0, unknown = 0;
      for (const id of ids) {
        const u = await store.getUser(id);
        if (u.reminders) rem++;
        const age = u.seen ? now - u.seen : Infinity;
        if (!u.seen) unknown++;
        if (age < DAY) d1++;
        if (age < 7 * DAY) d7++;
        if (age < 30 * DAY) d30++;
        if (u.since && now - u.since < 7 * DAY) fresh++;
        if (!u.course || !u.stream) { none++; continue; }
        const e = byKey.get(u.course + '|' + u.stream);
        if (!e) { lost++; continue; }
        const f = tree[e.faculty] || (tree[e.faculty] = { total: 0, active: 0, courses: {} });
        f.total++;
        if (age < 7 * DAY) f.active++;
        f.courses[u.course] = (f.courses[u.course] || 0) + 1;
        total[u.course] = (total[u.course] || 0) + 1;
      }
      const lines = ['📊 Пользователей: ' + ids.length, '📈 Заходили: за 24 ч — ' + d1 + ', за 7 дн. — ' + d7 + ', за 30 дн. — ' + d30];
      if (fresh) lines.push('🆕 Новых за 7 дней: ' + fresh);
      if (unknown) lines.push('Нет данных об активности: ' + unknown + ' (появятся после следующего захода)');
      lines.push('');
      const names = Object.keys(tree).sort((a, b) => tree[b].total - tree[a].total || a.localeCompare(b, 'ru'));
      for (const n of names) {
        lines.push('🏛 ' + n + ': ' + tree[n].total + ' (активны за 7 дн.: ' + tree[n].active + ')');
        for (const c of Object.keys(tree[n].courses).sort((a, b) => Number(a) - Number(b))) lines.push('   ' + c + ' курс: ' + tree[n].courses[c]);
      }
      const courses = Object.keys(total).sort((a, b) => Number(a) - Number(b));
      if (courses.length) lines.push('', 'По курсам (всего): ' + courses.map((c) => c + ' курс: ' + total[c]).join(', '));
      if (none) lines.push('', 'Не выбрали расписание: ' + none);
      if (lost) lines.push((none ? '' : ''), 'Расписание больше не найдено: ' + lost);
      lines.push('', 'Напоминания включены: ' + rem);
      return send(chat, lines.filter((l, i) => !(l === '' && lines[i - 1] === '')).join(NL));
    }
    case '/remind_now':
      if (!store.isAdmin(uname)) return deny();
      return send(chat, '🔔 Разослано напоминаний: ' + (await sendReminders()));
    case '/setmenu': {
      if (!store.isAdmin(uname)) return deny();
      const res = [];
      const step = async (title, fn) => {
        try { await fn(); res.push('✅ ' + title); } catch (e) { res.push('❌ ' + title + ': ' + ((e && e.message) || e)); }
      };
      await step('Кнопка меню', () => api.setChatMenuButton({ menu_button: { type: 'web_app', text: '📱 Расписание', web_app: { url: APP_URL } } }));
      await step('Краткое описание', () => api.setMyShortDescription({ short_description: SHORT }));
      await step('Полное описание', () => api.setMyDescription({ description: LONG }));
      await step('Список команд', () => api.setMyCommands({ commands: [{ command: 'alerts', description: 'Уведомления об изменениях расписания' }] }));
      return send(chat, res.join(NL));
    }
    default:
      return invite();
  }
}
