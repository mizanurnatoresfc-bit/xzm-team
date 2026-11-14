import { useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { Badge, Modal, useLoad, useToast } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { dashboard, dashboardFriendly, PANELS, panelLabel, panelNote, type PanelCode, type RoleDashboard } from '../../lib/dashboard'

const isSuper = (grants: { is_super: boolean; scope_type: string }[]) => grants.some(g => g.is_super && g.scope_type === 'global')

/** Super Admin decides what each role sees on its home page. */
export function RoleDashboards() {
  const { grants } = useAuth()
  const { L, n, lang } = usePrefs()
  const sup = isSuper(grants)
  const list = useLoad(() => sup ? dashboard.roleLayouts() : Promise.resolve([]), [sup])
  const [edit, setEdit] = useState<RoleDashboard | null>(null)
  const { toast, node } = useToast()

  return <AppShell title={L('রোল অনুযায়ী ড্যাশবোর্ড', 'Dashboard by role')}
    subtitle={L('কোন রোল হোম পেজে কী দেখবে — এখানে ঠিক করুন। অনুমতি না থাকলে প্যানেল এমনিতেই লুকানো থাকবে।',
      'Decide what each role sees on the home page. A panel stays hidden anyway if the role has no permission for it.')}>
    {node}
    {!sup ? <p className="notice">{L('এই পাতা শুধু সুপার অ্যাডমিনের জন্য।', 'This page is for the Super Admin only.')}</p> : <>
      {list.error ? <p className="da-error">{dashboardFriendly(list.error)}</p> : null}
      <section className="panel">
        <div className="da-table-wrap"><table className="da-table">
          <thead><tr><th>{L('রোল', 'Role')}</th><th>{L('ইউজার', 'Users')}</th><th>{L('হোম পেজে যা দেখবে', 'What they see on the home page')}</th><th /></tr></thead>
          <tbody>{(list.data ?? []).map(r => <tr key={r.role_id}>
            <td><strong>{lang === 'bn' && r.name_bn ? r.name_bn : r.name}</strong>{r.is_super ? <> <Badge tone="bad">{L('সব ক্ষমতা', 'Full control')}</Badge></> : null}</td>
            <td>{n(r.user_count)}</td>
            <td className="small">{r.panels.length ? r.panels.map(p => panelLabel(p, lang)).join(' · ')
              : <span className="muted">{L('আলাদা করে কিছু বলা নেই — অনুমতি অনুযায়ী দেখাবে', 'Nothing set — follows their permissions')}</span>}</td>
            <td style={{ textAlign: 'right' }}><button className="secondary sm" onClick={() => setEdit(r)}>{L('বদলান', 'Change')}</button></td>
          </tr>)}</tbody></table></div>
        {list.loading && <p className="muted small">{L('লোড হচ্ছে…', 'Loading…')}</p>}
      </section>
      <section className="panel">
        <h2>{L('প্যানেলগুলো কী কী', 'What the panels are')}</h2>
        <ul className="muted small">{PANELS.map(([code]) => <li key={code}><strong>{panelLabel(code, lang)}</strong> — {panelNote(code, lang)}</li>)}</ul>
      </section>
    </>}
    {edit && <LayoutEditor role={edit} onClose={() => setEdit(null)}
      onDone={() => { setEdit(null); toast(L('ড্যাশবোর্ড সেভ হয়েছে', 'Dashboard saved')); void list.reload() }} />}
  </AppShell>
}

function LayoutEditor({ role, onClose, onDone }: { role: RoleDashboard; onClose: () => void; onDone: () => void }) {
  const { L, lang } = usePrefs()
  const [picked, setPicked] = useState<PanelCode[]>(role.panels)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const toggle = (p: PanelCode) => setPicked(x => x.includes(p) ? x.filter(y => y !== p) : [...x, p])
  const move = (p: PanelCode, d: -1 | 1) => {
    const i = picked.indexOf(p), j = i + d
    if (i < 0 || j < 0 || j >= picked.length) return
    const c = [...picked]; c.splice(i, 1); c.splice(j, 0, p); setPicked(c)
  }
  async function save() {
    setErr(''); setBusy(true)
    try { await dashboard.saveRoleLayout(role.role_id, picked); onDone() }
    catch (e) { setErr(dashboardFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal wide title={`${lang === 'bn' && role.name_bn ? role.name_bn : role.name} — ${L('হোম পেজ', 'home page')}`} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ করুন', 'Save')}</button></>}>
    <p className="muted small">{L('টিক দিলে প্যানেলটি এই রোলের হোম পেজে আসবে। উপরে-নিচে সাজিয়ে ক্রম ঠিক করুন। কিছুই টিক না দিলে অনুমতি অনুযায়ী আপনা-আপনি সাজবে।',
      'Tick a panel to put it on this role’s home page, and use the arrows for the order. Tick nothing and it arranges itself from their permissions.')}</p>
    <div className="da-table-wrap"><table className="da-table">
      <thead><tr><th>{L('দেখাবে', 'Show')}</th><th>{L('প্যানেল', 'Panel')}</th><th>{L('কী থাকে', 'What it holds')}</th><th>{L('ক্রম', 'Order')}</th></tr></thead>
      <tbody>{PANELS.map(([code]) => {
        const on = picked.includes(code)
        return <tr key={code}>
          <td><input type="checkbox" style={{ width: 'auto' }} aria-label={code} checked={on} onChange={() => toggle(code)} /></td>
          <td><strong>{panelLabel(code, lang)}</strong></td>
          <td className="small muted">{panelNote(code, lang)}</td>
          <td style={{ whiteSpace: 'nowrap' }}>{on && <>
            <button className="secondary sm" aria-label={`${code} up`} disabled={picked.indexOf(code) === 0} onClick={() => move(code, -1)}>↑</button>{' '}
            <button className="secondary sm" aria-label={`${code} down`} disabled={picked.indexOf(code) === picked.length - 1} onClick={() => move(code, 1)}>↓</button>
          </>}</td>
        </tr>
      })}</tbody></table></div>
    <p className="muted small">{L('এই রোলের ক্রম: ', 'Order for this role: ')}{picked.length ? picked.map(p => panelLabel(p, lang)).join(' → ') : L('—', '—')}</p>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}
