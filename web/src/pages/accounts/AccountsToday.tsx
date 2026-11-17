import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { da, todayDhaka } from '../../lib/dailyAccounts'
import { pageAllowed, panelLevel } from '../../lib/menu'
import { AccountsShell } from './ui'

/**
 * "আজকের হিসাব" — the one door to today's accounts (owner, 17 Nov 2026). It opens the right page by itself:
 *  - zonal manager / Super Admin (several hubs): every hub's sheet today (/app/accounts/daily)
 *  - hub manager (one hub): that hub's sheet today, straight in; the list (with "শুরু করুন") when none is started yet
 *  - staff who write accounts: their own khata (/app/accounts/khata)
 *  - everyone else: their own accounts (/app/accounts/mine)
 * A page the person's role is not given (role page list) is skipped for the next one.
 */
export function AccountsToday() {
  const { can, group, menu } = useAuth()
  const [to, setTo] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const ok = (p: string) => pageAllowed(menu, p)
    const pick = async (): Promise<string> => {
      const level = panelLevel(can, group)
      const seesHubs = can('da.sheet.view') || can('da.sheet.approve')
      if (seesHubs && level >= 1 && ok('/app/accounts/daily')) {
        const hubs = await da.myHubs().catch(() => [])
        const mine = hubs.filter(h => h.can_view)
        if (mine.length === 1) {
          const d = todayDhaka()
          const rows = await da.list(d, d, mine[0].hub_id).catch(() => [])
          if (rows.length) return `/app/accounts/daily/${rows[0].id}`
        }
        return '/app/accounts/daily'
      }
      if (can('da.sheet.create') && ok('/app/accounts/khata')) return '/app/accounts/khata'
      return '/app/accounts/mine'
    }
    void pick().then(p => { if (alive) setTo(p) })
    return () => { alive = false }
  }, [can, group, menu])
  if (to) return <Navigate to={to} replace />
  return <AccountsShell title="আজকের হিসাব"><p className="muted">আপনার আজকের হিসাব খোলা হচ্ছে…</p></AccountsShell>
}
