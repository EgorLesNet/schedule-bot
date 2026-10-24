import { allEntries } from './schedule.js';
import { listLog } from './dlv.js';

// Журнал рассылок для админа: записи с названием потока, новые сверху
export async function viewLog(limit = 20) {
  const [list, entries] = await Promise.all([listLog(), allEntries()]);
  const byKey = new Map(entries.map((e) => [e.course + '|' + e.key, e]));
  return list.slice(-limit).reverse().map((x) => {
    const e = byKey.get(x.course + '|' + x.stream);
    return {
      id: x.id, t: x.t, kind: x.kind,
      scope: x.course ? x.course + ' курс' + (e ? ' · ' + e.faculty + ', ' + e.direction + (e.stream ? ', ' + e.stream : '') : '') : 'все пользователи',
      expected: x.expected, ok: x.ok, failed: x.expected - x.ok,
      reasons: x.reasons || {}, transient: x.transient || {},
      retry: x.retry.length, canRetry: !!(x.text && x.retry.length), auto: !x.text && x.retry.length > 0,
    };
  });
}
