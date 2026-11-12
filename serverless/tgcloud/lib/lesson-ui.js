// Derive UI annotations from actual persisted edits and the original ICS, never from guessed labels.
export function annotateLessonChanges(days, baseline, edits, roomOf) {
  const raw = Array.isArray(baseline) ? baseline : [];
  const changes = edits || {};
  const eventKey = e => (e.original || e.summary) + '[' + e.start + ']';
  for (const day of days) for (const item of day.items || []) {
    const key = item.original + '[' + item.start + ']';
    const current = changes[day.date]?.[key];
    const target = day.date + '|' + key;
    const sources = [];
    for (const [date, entries] of Object.entries(changes)) for (const [sourceKey, edit] of Object.entries(entries || {})) {
      if (edit && edit.moved_to === target) sources.push({ date, key: sourceKey });
    }
    const source = sources.length === 1 ? sources[0] : null;
    const originals = raw.filter(e => source ? e.date === source.date && eventKey(e) === source.key : e.date === day.date && eventKey(e) === key);
    const original = originals.length === 1 ? originals[0] : null;
    const meta = {};
    if (source) {
      const fromStart = original?.start || source.key.slice(source.key.lastIndexOf('[') + 1, -1);
      if (source.date !== day.date || fromStart !== item.start || (original && original.end !== item.end)) {
        meta.time = { before: { date: source.date, start: fromStart, end: original?.end || '' }, after: { date: day.date, start: item.start, end: item.end } };
      }
    }
    if ((current && current.room !== undefined) || source) {
      const before = original ? roomOf(original.desc || '').room : null;
      const after = item.room || '';
      if ((before !== null && before !== after) || (before === null && current?.room !== undefined)) meta.room = { before, after };
    }
    if (Object.keys(meta).length) item.uiChanges = meta;
  }
  return days;
}
