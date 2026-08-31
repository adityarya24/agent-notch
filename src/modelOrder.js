export function sortModelsByOrder(models, order) {
  if (!Array.isArray(models) || models.length === 0) return [];
  const byId = new Map(models.map((model) => [model.id, model]));
  const used = new Set();
  const next = [];
  if (Array.isArray(order)) {
    for (const id of order) {
      if (typeof id !== 'string' || used.has(id) || !byId.has(id)) continue;
      next.push(byId.get(id));
      used.add(id);
    }
  }
  for (const model of models) {
    if (used.has(model.id)) continue;
    next.push(model);
    used.add(model.id);
  }
  return next;
}

export function moveId(order, fromId, toId) {
  if (!Array.isArray(order) || fromId === toId) return order;
  const from = order.indexOf(fromId);
  const to = order.indexOf(toId);
  if (from < 0 || to < 0) return order;
  const next = order.slice();
  next.splice(from, 1);
  next.splice(to, 0, fromId);
  return next;
}
