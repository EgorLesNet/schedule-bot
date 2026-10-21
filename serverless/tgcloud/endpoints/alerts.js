import * as store from '../lib/store.js';
import { endpoint } from '../lib/auth.js';

// Переключатель уведомлений об изменениях расписания (по умолчанию включены) — в настройках Mini App
export default endpoint(async (input, u) => {
  const alerts = !!input.value;
  await store.saveUser(u.id, { alerts });
  return { alerts };
});
