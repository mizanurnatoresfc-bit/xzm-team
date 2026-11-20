// পরিবর্তনের ইতিহাস — what changed on one office row, read from the audit log the database writes itself.
// Only people whose role may read the audit log (system.audit.view) see the button; the database enforces the same rule.
import { Modal, useLoad } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { access } from '../../lib/access'
import { office } from '../../lib/office'
import { opsFriendly } from '../../lib/officeOps'

const SKIP = new Set(['updated_at', 'updated_by', 'created_at', 'created_by'])
const show = (v: unknown) => v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)

export function HistoryModal({ table, id, name, onClose }: { table: string; id: string; name: string; onClose: () => void }) {
  const { L, lang } = usePrefs()
  const rows = useLoad(() => office.history(table, id), [table, id])
  const who = useLoad(() => access.people(), [])
  const when = (t: string) => new Date(t).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'short' })
  const act = (a: string, r: { old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null }) =>
    a === 'INSERT' ? L('যোগ হয়েছে', 'Added')
      : r.new_data?.archived_at && !r.old_data?.archived_at ? L('সরানো হয়েছে', 'Removed')
      : r.old_data?.archived_at && !r.new_data?.archived_at ? L('ফেরত আনা হয়েছে', 'Restored') : L('বদলানো হয়েছে', 'Changed')
  return <Modal wide title={`${L('পরিবর্তনের ইতিহাস', 'Change history')} — ${name}`} onClose={onClose}
    actions={<button className="secondary" onClick={onClose}>{L('বন্ধ', 'Close')}</button>}>
    {rows.error ? <p className="da-error">{opsFriendly(rows.error)}</p>
      : rows.loading ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>
      : !rows.data?.length ? <p className="muted">{L('কোনো পরিবর্তন লেখা নেই।', 'No changes recorded.')}</p>
      : <ul className="duty-list">{rows.data.map(r => {
        const fields = (r.changed_fields ?? []).filter(f => !SKIP.has(f))
        return <li key={r.id} className="duty" style={{ display: 'block' }}>
          <b>{act(r.action, r)}</b> <span className="muted small">· {when(r.occurred_at)} · {(r.actor_id && who.data?.[r.actor_id]) || L('সিস্টেম', 'system')}</span>
          {r.reason && <div className="small">{L('কারণ', 'Reason')}: {r.reason}</div>}
          {r.action === 'UPDATE' && fields.length > 0 && <div className="small">{fields.map(f =>
            <div key={f}><code>{f}</code>: <s className="muted">{show(r.old_data?.[f])}</s> → <b>{show(r.new_data?.[f])}</b></div>)}</div>}
        </li> })}</ul>}
  </Modal>
}
