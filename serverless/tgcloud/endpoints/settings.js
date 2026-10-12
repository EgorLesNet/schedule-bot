import * as store from '../lib/store.js';
import { listSchedules } from '../lib/schedule.js';
import { endpoint } from '../lib/auth.js';

export default endpoint(async (input, u) => {
  const streams = (await listSchedules())[input.course];
  if (!streams || !streams.some((s) => s.key === input.stream)) throw new Error('bad schedule');
  const et = input.englishTime === 'morning' || input.englishTime === 'afternoon' ? input.englishTime : null;
  return await store.saveUser(u.id, { course: input.course, stream: input.stream, englishTime: et, reminders: !!input.reminders });
});
