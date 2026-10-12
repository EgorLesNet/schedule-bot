import * as store from '../lib/store.js';
import { listSchedules } from '../lib/schedule.js';
import { endpoint } from '../lib/auth.js';
import { today } from '../lib/time.js';

export default endpoint(async (input, u) => {
  const sch = await listSchedules();
  return {
    today: today(),
    user: await store.getUser(u.id),
    schedules: Object.keys(sch).map((course) => ({ course, streams: sch[course] })),
    assistant: await store.isAssistant(u.username),
    admin: store.isAdmin(u.username),
  };
});
