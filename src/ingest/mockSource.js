// ─── MOCK INGEST SOURCE ──────────────────────────────────────────────────────
// The demo-safe dataset. Mirrors hive-pulse-3d/src/data/teams.ts EXACTLY (the
// canonical schema) but is intentionally a frozen copy — no cross-project import.
// Adds two things Jira would also give us: `shippedPrev` (last sprint velocity)
// and `epics` (initiatives → progress bars). The scoring engine RE-COMPUTES
// health/healthScore/effortScore from these raw inputs, proving the formulas.

export const MOCK_TEAMS = [
  {
    id: 'infra', name: 'Infrastructure', shortName: 'INFRA', board: 'INFRA Board · Azure',
    pm: 'Shwetha P. (DevOps)', systems: ['Azure', 'GitHub Actions', 'SQL Server', 'MongoDB'],
    color: '#F5A623', hexColor: 0xF5A623, isCenter: true,
    standup: 'Mon–Fri · 9:30 AM', sprintPlanning: 'Every other Monday · 1:30 PM',
    shipped: 2, shippedPrev: 2, inFlight: 4, stalled: 0,
    blockers: [],
    inFlightTickets: [
      { id: 'INFRA-891', title: 'LOX — HCM prod config for lender onboarding', stage: 'In Progress', days: 2, blocked: false, stageHistory: { 'Ready for Analysis': 4, 'In Analysis': 6 } },
      { id: 'INFRA-897', title: 'UWX — UWDE DB migration, new risk tier cols', stage: 'In Progress', days: 1, blocked: false, stageHistory: { 'Ready for Analysis': 3, 'In Analysis': 4 } },
      { id: 'INFRA-894', title: 'UWX — Ping Tree affiliate routing cloud config', stage: 'Queued', days: 1, blocked: false, stageHistory: {} },
      { id: 'INFRA-902', title: 'AKX — Fabric pipeline for payment events', stage: 'Queued', days: 1, blocked: false, stageHistory: {} },
    ],
    shippedTickets: [
      { id: 'INFRA-880', title: 'Azure AKS cluster upgrade — node pool resize', day: 'Wed', stageHistory: { 'In Analysis': 8, 'In Dev': 14, 'Code Review': 10, 'Dev Done': 3 } },
      { id: 'INFRA-875', title: 'GitHub Actions runner pool scaling fix', day: 'Mon', stageHistory: { 'In Analysis': 6, 'In Dev': 10, 'Code Review': 8, 'Dev Done': 2 } },
    ],
  },
  {
    id: 'lo', name: 'Lending Ops', shortName: 'LO', board: 'LO Board · HCM',
    pm: 'Shruthi Chanthati', systems: ['HCM (Hive Config Manager)', 'LMS (Loan Management System)'],
    color: '#F5A623', hexColor: 0xF5A623, isCenter: false,
    standup: 'Mon/Tue/Wed/Fri · 9:00 AM', sprintPlanning: 'Every Thursday · 10:00 AM',
    shipped: 14, shippedPrev: 11, inFlight: 6, stalled: 2,
    blockers: [
      { ticketId: 'LO-2041', infraTicket: 'INFRA-891', assignee: '@Shwetha.p', age: 36, label: 'LOX', description: 'HCM prod config — lender onboarding flow', escalate: true },
    ],
    inFlightTickets: [
      { id: 'LO-2041', title: 'HCM prod config — lender onboarding flow', stage: 'Ready to Deploy', days: 3, blocked: true, stageHistory: { 'In Dev': 26, 'Code Review': 14, 'Dev Done': 4, 'In QA': 10 } },
      { id: 'LO-2038', title: 'HCM — Portfolio-level fee configuration', stage: 'In Dev', days: 3, stageHistory: { 'Ready for Dev': 6 } },
      { id: 'LO-2039', title: 'LMS — Origination webhook retry logic', stage: 'In Code Review', days: 2, stageHistory: { 'In Dev': 18 } },
      { id: 'LO-2035', title: 'HCM — Lender permission matrix UI', stage: 'In QA', days: 2, stageHistory: { 'In Dev': 16, 'Code Review': 10, 'Dev Done': 3 } },
      { id: 'LO-2044', title: 'Servicing screen — payment history edge case', stage: 'In Code Review', days: 5, stageHistory: { 'In Dev': 36 } },
    ],
    shippedTickets: [
      { id: 'LO-2030', title: 'HCM — New lender profile configuration screen', day: 'Wed', stageHistory: { 'In Dev': 20, 'Code Review': 12, 'Dev Done': 4, 'In QA': 6, 'QA Done': 2 } },
      { id: 'LO-2033', title: 'LMS payment schedule display fix', day: 'Tue', stageHistory: { 'In Dev': 14, 'Code Review': 8, 'Dev Done': 3, 'In QA': 4, 'QA Done': 2 } },
      { id: 'LO-2025', title: 'HCM — Rate table bulk import tool', day: 'Mon', stageHistory: { 'In Dev': 22, 'Code Review': 16, 'Dev Done': 3, 'In QA': 7, 'QA Done': 2 } },
      { id: 'LO-2028', title: 'Loan origination audit log improvements', day: 'Mon', stageHistory: { 'In Dev': 12, 'Code Review': 9, 'Dev Done': 4, 'In QA': 4, 'QA Done': 1 } },
    ],
  },
  {
    id: 'pay', name: 'Payments', shortName: 'PAY', board: 'PAY Board · Explore Credit',
    pm: "Mike O'Leary", systems: ['Explore Credit', 'MoneyComb', 'USIO/NACHA ACH'],
    color: '#22C55E', hexColor: 0x22C55E, isCenter: false,
    standup: 'Mon–Wed · 8:30 AM', sprintPlanning: 'Every 2nd Friday · 8:30 AM',
    shipped: 11, shippedPrev: 9, inFlight: 4, stalled: 1,
    blockers: [],
    inFlightTickets: [
      { id: 'PAY-889', title: 'ACH retry logic — improved exponential backoff', stage: 'In Code Review', days: 2, stageHistory: { 'In Dev': 10 } },
      { id: 'PAY-891', title: 'Card payment fraud signal integration', stage: 'In Development', days: 3, stageHistory: { 'Ready for Dev': 4 } },
      { id: 'PAY-885', title: 'Collections — delinquency tier logic update', stage: 'In QA', days: 1, stageHistory: { 'In Dev': 8, 'Code Review': 5, 'Dev Done': 2 } },
      { id: 'PAY-892', title: 'NSF fee waiver automation — second-chance rule', stage: 'In Dev', days: 2, stageHistory: { 'Ready for Dev': 3 } },
    ],
    shippedTickets: [
      { id: 'PAY-880', title: 'ACH batch submission optimization', day: 'Thu', stageHistory: { 'In Dev': 9, 'Code Review': 6, 'Dev Done': 2, 'In QA': 4, 'QA Done': 1 } },
      { id: 'PAY-875', title: 'NSF fee waiver automation rule', day: 'Wed', stageHistory: { 'In Dev': 11, 'Code Review': 7, 'Dev Done': 2, 'In QA': 5, 'QA Done': 1 } },
      { id: 'PAY-872', title: 'MoneyComb — USIO webhook reliability fix', day: 'Tue', stageHistory: { 'In Dev': 8, 'Code Review': 4, 'Dev Done': 2, 'In QA': 3, 'QA Done': 1 } },
      { id: 'PAY-869', title: 'RCC processing timeout handling', day: 'Mon', stageHistory: { 'In Dev': 10, 'Code Review': 6, 'Dev Done': 3, 'In QA': 4, 'QA Done': 1 } },
    ],
  },
  {
    id: 'uw', name: 'UW / Lead Gen', shortName: 'UL', board: 'UL Board · VWF · UWDE',
    pm: 'Sanjana Umashankar', systems: ['VWF (Verification Workflow)', 'UWDE (Underwriting Data Engine)', 'Ping Tree'],
    color: '#EF4444', hexColor: 0xEF4444, isCenter: false,
    standup: 'Mon–Fri · 9:15 AM', sprintPlanning: 'Every 2nd Friday · 10:30 AM',
    shipped: 9, shippedPrev: 13, inFlight: 5, stalled: 4,
    blockers: [
      { ticketId: 'UL-1105', infraTicket: 'INFRA-897', assignee: '@Kevin Zhang', age: 28, label: 'UWX', description: 'UWDE database migration — new risk tier cols', escalate: true },
      { ticketId: 'UL-1089', infraTicket: 'INFRA-894', assignee: '@Shwetha.p', age: 22, label: 'UWX', description: 'Ping Tree cloud config — affiliate routing rules', escalate: false },
    ],
    inFlightTickets: [
      { id: 'UL-1105', title: 'UWDE — New risk tier columns migration', stage: 'Ready for QA', days: 4, blocked: true, stageHistory: { 'In Dev': 52, 'Code Review': 28 } },
      { id: 'UL-1089', title: 'Ping Tree — New affiliate cloud config', stage: 'Ready to Deploy', days: 3, blocked: true, stageHistory: { 'In Dev': 40, 'Code Review': 20, 'Dev Done': 8, 'In QA': 16 } },
      { id: 'UL-1098', title: 'VWF — Score cutoff adjustment for HR segment', stage: 'Awaiting QA', days: 4, stageHistory: { 'In Dev': 44, 'Code Review': 22, 'Dev Done': 6 } },
      { id: 'UL-1100', title: 'UWDE — PDP (Payday Predictor) v2 model', stage: 'In Code Review', days: 7, stageHistory: { 'In Dev': 60 } },
      { id: 'UL-1092', title: 'Ping Tree routing v2 — priority algorithm update', stage: 'Analysis Done', days: 2, stageHistory: { 'In Analysis': 18 } },
    ],
    shippedTickets: [
      { id: 'UL-1090', title: 'VWF — Document verification timeout fix', day: 'Thu', stageHistory: { 'In Dev': 32, 'Code Review': 16, 'Dev Done': 6, 'In QA': 10, 'QA Done': 3 } },
      { id: 'UL-1085', title: 'Ping Tree — Affiliate routing priority update', day: 'Mon', stageHistory: { 'In Dev': 28, 'Code Review': 14, 'Dev Done': 5, 'In QA': 8, 'QA Done': 2 } },
    ],
  },
  {
    id: 'analytics', name: 'Analytics', shortName: 'ANA', board: 'MS Fabric · ExploreLMS',
    pm: 'Ben Lull (Principal Architect)', systems: ['MS Fabric', 'ExploreLMSReplica', 'Azure DevOps', 'SQL Server'],
    color: '#F5A623', hexColor: 0xF5A623, isCenter: false,
    standup: 'Mon–Fri · 9:00 AM EST', sprintPlanning: 'Every 2nd Thursday · 11:00 AM',
    shipped: 8, shippedPrev: 6, inFlight: 3, stalled: 1,
    blockers: [
      { ticketId: 'ANA-340', infraTicket: 'INFRA-902', assignee: '@Kevin Zhang', age: 18, label: 'AKX', description: 'Fabric pipeline for new payment events source', escalate: false },
    ],
    inFlightTickets: [
      { id: 'ANA-340', title: 'Fabric pipeline — new payment events source', stage: 'Blocked on Infra', days: 2, blocked: true, stageHistory: { 'In Dev': 10 } },
      { id: 'ANA-338', title: 'Fabric silver layer sync — origination events', stage: 'In Code Review', days: 3, stageHistory: { 'In Dev': 18 } },
      { id: 'ANA-335', title: 'NSF rate dashboard — segment breakdown by LR/HR', stage: 'In Dev', days: 2, stageHistory: { 'Ready for Dev': 5 } },
    ],
    shippedTickets: [
      { id: 'ANA-330', title: 'Q2 vintage performance — LO + FPD cohort analysis', day: 'Thu', stageHistory: { 'In Dev': 14, 'Code Review': 8, 'Dev Done': 3, 'In QA': 5, 'QA Done': 1 } },
      { id: 'ANA-325', title: 'NSF rate trend — segment breakdown', day: 'Wed', stageHistory: { 'In Dev': 12, 'Code Review': 7, 'Dev Done': 3, 'In QA': 4, 'QA Done': 2 } },
      { id: 'ANA-318', title: 'Lead Gen conversion funnel — affiliate quality report', day: 'Tue', stageHistory: { 'In Dev': 16, 'Code Review': 10, 'Dev Done': 4, 'In QA': 6, 'QA Done': 2 } },
    ],
  },
]

// Initiatives / epics (Jira would derive these from epic children).
export const MOCK_EPICS = [
  { id: 'LO-2000', teamId: 'lo', name: 'Lender Onboarding Revamp', doneChildren: 6, totalChildren: 14, blockedChildren: 1 },
  { id: 'PAY-800', teamId: 'pay', name: 'ACH Reliability Hardening', doneChildren: 8, totalChildren: 10, blockedChildren: 0 },
  { id: 'UL-1000', teamId: 'uw', name: 'UWDE Risk Tier Migration', doneChildren: 3, totalChildren: 12, blockedChildren: 2 },
  { id: 'UL-1050', teamId: 'uw', name: 'Ping Tree Routing v2', doneChildren: 5, totalChildren: 8, blockedChildren: 0 },
  { id: 'ANA-300', teamId: 'analytics', name: 'Q2 Vintage Analytics Suite', doneChildren: 9, totalChildren: 11, blockedChildren: 0 },
  { id: 'INFRA-850', teamId: 'infra', name: 'Platform Hardening Q2', doneChildren: 4, totalChildren: 9, blockedChildren: 0 },
]

// Business KPI not present in Jira (Payments processor metric).
export const MOCK_KPI = { achSuccessRate: 98.4 }

/** Shape returned by every ingest source → consumed by buildSnapshot. */
export function getMockIngest() {
  return {
    source: 'mock',
    teams: structuredClone(MOCK_TEAMS),
    epics: structuredClone(MOCK_EPICS),
    kpi: { ...MOCK_KPI },
  }
}
