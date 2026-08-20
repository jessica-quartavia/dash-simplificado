/**
 * Snapshot é agregado. Qualquer PII impede persistência.
 */
const FORBIDDEN_KEY = /^(email|e-mail|cpf|cnpj|telefone|phone|celular|client_id|clientid|client_ids|clientidlist|client_name|clientname|nome|full_name|fullname)$/i;
const FORBIDDEN_TEXT = /\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export function findSnapshotPii(node, path = "root") {
  if (node == null) return null;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) {
      const hit = findSnapshotPii(node[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node === "string") {
    if (FORBIDDEN_TEXT.test(node)) return path;
    return null;
  }
  if (typeof node !== "object") return null;
  for (const [key, value] of Object.entries(node)) {
    if (FORBIDDEN_KEY.test(key)) return `${path}.${key}`;
    const hit = findSnapshotPii(value, `${path}.${key}`);
    if (hit) return hit;
  }
  return null;
}

export function assertSnapshotHasNoPii(snapshot) {
  const hit = findSnapshotPii(snapshot);
  if (hit) {
    const error = new Error(`Snapshot contém PII em ${hit}.`);
    error.code = "snapshot_pii";
    throw error;
  }
}
