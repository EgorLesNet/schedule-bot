import * as store from '../lib/store.js';
import { listSchedules } from '../lib/schedule.js';
import { FACULTIES, streamsFor } from '../lib/faculties.js';
import { endpoint } from '../lib/auth.js';

export default endpoint(async (input, u) => {
  const fi = Number(input.faculty);
  const di = Number(input.direction);
  const f = FACULTIES[fi];
  if (!Number.isInteger(fi) || !Number.isInteger(di) || !f || !f.directions[di]) throw new Error('bad faculty');
  const streams = streamsFor((await listSchedules())[input.course], fi, di);
  if (!streams.some((s) => s.key === input.stream)) throw new Error('no schedule for this direction');
  const et = input.englishTime === 'morning' || input.englishTime === 'afternoon' ? input.englishTime : null;
  return await store.saveUser(u.id, { faculty: fi, direction: di, course: input.course, stream: input.stream, englishTime: et, reminders: !!input.reminders });
});
