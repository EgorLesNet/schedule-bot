import { api } from 'sdk';
import * as store from './store.js';

// Платформа не умеет принимать и отдавать байты файлов, только file_id. Поэтому файл сначала отправляют боту в чат,
// он попадает во «входящие» пользователя (7 дней), а при составлении ДЗ его file_id прикрепляется к заданию.
const KEEP = 7 * 86400000;
const MAX_INBOX = 10;
const MAX_FILES = 10;
const METHODS = { document: 'sendDocument', photo: 'sendPhoto', video: 'sendVideo', audio: 'sendAudio', voice: 'sendVoice', video_note: 'sendVideoNote', animation: 'sendAnimation' };

export function attachmentOf(m) {
  const group = m.media_group_id || '';
  const make = (kind, o, name) => ({ kind, fid: o.file_id, uid: o.file_unique_id || o.file_id, name: String(name).slice(0, 100), size: o.file_size || 0, group });
  if (m.document) return make('document', m.document, m.document.file_name || 'Файл');
  if (m.photo && m.photo.length) return make('photo', m.photo[m.photo.length - 1], 'Фото');
  if (m.video) return make('video', m.video, m.video.file_name || 'Видео');
  if (m.audio) return make('audio', m.audio, m.audio.file_name || m.audio.title || 'Аудио');
  if (m.voice) return make('voice', m.voice, 'Голосовое сообщение');
  if (m.video_note) return make('video_note', m.video_note, 'Видеосообщение');
  if (m.animation) return make('animation', m.animation, m.animation.file_name || 'GIF');
  return null;
}

export const plain = (f) => ({ kind: f.kind, fid: f.fid, uid: f.uid, name: f.name, size: f.size });

const inboxKey = (uid) => 'inbox:' + uid;

export async function getInbox(uid) {
  const now = Date.now();
  return (await store.get(inboxKey(uid), [])).filter((x) => now - x.at < KEEP);
}

// Возвращает true, если об этом файле стоит ответить (из альбома отвечаем один раз)
export async function addInbox(uid, att) {
  const now = Date.now();
  const list = (await getInbox(uid)).filter((x) => x.uid !== att.uid);
  const prev = list[list.length - 1];
  const first = !(att.group && prev && prev.group === att.group);
  list.push(Object.assign({ id: now.toString(36) + list.length + Math.floor(Math.random() * 1296).toString(36) }, att, { at: now }));
  await store.set(inboxKey(uid), list.slice(-MAX_INBOX));
  return first;
}

export async function dropInbox(uid, ids) {
  await store.set(inboxKey(uid), (await getInbox(uid)).filter((x) => !ids.includes(x.id)));
}

export async function takeFromInbox(uid, ids) {
  const all = await getInbox(uid);
  const take = all.filter((x) => ids.includes(x.id));
  if (take.length) await store.set(inboxKey(uid), all.filter((x) => !ids.includes(x.id)));
  return take;
}

export const loadFiles = (c, s) => store.get('hwfiles:' + c + '_' + s, {});
export const saveFiles = (c, s, d) => store.set('hwfiles:' + c + '_' + s, d);

export function mergeFiles(old, add) {
  const out = old.slice();
  for (const f of add) if (!out.some((x) => x.uid === f.uid)) out.push(f);
  return out.slice(0, MAX_FILES);
}

export async function sendFiles(chatId, files) {
  let n = 0;
  for (const f of files) {
    const kind = METHODS[f.kind] ? f.kind : 'document';
    try { await api[METHODS[kind]]({ chat_id: chatId, [kind]: f.fid }); n++; } catch (e) {}
  }
  return n;
}
