// Bridge to the existing buttons: their handlers retain routing, haptics and repeated taps.
export function readNavigation(legacy, tabs, state, width) {
  if (!legacy || !Array.isArray(tabs) || !tabs.length || !Number.isFinite(width) || width < 100) return null;
  const buttons = Array.from(legacy.querySelectorAll('button'));
  if (buttons.length !== tabs.length) return null;
  const items = tabs.map(([value, label], i) => ({ value, label: String(label), icon: buttons[i].querySelector('i')?.innerHTML || '' }));
  if (items.some((x) => typeof x.value !== 'string') || new Set(items.map((x) => x.value)).size !== items.length) return null;
  const selected = items.find((x) => x.value === state?.tab)?.value || items[buttons.findIndex((b) => b.classList.contains('on'))]?.value || items[0].value;
  const slot = Math.max(1, (width - 8) / items.length);
  return { items, value: selected, slot, signature: JSON.stringify([items, selected, Math.round(slot * 10) / 10]) };
}
export function activateTab(value, legacy, tabs) {
  const index = tabs.findIndex((t) => t[0] === value);
  const buttons = Array.from(legacy.querySelectorAll('button'));
  if (index < 0 || buttons.length !== tabs.length || buttons[index].disabled) return false;
  buttons[index].click();
  return true;
}
