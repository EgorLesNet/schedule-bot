// План массового сдвига пар предмета: новые интервалы, жёсткие проблемы (блокируют применение) и пересечения с парами других предметов (нужно подтверждение)
const LUNCH = /обед|перерыв/i;
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export const addMin = (t, d) => {
  const m = toMin(t) + d;
  if (m < 0 || m > 1439) return '';
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
};

export function planShift(all, se, subj, mins, from) {
  const found = all.filter((e) => e.summary === subj && e.date >= from);
  const foundSet = new Set(found);
  const plan = [];
  const seen = new Set();
  for (const e of found) {
    const oldKey = e.original + '[' + e.start + ']';
    if (seen.has(e.date + '|' + oldKey)) continue;
    seen.add(e.date + '|' + oldKey);
    const ns = addMin(e.start, mins);
    const ne = addMin(e.end, mins);
    const existing = se[e.date] && se[e.date][oldKey];
    const inPlace = !!(existing && existing.new);
    const title = inPlace ? existing.new_summary : subj;
    plan.push({ e, oldKey, ns, ne, existing, inPlace, nk: ns ? title + '[' + ns + ']' : '', problems: [], warns: [] });
  }
  const olds = {};
  for (const p of plan) (olds[p.e.date] = olds[p.e.date] || new Set()).add(p.oldKey);
  const news = {};
  for (const p of plan) {
    if (!p.ns || !p.ne) { p.problems.push('Время выходит за пределы суток'); continue; }
    const set = (news[p.e.date] = news[p.e.date] || new Set());
    if (set.has(p.nk) || olds[p.e.date].has(p.nk) || (se[p.e.date] && se[p.e.date][p.nk])) p.problems.push('Совпадает со временем другой пары этого предмета');
    set.add(p.nk);
  }
  for (const p of plan) {
    if (!p.ns || !p.ne) continue;
    const a = toMin(p.ns);
    const b = toMin(p.ne);
    for (const o of all) {
      if (o.date !== p.e.date || foundSet.has(o) || LUNCH.test(o.summary)) continue;
      if (a < toMin(o.end) && toMin(o.start) < b) p.warns.push('Пересекается с «' + o.summary + '» ' + o.start + '–' + o.end);
    }
  }
  plan.sort((x, y) => x.e.date.localeCompare(y.e.date) || x.e.start.localeCompare(y.e.start));
  return { plan };
}

// Отпечаток плана: если расписание изменилось между предпросмотром и подтверждением, он будет другим
export function planToken(plan) {
  let x = 5381;
  for (const c of plan.map((p) => p.e.date + p.oldKey + p.ns + p.ne).join('|')) x = ((x * 33) ^ c.charCodeAt(0)) >>> 0;
  return x.toString(36);
}

export const planRows = (plan) => plan.map((p) => ({ date: p.e.date, from: p.e.start + '–' + p.e.end, to: p.ns && p.ne ? p.ns + '–' + p.ne : '—', problems: p.problems, warns: p.warns }));
