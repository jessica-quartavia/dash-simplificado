/**
 * Regras de exibição da coluna Cliente — Acionamentos.
 * Separa identificação BASE QV (KPI) de rótulo visual (tabela).
 */
import { blankToNull, foldToken, toBool } from "./support-analytics.mjs";

export const CLIENT_DISPLAY = Object.freeze({
  BASE_QV: "base_qv",
  EXTERNAL_NAME: "external_name",
  EXTERNAL_EMAIL: "external_email",
  CORPORATE_DASH: "corporate_dash",
  UNIDENTIFIED: "unidentified",
});

function isCorporateEmail(email) {
  return String(email || "").trim().toLowerCase().endsWith("@quartavia.com.br");
}

function namesMatch(a, b) {
  const left = foldToken(a);
  const right = foldToken(b);
  return Boolean(left && right && left === right);
}

function firstExternalEmail(candidates = []) {
  for (const raw of candidates) {
    const email = blankToNull(raw);
    if (!email) continue;
    if (isCorporateEmail(email)) continue;
    return String(email).trim();
  }
  return null;
}

function firstCorporateOnly(candidates = []) {
  let sawCorporate = false;
  let sawExternal = false;
  for (const raw of candidates) {
    const email = blankToNull(raw);
    if (!email) continue;
    if (isCorporateEmail(email)) sawCorporate = true;
    else sawExternal = true;
  }
  return sawCorporate && !sawExternal;
}

export function isExactTestAcionamentoTitle(title) {
  return foldToken(title) === "teste";
}

export function filterOutTestAcionamentos(rows = []) {
  const kept = [];
  let excludedCount = 0;
  for (const row of rows || []) {
    if (isExactTestAcionamentoTitle(row?.titulo)) {
      excludedCount += 1;
      continue;
    }
    kept.push(row);
  }
  return { rows: kept, excludedCount };
}

export function hasSecureBaseQvMatch(tratado, clients = []) {
  if (blankToNull(tratado?.baseqv_client_id)) return true;
  if (toBool(tratado?.cliente_encontrado_baseqv) === true && clients.some((c) => blankToNull(c.clientId))) {
    return true;
  }
  return clients.some((c) => blankToNull(c.clientId));
}

function trustedExternalClientName(row = {}, tratado = null, requester = "") {
  const candidates = [
    blankToNull(tratado?.baseqv_client_name),
    blankToNull(row.client_name),
    blankToNull(tratado?.client_name_original),
  ];
  for (const name of candidates) {
    if (!name) continue;
    if (namesMatch(name, requester)) continue;
    if (namesMatch(name, row.nome_solicitante)) continue;
    return String(name).trim();
  }
  return null;
}

export function resolveSupportClientDisplay({
  row = {},
  tratado = null,
  clients = [],
  hasBaseQvMatch = false,
  requester = "",
  countClients = 0,
} = {}) {
  const emailCandidates = [
    tratado?.email_cliente_identificado,
    tratado?.email_cliente_original,
    row.email_cliente,
    tratado?.email_campo_normalizado,
  ];

  if (hasBaseQvMatch) {
    const primary = clients.find((c) => blankToNull(c.clientId)) || clients[0] || null;
    const name = blankToNull(tratado?.baseqv_client_name)
      || blankToNull(primary?.name)
      || trustedExternalClientName(row, tratado, requester);
    const code = blankToNull(tratado?.baseqv_codigo) || blankToNull(primary?.code);
    if (countClients > 1) {
      return {
        display: `${countClients} clientes identificados`,
        displayKind: CLIENT_DISPLAY.BASE_QV,
        sourceField: "baseqv_client_id",
      };
    }
    if (name && code) {
      return { display: `${name} (${code})`, displayKind: CLIENT_DISPLAY.BASE_QV, sourceField: "baseqv_client_name" };
    }
    if (name) {
      return { display: name, displayKind: CLIENT_DISPLAY.BASE_QV, sourceField: "baseqv_client_name" };
    }
    return { display: "Cliente identificado", displayKind: CLIENT_DISPLAY.BASE_QV, sourceField: "baseqv_client_id" };
  }

  const externalName = trustedExternalClientName(row, tratado, requester);
  if (externalName) {
    return {
      display: externalName,
      displayKind: CLIENT_DISPLAY.EXTERNAL_NAME,
      sourceField: blankToNull(row.client_name) ? "client_name" : "client_name_original",
    };
  }

  const externalEmail = firstExternalEmail(emailCandidates);
  if (externalEmail) {
    return {
      display: externalEmail,
      displayKind: CLIENT_DISPLAY.EXTERNAL_EMAIL,
      sourceField: "email_cliente",
    };
  }

  if (firstCorporateOnly(emailCandidates) || toBool(tratado?.email_campo_corporativo) === true) {
    return { display: "—", displayKind: CLIENT_DISPLAY.CORPORATE_DASH, sourceField: "email_cliente" };
  }

  return { display: "Não identificado", displayKind: CLIENT_DISPLAY.UNIDENTIFIED, sourceField: null };
}

export function summarizeClientDisplayKinds(tickets = []) {
  const counts = {
    [CLIENT_DISPLAY.BASE_QV]: 0,
    [CLIENT_DISPLAY.EXTERNAL_NAME]: 0,
    [CLIENT_DISPLAY.EXTERNAL_EMAIL]: 0,
    [CLIENT_DISPLAY.CORPORATE_DASH]: 0,
    [CLIENT_DISPLAY.UNIDENTIFIED]: 0,
  };
  for (const ticket of tickets) {
    const kind = ticket.clientDisplayKind || CLIENT_DISPLAY.UNIDENTIFIED;
    counts[kind] = (counts[kind] || 0) + 1;
  }
  return {
    baseQv: counts[CLIENT_DISPLAY.BASE_QV],
    externalName: counts[CLIENT_DISPLAY.EXTERNAL_NAME],
    externalEmail: counts[CLIENT_DISPLAY.EXTERNAL_EMAIL],
    corporateDash: counts[CLIENT_DISPLAY.CORPORATE_DASH],
    unidentified: counts[CLIENT_DISPLAY.UNIDENTIFIED],
  };
}
