/**
 * ONE HAND MY ZONE — pure planning helpers.
 * No database writes, automatic approvals or finance postings.
 * Callers must scope hub/zone data through existing RLS-protected APIs.
 */
export type MetricOrigin = 'actual' | 'estimated' | 'missing'
export type HubMetricKey = 'inbound' | 'delivery' | 'merchantReturn' | 'pickup' | 'returnRate'

export interface HubBaseline {
  hubId: string
  effectiveFrom: string
  effectiveTo?: string | null
  targets: Partial<Record<HubMetricKey, number>>
}

export interface HubDailyActual {
  hubId: string
  date: string
  values: Partial<Record<HubMetricKey, number>>
}

export interface MetricComparison {
  metric: HubMetricKey
  baseline: number | null
  actual: number | null
  origin: MetricOrigin
  variance: number | null
  achievementPct: number | null
}

const METRICS: HubMetricKey[] = ['inbound', 'delivery', 'merchantReturn', 'pickup', 'returnRate']

function validNumber(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** Latest effective baseline only; never silently mix targets from different versions. */
export function selectBaseline(hubId: string, date: string, baselines: readonly HubBaseline[]): HubBaseline | null {
  return baselines
    .filter(b => b.hubId === hubId && b.effectiveFrom <= date && (!b.effectiveTo || date <= b.effectiveTo))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null
}

/**
 * Estimate only from prior actual observations, never from other estimates.
 * An estimated metric is for operational visibility only, NOT payroll, cash or attendance.
 */
export function compareHubDay(
  hubId: string,
  date: string,
  baselines: readonly HubBaseline[],
  reports: readonly HubDailyActual[],
  estimateMissing = false,
): MetricComparison[] {
  const baseline = selectBaseline(hubId, date, baselines)
  const current = reports.find(r => r.hubId === hubId && r.date === date)
  const history = reports
    .filter(r => r.hubId === hubId && r.date < date)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7)
  return METRICS.map(metric => {
    const target = validNumber(baseline?.targets[metric])
    const observed = validNumber(current?.values[metric])
    const historical = history.map(r => validNumber(r.values[metric])).filter((v): v is number => v !== null)
    const estimate = estimateMissing && historical.length
      ? historical.reduce((sum, v) => sum + v, 0) / historical.length : null
    const value = observed ?? (current ? null : estimate)
    const origin: MetricOrigin = observed !== null ? 'actual' : value !== null ? 'estimated' : 'missing'
    return {
      metric,
      baseline: target,
      actual: value,
      origin,
      variance: target !== null && value !== null ? value - target : null,
      achievementPct: target !== null && target > 0 && value !== null ? value / target * 100 : null,
    }
  })
}

export interface RiderCandidate {
  employeeId: string
  hubId: string
  available: boolean
  routeIds: readonly string[]
  capacity: number
  assignedParcels: number
}

/** 
 * Read-only allocation preview. The caller must supply candidates already authorized
 * by existing zone/hub RLS. Passing hubId additionally prevents cross-hub suggestions.
 * Each suggested parcel is counted once across the ranked riders.
 * A manager must approve any real assignment through the existing workflow.
 */
export function suggestRiders(
  routeId: string,
  requiredParcels: number,
  candidates: readonly RiderCandidate[],
  hubId?: string,
) {
  if (!routeId || !Number.isFinite(requiredParcels) || requiredParcels <= 0) return []
  const ranked = candidates
    .filter(r => r.available && (!hubId || r.hubId === hubId)
      && Number.isFinite(r.capacity) && r.capacity >= 0
      && Number.isFinite(r.assignedParcels) && r.assignedParcels >= 0)
    .map(r => ({
      employeeId: r.employeeId,
      hubId: r.hubId,
      familiar: r.routeIds.includes(routeId),
      freeCapacity: Math.max(0, r.capacity - r.assignedParcels),
    }))
    .filter(r => r.freeCapacity > 0)
    .sort((a, b) => Number(b.familiar) - Number(a.familiar)
      || b.freeCapacity - a.freeCapacity || a.employeeId.localeCompare(b.employeeId))
  let remaining = Math.floor(requiredParcels)
  return ranked.map(r => {
    const suggestedParcels = Math.min(remaining, Math.floor(r.freeCapacity))
    remaining -= suggestedParcels
    return { ...r, suggestedParcels }
  }).filter(r => r.suggestedParcels > 0)
}
