import { EndpointError } from 'sdk';
import * as store from '../lib/store.js';
import { endpoint } from '../lib/auth.js';

export default endpoint(async (input, u) => {
  const at = String(input.at || '');
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(at)) throw new EndpointError('bad time');
  const saved = await store.saveUser(u.id, { remindAt: at });
  return { remindAt: saved.remindAt };
});
