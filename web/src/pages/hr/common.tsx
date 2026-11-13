import { useMemo } from 'react'
import { Badge, useLoad } from '../accounts/ui'
import { EMP_STATUS, nameMap, org, type EmployeeStatus } from '../../lib/hr'

/** Hubs, zones, departments and positions the user can see, plus id -> name maps. */
export function useOrg() {
  const q = useLoad(async () => {
    const [zones, hubs, departments, positions] = await Promise.all([org.zones(), org.hubs(), org.departments(), org.positions()])
    return { zones, hubs, departments, positions }
  }, [])
  const names = useMemo(() => ({ zone: nameMap(q.data?.zones), hub: nameMap(q.data?.hubs), dept: nameMap(q.data?.departments), pos: nameMap(q.data?.positions) }), [q.data])
  return { ...q, names }
}

export function EmpBadge({ status }: { status: EmployeeStatus }) {
  const [label, tone] = EMP_STATUS[status] ?? [status, 'neutral']
  return <Badge tone={tone}>{label}</Badge>
}

export const BD_MOBILE = /^01[3-9][0-9]{8}$/
