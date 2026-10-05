// `status` belongs to the user's application tracker. Source availability is
// separate, including for records saved by older adapter versions.
const SOURCE_STATES = /^(active|published|open|closed|inactive|expired|unknown|закрыт)$/i;
export function normalizeOpportunity(item) {
  const out = { ...item };
  if (SOURCE_STATES.test(String(out.status || ''))) {
    out.availability ||= String(out.status).toLowerCase();
    delete out.status;
  }
  return out;
}

export function mergeOpportunity(prior, incoming) {
  const next = normalizeOpportunity(prior);
  for (const [key, value] of Object.entries(normalizeOpportunity(incoming))) {
    if (!['status', 'letter', 'notes', 'collectedAt', 'source', 'id'].includes(key)
        && value !== undefined && value !== null && value !== '') next[key] = value;
  }
  return next;
}
