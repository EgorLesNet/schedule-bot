import * as store from '../lib/store.js';
import { listSchedules, flatten } from '../lib/schedule.js';
import { COURSES_COUNT, facultyList, directionPairs, pairLabel } from '../lib/faculties.js';
import { endpoint } from '../lib/auth.js';
import { today } from '../lib/time.js';

export default endpoint(async (input, u) => {
  const sch = await listSchedules();
  const all = flatten(sch);
  const names = facultyList(all);
  const faculties = [];
  const files = {};
  names.forEach((name, fi) => {
    const pairs = directionPairs(all, name);
    faculties.push({ name, directions: pairs.map(pairLabel) });
    pairs.forEach((p, di) => {
      files[fi + ':' + di] = all.filter((e) => e.faculty === name && e.course === p.course && e.direction === p.direction).map((e) => e.file);
    });
  });
  const me = Object.assign({ done: [], notes: {}, favs: [] }, await store.get('ud:' + u.id, {}));
  const saved = await store.getUser(u.id);
  const assistant = await store.isAssistant(u.username);
  if (assistant && u.username && saved.username !== u.username) {
    saved.username = u.username;
    await store.saveUser(u.id, { username: u.username });
  }
  const user = Object.assign({}, saved);
  delete user.faculty;
  delete user.direction;
  const cur = all.find((e) => e.course === saved.course && e.key === saved.stream);
  if (cur) {
    user.faculty = names.indexOf(cur.faculty);
    user.direction = directionPairs(all, cur.faculty).findIndex((p) => p.course === cur.course && p.direction === cur.direction);
  }
  return {
    today: today(),
    user,
    schedules: Object.keys(sch).map((course) => ({ course, streams: sch[course] })),
    faculties,
    files,
    courses: COURSES_COUNT,
    assistant,
    admin: store.isAdmin(u.username),
    me,
  };
});
