import { fetch } from 'sdk';

export async function getText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'schedule-bot' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.text();
}
