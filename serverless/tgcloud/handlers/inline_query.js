import { api } from 'sdk';
import * as store from '../lib/store.js';
import { allEntries, loadEvents, buildDay, dayText } from '../lib/schedule.js';
import { today, addDays, weekStart } from '../lib/time.js';
import { userLang } from '../lib/lang.js';
import { NL } from '../lib/config.js';

const article = (id, title, description, text) => ({ type: 'article', id, title, description, input_message_content: { message_text: text } });

// Inline-режим: @бот в любом чате предлагает расписание вашего потока (Сегодня / Завтра / Эта неделя).
// Включается в @BotFather: /setinline.
export default async function (q) {
  const user = await store.touch(q.from.id);
  if (!user.course || !user.stream) {
    await api.answerInlineQuery({ inline_query_id: q.id, results: [], cache_time: 5, is_personal: true, button: { text: 'Выбрать расписание', start_parameter: 'inline' } });
    return;
  }
  const info = (await allEntries()).find((e) => e.course === user.course && e.key === user.stream);
  const head = info ? '🏛 ' + info.faculty + ', ' + info.course + ' курс, ' + info.direction + (info.stream ? ', ' + info.stream : '') : 'Расписание';
  const [events, hw] = await Promise.all([loadEvents(user.course, user.stream), store.loadHw(user.course, user.stream)]);
  const lang = userLang(user);
  const day = (offset, prefix) => head + NL + NL + dayText(buildDay(events, addDays(today(), offset), lang, hw), prefix);
  const week = () => {
    const start = weekStart(today());
    let t = head + NL + NL;
    for (let i = 0; i < 7; i++) t += dayText(buildDay(events, addDays(start, i), lang, hw));
    return t.length > 4000 ? t.slice(0, 4000) + '…' : t;
  };
  const s = String(q.query || '').toLowerCase();
  const want = s.includes('завтра') ? ['tomorrow'] : s.includes('недел') ? ['week'] : s.includes('сегодня') ? ['today'] : ['today', 'tomorrow', 'week'];
  const results = [];
  if (want.includes('today')) results.push(article('today', '📅 Сегодня', head, day(0, '')));
  if (want.includes('tomorrow')) results.push(article('tomorrow', '📅 Завтра', head, day(1, 'Завтра, ')));
  if (want.includes('week')) results.push(article('week', '📊 Эта неделя', head, week()));
  await api.answerInlineQuery({ inline_query_id: q.id, results, cache_time: 20, is_personal: true });
}
