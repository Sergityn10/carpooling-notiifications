function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegexKey(key) {
  return String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Interpola variables {{key}} de forma segura (sin interpretación especial de '$'
 * y con escape HTML opcional para prevenir HTML injection).
 */
function interpolate(text, data = {}, { escapeForHtml = false } = {}) {
  let result = String(text ?? "");
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`{{\\s*${escapeRegexKey(key)}\\s*}}`, "g");
    const safeValue = escapeForHtml
      ? escapeHtml(value ?? "")
      : String(value ?? "");
    result = result.replace(regex, () => safeValue);
  }

  return result.replace(/{{\s*[a-zA-Z0-9_]+\s*}}/g, "");
}

/**
 * Divide un array en sub-arrays de tamaño máximo `chunkSize`.
 */
function chunkArray(items = [], chunkSize = 500) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const size = Math.max(1, Number(chunkSize) || 1);
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Normaliza y deduplica una lista de identificadores no vacíos manteniendo el orden.
 */
function deduplicateIds(ids = []) {
  if (!Array.isArray(ids)) return [];
  const seen = new Set();
  const result = [];
  for (const id of ids) {
    if (id === undefined || id === null) continue;
    const normalized = String(id).trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

module.exports = {
  escapeHtml,
  interpolate,
  chunkArray,
  deduplicateIds,
};
