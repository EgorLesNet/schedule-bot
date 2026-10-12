import * as sdk from 'sdk';

export async function getText(url) {
  const f = sdk.fetch || globalThis.fetch;
  const r = await f(url, { headers: { 'User-Agent': 'schedule-bot' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.text();
}
