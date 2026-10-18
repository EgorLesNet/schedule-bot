import * as store from '../lib/store.js';
import { listSchedules } from '../lib/schedule.js';
import { FACULTIES, COURSES_COUNT, FILES } from '../lib/faculties.js';
import { endpoint } from '../lib/auth.js';
import { today } from '../lib/time.js';

export default endpoint(async (input, u) => {
  const sch = await listSchedules();
  const me = Object.assign({ done: [], notes: {}, favs: [] }, await store.get('ud:' + u.id, {}));
  const user = await store.getUser(u.id);
  const assistant = await store.isAssistant(u.username);
  if (assistant && u.username && user.username !== u.username) {
    user.username = u.username;
    await store.saveUser(u.id, { username: u.username });
  }
  return {
    today: today(),
    user,
    schedules: Object.keys(sch).map((course) => ({ course, streams: sch[course] })),
    faculties: FACULTIES,
    courses: COURSES_COUNT,
    files: FILES,
    assistant,
    admin: store.isAdmin(u.username),
    me,
  };
});
