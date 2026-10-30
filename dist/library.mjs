/** Apply a saved order without losing newly added tunings or keeping stale IDs. */
export function orderedTunings(presets, savedIds) {
  const byId = new Map();
  for (const preset of Array.isArray(presets) ? presets : []) {
    if (preset && typeof preset.id === 'string' && preset.id && !byId.has(preset.id)) byId.set(preset.id, preset);
  }
  const result = [];
  for (const id of Array.isArray(savedIds) ? savedIds : []) {
    if (typeof id !== 'string' || !byId.has(id)) continue;
    result.push(byId.get(id));
    byId.delete(id);
  }
  return result.concat([...byId.values()]);
}

/** Move within the full instrument library, including any currently hidden rows. */
export function reorderTuningIds(presets, savedIds, sourceId, targetId, placement = 'before') {
  const ids = orderedTunings(presets, savedIds).map(preset => preset.id);
  if (sourceId === targetId || !ids.includes(sourceId) || !ids.includes(targetId) || !['before', 'after'].includes(placement)) return ids;
  ids.splice(ids.indexOf(sourceId), 1);
  const targetIndex = ids.indexOf(targetId);
  ids.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, sourceId);
  return ids;
}

function searchText(value) {
  return (typeof value === 'string' ? value : '').replaceAll('♯', '#').replaceAll('♭', 'b').toLowerCase().replace(/\s+/gu, ' ').trim();
}

/** Match every query term across the name, subtitle and scientific note names. */
export function filterTunings(presets, query) {
  const items = Array.isArray(presets) ? presets : [];
  const terms = searchText(query).split(' ').filter(Boolean);
  if (!terms.length) return items.slice();
  return items.filter(preset => {
    const text = searchText([preset.name, preset.subtitle, ...(Array.isArray(preset.notes) ? preset.notes : [])].filter(value => typeof value === 'string').join(' '));
    return terms.every(term => text.includes(term));
  });
}
