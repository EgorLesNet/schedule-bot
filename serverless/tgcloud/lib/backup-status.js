export function backupPages(cloud, receipts) {
  const valid = r => r && /^[a-z0-9]{1,32}$/.test(r.id || '') && /^[a-f0-9]{64}$/.test(r.sha256 || '') && Number.isSafeInteger(r.ts) && r.ts > 0 && Number.isSafeInteger(r.verifiedAt) && r.verifiedAt > 0 && Number.isSafeInteger(r.keys) && r.keys >= 0 && Number.isSafeInteger(r.attachments) && r.attachments >= 0;
  const date = ts => new Date(ts + 10800000).toISOString().slice(0,16).replace('T',' ') + ' МСК';
  const entries = new Map();
  for (const r of (Array.isArray(receipts) ? receipts : []).filter(valid)) {
    const old = entries.get(r.id);
    if (!old || old.receipt.verifiedAt < r.verifiedAt) entries.set(r.id, {id:r.id, ts:r.ts, receipt:r});
  }
  for (const b of cloud) {
    const id = b.ts.toString(36), entry = entries.get(id);
    const receipt = entry?.receipt?.ts === b.ts && entry.receipt.keys === b.keys ? entry.receipt : null;
    entries.set(id, {id, ts:b.ts, cloud:b, receipt});
  }
  const rows = [...entries.values()].sort((a,b)=>b.ts-a.ts).map(e => {
    const r = e.receipt;
    return e.id + ' · ' + date(e.ts) + '\n' + (e.cloud ? 'TGCloud: снимок доступен.' : 'TGCloud: снимка уже нет в списке.') + '\n' + (r ? 'iMac: сохранение подтверждено ' + date(r.verifiedAt) + '. Записей: ' + r.keys + ', вложений: ' + r.attachments + '.' : 'iMac: подтверждения сохранения нет.');
  });
  if (!rows.length) return ['Копий и подтверждений iMac пока нет. Создать снимок TGCloud: /backup.'];
  const footer = '\n\nПодтверждение iMac — историческое, не проверка доступности диска сейчас. /restore id восстанавливает только доступный снимок TGCloud. Архив iMac восстанавливается отдельным клиентом.';
  const pages = [];
  for (let i=0; i<rows.length; i+=6) pages.push('Бэкапы (' + (i+1) + '–' + Math.min(i+6,rows.length) + ' из ' + rows.length + '):\n\n' + rows.slice(i,i+6).join('\n\n') + footer);
  return pages;
}
