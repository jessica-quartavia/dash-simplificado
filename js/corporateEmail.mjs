/** Domínio corporativo QuartaVia — validação única do portal. */
export const ALLOWED_GOOGLE_DOMAIN = "quartavia.com.br";
export const CORPORATE_EMAIL_DOMAIN = ALLOWED_GOOGLE_DOMAIN;

/**
 * Aceita somente e-mails cujo domínio após o @ seja exatamente quartavia.com.br.
 * Nunca usar includes/endsWith no e-mail inteiro.
 */
export function isAllowedCorporateEmail(email) {
  if (typeof email !== "string") return false;
  const normalized = email.trim().toLowerCase();
  const parts = normalized.split("@");
  return (
    parts.length === 2 &&
    parts[0].length > 0 &&
    parts[1] === ALLOWED_GOOGLE_DOMAIN
  );
}

export function isQuartaviaEmail(email) {
  return isAllowedCorporateEmail(email);
}

export function isCorporateEmail(email) {
  return isAllowedCorporateEmail(email);
}

export const INVALID_DOMAIN_MESSAGE =
  "O acesso é permitido somente para contas @quartavia.com.br.";

export const SESSION_EXPIRED_MESSAGE = "Sua sessão expirou. Entre novamente.";
