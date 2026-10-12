export function attachLinks(days, events, links) {
  for (const d of days) {
    for (const i of d.items) {
      const e = events.find((x) => x.date === d.date && x.start === i.start && x.summary === i.summary);
      const original = e ? e.original : i.summary;
      const exact = links[original + '|' + d.date + '|' + i.start];
      const all = links[original + '|*'];
      i.original = original;
      i.link = exact || all || '';
      i.linkAll = !exact && !!all;
    }
  }
  return days;
}
