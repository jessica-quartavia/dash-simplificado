/**
 * Série temporal de adoção de mecanismos (BASE QV · client_mecanismos).
 */
import { parseDate, blankToNull } from "./meeting-metrics.mjs";
import { calendarDateFromValue, civilDateInSaoPaulo } from "./client-cycle-renewal.mjs";
import { isBaseQvImplementedRawStatus } from "./mechanisms/mechanism-status.mjs";

function monthKey(isoDate) {
  if (!isoDate) return null;
  return String(isoDate).slice(0, 7);
}

function parseImplDate(link) {
  const impl = parseDate(link.implemented_at);
  if (impl) return calendarDateFromValue(impl);
  const created = parseDate(link.created_at);
  return created ? calendarDateFromValue(created) : null;
}

export function buildMechanismAdoptionSeries(cmRows = [], clients = [], cancelMap = new Map()) {
  const clientEntry = new Map();
  for (const c of clients) {
    const id = String(c.id);
    const entry =
      calendarDateFromValue(c.data_inicio_ciclo) || calendarDateFromValue(c.created_at) || null;
    clientEntry.set(id, entry);
  }

  const firstImplByClient = new Map();
  const implEvents = [];

  for (const link of cmRows || []) {
    if (!isBaseQvImplementedRawStatus(link.status)) continue;
    const clientId = blankToNull(link.client_id);
    if (!clientId) continue;
    const d = parseImplDate(link);
    if (!d) continue;
    implEvents.push({ clientId: String(clientId), date: d, month: monthKey(d) });
    const prev = firstImplByClient.get(String(clientId));
    if (!prev || d < prev) firstImplByClient.set(String(clientId), d);
  }

  const monthsSet = new Set(implEvents.map((e) => e.month).filter(Boolean));
  for (const d of firstImplByClient.values()) {
    const m = monthKey(d);
    if (m) monthsSet.add(m);
  }
  const months = [...monthsSet].sort();

  const monthly = months.map((month) => {
    const monthEnd = `${month}-28`;
    let activePortfolio = 0;
    for (const c of clients) {
      const id = String(c.id);
      const entry = clientEntry.get(id);
      if (!entry || entry > monthEnd) continue;
      const cancel = cancelMap.get(id);
      const cancelDate = cancel?.date ? calendarDateFromValue(cancel.date) : null;
      if (cancelDate && cancelDate <= monthEnd) continue;
      activePortfolio += 1;
    }
    const firstClientsThisMonth = [...firstImplByClient.entries()].filter(([, d]) => monthKey(d) === month)
      .length;
    const totalImplThisMonth = implEvents.filter((e) => e.month === month).length;
    const cumulativeClients = [...firstImplByClient.values()].filter((d) => d <= monthEnd).length;
    return {
      month,
      clientsFirstImplementation: firstClientsThisMonth,
      totalImplementations: totalImplThisMonth,
      activeClientsApprox: activePortfolio,
      cumulativeClientsWithImplementation: cumulativeClients,
      portfolioExposurePct: activePortfolio
        ? Math.round((cumulativeClients / activePortfolio) * 1000) / 10
        : null,
    };
  });

  const firstImplDate =
    implEvents.length > 0 ? implEvents.map((e) => e.date).sort()[0] : null;

  return {
    firstImplementationDate: firstImplDate,
    firstImplementationMonth: firstImplDate ? monthKey(firstImplDate) : null,
    monthly,
    totalImplementedLinks: implEvents.length,
    distinctClientsWithImplementation: firstImplByClient.size,
    implEvents,
    firstImplByClient,
  };
}

function firstMonthMatching(monthly, predicate) {
  for (const row of monthly) {
    if (predicate(row)) return row.month;
  }
  return null;
}

export function proposeMechanismEraCutoffs(adoptionSeries) {
  const monthly = adoptionSeries.monthly || [];
  if (!monthly.length) {
    return { cutoffs: [], criteria: "Sem implementações datadas." };
  }

  const peakClients = Math.max(...monthly.map((m) => m.clientsFirstImplementation), 1);
  const peakImpl = Math.max(...monthly.map((m) => m.totalImplementations), 1);

  const ampleMinClients = Math.max(5, Math.ceil(peakClients * 0.08));
  const intermediateMinClients = Math.max(12, Math.ceil(peakClients * 0.2));
  const conservativeMinClients = Math.max(25, Math.ceil(peakClients * 0.45));
  const ampleMinImpl = Math.max(6, Math.ceil(peakImpl * 0.06));
  const intermediateMinImpl = Math.max(15, Math.ceil(peakImpl * 0.15));
  const conservativeMinImpl = Math.max(35, Math.ceil(peakImpl * 0.35));

  const ampleMonth =
    firstMonthMatching(
      monthly,
      (m) => m.clientsFirstImplementation >= ampleMinClients || m.totalImplementations >= ampleMinImpl,
    ) || monthly[0].month;

  const intermediateMonth =
    firstMonthMatching(
      monthly,
      (m) =>
        m.clientsFirstImplementation >= intermediateMinClients
        || m.totalImplementations >= intermediateMinImpl,
    ) || ampleMonth;

  const conservativeMonth =
    firstMonthMatching(
      monthly,
      (m) =>
        m.clientsFirstImplementation >= conservativeMinClients
        || m.totalImplementations >= conservativeMinImpl,
    ) || intermediateMonth;

  const stabilizationMonth = (() => {
    const threshold = Math.max(8, Math.ceil(peakClients * 0.25));
    let streak = 0;
    for (const row of monthly) {
      if (row.clientsFirstImplementation >= threshold) streak += 1;
      else streak = 0;
      if (streak >= 3) return row.month;
    }
    return null;
  })();

  const cutoffs = [
    {
      id: "ample",
      label: "Corte amplo",
      eraStart: `${ampleMonth}-01`,
      eraStartMonth: ampleMonth,
      rule: `Primeiro mês com >= ${ampleMinClients} clientes na 1ª implementação OU >= ${ampleMinImpl} implementações totais.`,
    },
    {
      id: "intermediate",
      label: "Corte intermediário",
      eraStart: `${intermediateMonth}-01`,
      eraStartMonth: intermediateMonth,
      rule: `Primeiro mês com >= ${intermediateMinClients} clientes na 1ª implementação OU >= ${intermediateMinImpl} implementações.`,
    },
    {
      id: "conservative",
      label: "Corte conservador",
      eraStart: `${conservativeMonth}-01`,
      eraStartMonth: conservativeMonth,
      rule: `Primeiro mês com >= ${conservativeMinClients} clientes na 1ª implementação OU >= ${conservativeMinImpl} implementações.`,
    },
  ];

  return {
    cutoffs,
    peakMonthlyClients: peakClients,
    peakMonthlyImplementations: peakImpl,
    thresholds: {
      ampleMinClients,
      intermediateMinClients,
      conservativeMinClients,
      ampleMinImpl,
      intermediateMinImpl,
      conservativeMinImpl,
    },
    relevantAdoptionMonth: intermediateMonth,
    stabilizationMonth,
    experimentalStart: adoptionSeries.firstImplementationMonth,
  };
}

export const MECHANISM_ERA_START_PRIMARY = "intermediate";
