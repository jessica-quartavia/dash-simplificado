const EXCLUDED_EMAILS = new Set(["casoisolado32@gmail.com"]);
const EXCLUDED_NAMES = new Set(["liliane reus", "liliane dos santos reus"]);

export function foldExcludedIdentity(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function isExcludedClient(row) {
  const name = foldExcludedIdentity(row?.name ?? row?.client_name ?? row?.clientName);
  const email = foldExcludedIdentity(row?.email ?? row?.alternative_email ?? row?.user_email ?? row?.client_email ?? row?.clientEmail);
  return EXCLUDED_NAMES.has(name) || EXCLUDED_EMAILS.has(email);
}

export function filterExcludedClients(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => !isExcludedClient(row));
}

export function excludedClientIds(rows) {
  return new Set(
    (Array.isArray(rows) ? rows : [])
      .filter(isExcludedClient)
      .map((row) => String(row?.id ?? row?.client_id ?? row?.clientId ?? ""))
      .filter(Boolean),
  );
}
