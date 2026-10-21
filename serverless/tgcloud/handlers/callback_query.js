import { api } from 'sdk';
import * as store from '../lib/store.js';
import { edit } from '../lib/bot.js';
import { inviteView } from '../lib/invite.js';

// Бот закрыт: любая старая кнопка в чате заменяет сообщение приглашением в приложение
export default async function (q) {
  try { await api.answerCallbackQuery({ callback_query_id: q.id }); } catch (e) {}
  if (!q.message) return;
  await store.touch(q.from.id);
  const v = await inviteView();
  await edit(q, v.text, v.markup);
}
