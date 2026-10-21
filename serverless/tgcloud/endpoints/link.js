import { EndpointError } from 'sdk';
import * as store from '../lib/store.js';
import { endpoint } from '../lib/auth.js';
import { canEdit } from '../lib/roles.js';

export default endpoint(async (input, u) => {
  const user = await store.getUser(u.id);
  if (!(await canEdit(u.username, user))) throw new EndpointError('forbidden');
  if (!user.course) throw new EndpointError('no course');
  const original = String(input.original || '').trim();
  const date = String(input.date || '');
  const start = String(input.start || '');
  if (!original) throw new EndpointError('bad input');
  const key = input.all ? original + '|*' : original + '|' + date + '|' + start;
  const links = await store.loadLinks(user.course, user.stream);
  if (input.action === 'delete') {
    delete links[key];
  } else {
    const url = String(input.url || '').trim();
    if (!/^https?:[/][/][^ ]{3,500}$/.test(url)) throw new EndpointError('bad url');
    links[key] = url;
  }
  await store.saveLinks(user.course, user.stream, links);
  return { ok: true };
});
