import * as store from '../lib/store.js';
import { allEntries } from '../lib/schedule.js';
import { facultyList, directionPairs } from '../lib/faculties.js';
import { isLangStart } from '../lib/lang.js';
import { endpoint } from '../lib/auth.js';

// Mini App присылает индексы факультета и направления из списков, которые отдаёт bootstrap
export default endpoint(async (input, u) => {
  const all = await allEntries();
  const course = String(input.course || '');
  const faculty = facultyList(all)[Number(input.faculty)];
  const pair = faculty ? directionPairs(all, faculty)[Number(input.direction)] : null;
  const e = pair && pair.course === course ? all.find((x) => x.course === course && x.key === input.stream && x.faculty === faculty && x.direction === pair.direction) : null;
  if (!e) throw new Error('no schedule for this selection');
  const ls = (course === '1' || course === '2') && isLangStart(input.langStart) ? input.langStart : null;
  return await store.saveUser(u.id, { faculty: e.faculty, direction: e.direction, course, stream: e.key, langStart: ls, englishTime: null, reminders: !!input.reminders });
});
