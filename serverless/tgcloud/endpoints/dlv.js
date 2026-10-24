import { EndpointError } from 'sdk';
import * as store from '../lib/store.js';
import { endpoint } from '../lib/auth.js';
import { viewLog } from '../lib/dlvview.js';
import { retryEntry } from '../lib/dlv.js';

// Журнал рассылок для админа: list — последние рассылки, retry — повтор для временных ошибок
export default endpoint(async (input, u) => {
  if (!store.isAdmin(u.username)) throw new EndpointError('forbidden');
  if (input.action === 'retry') {
    try {
      return { retried: await retryEntry(String(input.id || '')) };
    } catch (e) {
      throw new EndpointError((e && e.message) || 'error');
    }
  }
  return { items: await viewLog(30) };
});
