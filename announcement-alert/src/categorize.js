export function categorize(item, categories) {
  const haystack = JSON.stringify(item).toLowerCase();

  for (const category of categories) {
    if (category.keywords.some((k) => haystack.includes(k.toLowerCase()))) {
      return category.name;
    }
  }
  return null;
}

export function groupByCategory(items, categories, fallbackLabel) {
  const order = categories.map((c) => c.name);
  const groups = new Map();

  for (const item of items) {
    const key = item.category ?? fallbackLabel;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  return [...groups.entries()].sort(([a], [b]) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}
