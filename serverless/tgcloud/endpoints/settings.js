import * as store from '../lib/store.js';
import { listSchedules } from '../lib/schedule.js';
import { FACULTIES, streamsFor } from '../lib/faculties.js';
import { isLangStart } from '../lib/lang.js';
import { endpoint } from '../lib/auth.js';

export default endpoint(async (input, u) => {
  const fi = Number(input.faculty);
  const di = Number(input.direction);
  const f = FACULTIES[fi];
  if (!Number.isInteger(fi) || !Number.isInteger(di) || !f || !f.directions[di]) throw new Error('bad faculty');
  const streams = streamsFor((await listSchedules())[input.course], fi, di);
  if (!streams.some((s) => s.key === input.stream)) throw new Error('no schedule for this direction');
  const ls = (input.course === '1' || input.course === '2') && isLangStart(input.langStart) ? input.langStart : null;
  return await store.saveUser(u.id, { faculty: fi, direction: di, course: input.course, stream: input.stream, langStart: ls, englishTime: null, reminders: !!input.reminders });
});
