import { api } from 'sdk';
import * as store from './store.js';
import { APP_URL, NL } from './config.js';

// Имя бота запрашиваем один раз и сохраняем
async function botName() {
  const c = await store.get('bot:username', null);
  if (c) return c;
  try {
    const me = await api.getMe();
    if (me && me.username) {
      await store.set('bot:username', me.username);
      return me.username;
    }
  } catch (e) {}
  return '';
}

// Приглашение в приложение: ответ на любое сообщение и нажатие старых кнопок в чате
export async function inviteView() {
  const name = await botName();
  const lines = [
    '📱 Расписание переехало в приложение',
    '',
    'В приложении удобнее и быстрее:',
    '• неделя и день в одном экране, календарь с отметками дней с парами',
    '• поиск по предметам и преподавателям',
    '• избранные предметы ★ и личные заметки к парам',
    '• домашние задания: отмечайте сделанное, предлагайте ДЗ одногруппникам',
    '• ссылки на онлайн-пары одним нажатием',
    '• календарь с переносами и отменами в .ics',
    '',
    'Уведомления об отменах и переносах приходят сюда по-прежнему.',
  ];
  if (name) lines.push('Быстро отправить расписание в чат: напишите @' + name + ' в любом чате.');
  const markup = APP_URL ? { inline_keyboard: [[{ text: '📱 Открыть расписание', web_app: { url: APP_URL } }]] } : undefined;
  return { text: lines.join(NL), markup };
}
