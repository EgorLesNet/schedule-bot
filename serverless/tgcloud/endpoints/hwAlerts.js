import * as store from '../lib/store.js';
import { endpoint } from '../lib/auth.js';

// Переключатель «уведомлять о новом или изменённом ДЗ» (по умолчанию включён)
export default endpoint(async (input, u) => {
  const saved = await store.saveUser(u.id, { hwAlerts: !!input.value });
  return { hwAlerts: saved.hwAlerts };
});
