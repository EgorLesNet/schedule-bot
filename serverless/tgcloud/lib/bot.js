import { api } from 'sdk';
import * as store from './store.js';
import { listBackups } from './backup.js';
import { backupPages } from './backup-status.js';

// Compatibility presentation adapter for the existing administrator command replies.
// Keep command authorization and restore execution in handlers/message.js unchanged.
async function pagesFor(text) {
  if (typeof text !== 'string') return [text];
  if (text.startsWith('💾 Копии (хранятся 2 суток):\n') || text === 'Копий пока нет. Создайте командой /backup.') {
    return backupPages(await listBackups(), await store.get('backup:mac-receipts', []));
  }
  if (/^💾 Копия создана: [a-z0-9]+\nКлючей: /.test(text)) {
    return [text.replace('💾 Копия создана:', 'Снимок TGCloud создан:') + '\n\niMac: подтверждения сохранения пока нет. Выгрузка выполняется по расписанию; статус — /backups. Эта команда не запускает GitHub Actions немедленно.'];
  }
  return [text];
}

export async function send(chat_id, text, reply_markup) {
  let result;
  for (const page of await pagesFor(text)) {
    const p = { chat_id, text: page };
    if (reply_markup) p.reply_markup = reply_markup;
    result = await api.sendMessage(p);
  }
  return result;
}

export async function edit(q, text, reply_markup) {
  const p = { chat_id: q.message.chat.id, message_id: q.message.message_id, text };
  if (reply_markup) p.reply_markup = reply_markup;
  try { await api.editMessageText(p); } catch (e) {}
}
