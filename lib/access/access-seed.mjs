/**
 * Bootstrap idempotente dos usuários/grupos do CSV + owners iniciais.
 * Usado pela migration e pelos testes. Não consulta banco.
 */
import { normalizeAccessEmail } from "./access-policy.mjs";

export const INITIAL_OWNERS = Object.freeze([
  "jessicacarvalho@quartavia.com.br",
  "matheuslacerda@quartavia.com.br",
  "thassyacosta@quartavia.com.br",
  "cadubarral@quartavia.com.br",
  "anagazzo@quartavia.com.br",
]);

export const SEED_GROUP_MEMBERS = Object.freeze({
  leaders: Object.freeze([
    "anagazzo@quartavia.com.br",
    "cadubarral@quartavia.com.br",
    "victoriadalmeida@quartavia.com.br",
    "maximomarmund@quartavia.com.br",
    "raphaelribas@quartavia.com.br",
    "adriancarvalho@quartavia.com.br",
    "victor@quartavia.com.br",
  ]),
  eps: Object.freeze([
    "nicolasalves@quartavia.com.br",
    "rodrigoamorim@quartavia.com.br",
    "rodrigolunardi@quartavia.com.br",
    "samuelaraujo@quartavia.com.br",
    "talesrozo@quartavia.com.br",
    "thiagotrova@quartavia.com.br",
    "tiagojunior@quartavia.com.br",
    "willianschimidt@quartavia.com.br",
    "andrerockenbach@quartavia.com.br",
    "abnerbraga@quartavia.com.br",
    "williansobral@quartavia.com.br",
    "carlosserafin@quartavia.com.br",
    "cleuberaparecido@quartavia.com.br",
    "joaoaliceda@quartavia.com.br",
    "hendrickramos@quartavia.com.br",
    "juniorteixeira@quartavia.com.br",
    "lucasdaniel@quartavia.com.br",
    "pedrogoulart@quartavia.com.br",
    "felipealeixo@quartavia.com.br",
    "andrielicampesato@quartavia.com.br",
    "eduardoperoni@quartavia.com.br",
    "gabrieloliveira@quartavia.com.br",
    "gustavomariano@quartavia.com.br",
    "juliocienkonog@quartavia.com.br",
    "nelsonmarques@quartavia.com.br",
    "elenicesolovy@quartavia.com.br",
    "arielzocoli@quartavia.com.br",
    "danielfentanes@quartavia.com.br",
    "thiagofreire@quartavia.com.br",
    "anaavalos@quartavia.com.br",
  ]),
  team_leaders_ep: Object.freeze([
    "gustavomariano@quartavia.com.br",
    "cleuberaparecido@quartavia.com.br",
    "talesrozo@quartavia.com.br",
    "felipealeixo@quartavia.com.br",
    "gabrieloliveira@quartavia.com.br",
  ]),
  quality: Object.freeze([
    "steffanydutra@quartavia.com.br",
    "demervaljunior@quartavia.com.br",
    "lizfidelis@quartavia.com.br",
  ]),
  finance: Object.freeze([
    "maximomarmund@quartavia.com.br",
    "financeiro@quartavia.com.br",
    "wilsoncohim@quartavia.com.br",
    "gabrielcouto@quartavia.com.br",
    "brennosherlock@quartavia.com.br",
  ]),
});

export function buildAccessSeedUsers() {
  const byEmail = new Map();

  function upsert(email, patch = {}) {
    const normalized = normalizeAccessEmail(email);
    const current = byEmail.get(normalized) || {
      email: normalized,
      isOwner: false,
      groups: new Set(),
    };
    if (patch.isOwner) current.isOwner = true;
    for (const group of patch.groups || []) current.groups.add(group);
    byEmail.set(normalized, current);
  }

  for (const email of INITIAL_OWNERS) upsert(email, { isOwner: true });
  for (const [group, emails] of Object.entries(SEED_GROUP_MEMBERS)) {
    for (const email of emails) upsert(email, { groups: [group] });
  }

  return [...byEmail.values()]
    .map((user) => ({
      email: user.email,
      isOwner: user.isOwner,
      groups: [...user.groups].sort(),
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

export const PRODUCT_SEED_USERS = Object.freeze([
  "adrianocosta@quartavia.com.br",
  "barbaradias@quartavia.com.br",
  "brunaarnold@quartavia.com.br",
  "giselegodoy@quartavia.com.br",
  "lilianereus@quartavia.com.br",
]);

export function summarizeAccessSeed(users = buildAccessSeedUsers()) {
  const groupCounts = {
    leaders: 0,
    eps: 0,
    team_leaders_ep: 0,
    quality: 0,
    finance: 0,
    product: 0,
  };
  const multiGroup = [];
  for (const user of users) {
    for (const group of user.groups) {
      if (groupCounts[group] != null) groupCounts[group] += 1;
    }
    if (user.groups.length > 1) multiGroup.push(user);
  }
  return {
    uniqueUsers: users.length,
    owners: users.filter((user) => user.isOwner).length,
    groupCounts,
    multiGroup,
  };
}
