import { api } from 'sdk';

export function send(chat_id, text, reply_markup) {
  const p = { chat_id, text };
  if (reply_markup) p.reply_markup = reply_markup;
  return api.sendMessage(p);
}

export async function edit(q, text, reply_markup) {
  const p = { chat_id: q.message.chat.id, message_id: q.message.message_id, text };
  if (reply_markup) p.reply_markup = reply_markup;
  try { await api.editMessageText(p); } catch (e) {}
}
