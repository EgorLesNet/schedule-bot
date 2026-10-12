import * as store from '../lib/store.js';
import { listSchedules } from '../lib/schedule.js';
import { endpoint } from '../lib/auth.js';
import { today } from '../lib/time.js';

export default endpoint(async (input, u) => ({
  today: today(),
  user: await store.getUser(u.id),
  schedules: await listSchedules(),
  assistant: await store.isAssistant(u.username),
  admin: store.isAdmin(u.username),
}));
