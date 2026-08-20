export function generalCtx() {
  return {
    summaryActive: {
      activeClients: 1775,
      totalClients: 1775,
      clientsWithFinancialProfile: 1600,
      typicalStayDays: 412,
      stayCalculatedClients: 1700,
      typicalMonthlyIncome: 12000,
      monthlyIncomeFilledCount: 1400,
      typicalLiquidityReserve: 80000,
      liquidityReserveFilledCount: 1300,
      typicalLastContribution: 5000,
      lastContributionFilledCount: 1100,
    },
    summaryAll: {
      totalClients: 3415,
      cancelledWithConfirmedDate: 900,
      cancelledWithoutConfirmedDate: 40,
      frozenClients: 200,
      nonActiveClients: 240,
    },
    distActive: {
      segments: [{ label: "PRIVATE", count: 800, percent: 45 }],
      status: [{ label: "Ativo", count: 1775, percent: 100 }],
      engineers: [{ label: "EP1", count: 100, percent: 5 }],
      monthlyIncome: [{ label: "10 a 20 mil", count: 400, percent: 22 }],
      liquidityReserve: [{ label: "100 a 250 mil", count: 300, percent: 17 }],
      financialProfile: [{ label: "Imóvel", count: 900, percent: 50 }],
      stayRanges: [{ label: "Mais de 24 meses", count: 700, percent: 39 }],
    },
    acquisitionSeries: [{ month: "2026-07", acquiredClients: 12 }],
  };
}

export function meetingsCtx() {
  return {
    summary: {
      totalMeetings: 4200,
      averageMeetingsPerMonth: 3.2,
      daysSinceLatestMeeting: 4,
      averageIntervalDays: 48,
      intervalDaysStats: { validCount: 900 },
      totalNoShows: 310,
      totalReschedules: 80,
      attendanceRate: 88.4,
      eligibleMeetings: 3900,
      noShowsEligible: 452,
      attendanceInsufficientData: false,
      filteredClients: 1775,
    },
    dist: {
      intervalRanges: [{ label: "31-60 dias", count: 400, percent: 22 }],
      attendanceStatus: [{ label: "Compareceu", count: 3000, percent: 71 }],
      meetingsByEngineer: [{ label: "EP1", count: 200, percent: 5 }],
      meetingsByMonth: [{ month: "2026-07", scheduled: 300, completed: 250, noShows: 20 }],
    },
    meetingTypes: {
      available: true,
      byFamily: [{ label: "Follow-up", count: 120, percent: 40 }],
    },
  };
}

export function journeyCtx() {
  return {
    summary: {
      completionCoverage: { sample: 1500, total: 1775, percent: 84.5 },
      comparableCoverage: { sample: 900, total: 1775, percent: 50.7 },
    },
    dist: {
      completion: [
        { label: "Sim", count: 1100, percent: 73.3 },
        { label: "Não", count: 400, percent: 26.7 },
      ],
      totalOnboarding: [{ label: "16-30 dias", count: 300, percent: 33.3 }],
    },
  };
}

export function planCtx() {
  return {
    approvalTime: {
      value: 86.4,
      eligibleClients: 2100,
      totalPopulation: 3415,
      coveragePercent: 61.5,
    },
  };
}

export function mechanismsCtx() {
  return {
    summary: {
      clientsWithMechanisms: 77,
      availableMechanisms: 200,
      implementedMechanisms: 142,
      inProgressMechanisms: 30,
      implementationPercent: 71,
      typesUsed: 18,
      typesUnused: 4,
      catalogSize: 22,
      topMechanismName: "ARCADIA",
      topMechanismClients: 37,
      recentClients: 9,
      coverage: { sample: 77, total: 1775, percent: 4.3 },
      statusDist: [{ label: "Implementado", count: 142, percent: 71 }],
      countDist: [{ label: "1", count: 40, percent: 52 }],
      catalogDist: [
        { label: "Tipos utilizados", count: 18, percent: 81.8 },
        { label: "Tipos sem utilização", count: 4, percent: 18.2 },
      ],
      typeUsage: [{ label: "ARCADIA", count: 37, percent: 18.5 }],
      months: [{ label: "2026-07", count: 12 }],
      bySegment: [{ label: "PRIVATE", count: 80, percent: 56 }],
      byEngineer: [{ label: "EP1", count: 10, percent: 8, total: 120 }],
    },
  };
}

export function mockComputes() {
  return {
    general: async () => generalCtx(),
    meetings: async () => meetingsCtx(),
    journey: async () => journeyCtx(),
    patrimonial_plan: async () => planCtx(),
    mechanisms: async () => mechanismsCtx(),
  };
}
