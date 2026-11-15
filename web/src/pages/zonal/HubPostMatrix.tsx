import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { useLoad } from '../accounts/ui'
import { hrFriendly } from '../../lib/hr'
import { manpower, type MatrixCell } from '../../lib/manpower'
import { download, xlsxBlob } from '../../lib/xlsx'

const bn = (x: number) => x ? x.toLocaleString('bn-BD') : '—'

/** Hub x designation headcount (active staff), with the open "লোক লাগবে" need beside each count. */
export function HubPostMatrix({ zone, onHub }: { zone: string | null; onHub?: (hubId: string) => void }) {
  const q = useLoad(() => manpower.matrix(zone), [zone])
  const m = useMemo(() => {
    const cells: MatrixCell[] = q.data ?? []
    type Post = { id: string; name: string; sort: number }
    const posts: Post[] = [...new Map<string, Post>(cells.map(c => [c.position_id ?? '-', { id: c.position_id ?? '-', name: c.position_name, sort: c.sort_order }])).values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
    const hubs: Array<[string, string]> = [...new Map<string, string>(cells.map(c => [c.hub_id, c.hub_name])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
    const at = new Map<string, MatrixCell>(cells.map(c => [`${c.hub_id}|${c.position_id ?? '-'}`, c]))
    return { posts, hubs, at }
  }, [q.data])
  const cell = (h: string, p: string) => m.at.get(`${h}|${p}`)
  const hubTotal = (h: string) => m.posts.reduce((a, p) => a + (cell(h, p.id)?.active ?? 0), 0)
  const hubNeed = (h: string) => m.posts.reduce((a, p) => a + (cell(h, p.id)?.needed ?? 0), 0)
  const postTotal = (p: string) => m.hubs.reduce((a, [h]) => a + (cell(h, p)?.active ?? 0), 0)
  const postNeed = (p: string) => m.hubs.reduce((a, [h]) => a + (cell(h, p)?.needed ?? 0), 0)
  function exportXlsx() {
    const heads = ['SL', 'Hub Name', ...m.posts.flatMap(p => [p.name, `${p.name} — লোক লাগবে`]), 'মোট সক্রিয়', 'মোট লোক লাগবে']
    const rows = m.hubs.map(([h, name], i) => [i + 1, name, ...m.posts.flatMap(p => [cell(h, p.id)?.active ?? 0, cell(h, p.id)?.needed ?? 0]), hubTotal(h), hubNeed(h)])
    rows.push(['', 'মোট', ...m.posts.flatMap(p => [postTotal(p.id), postNeed(p.id)]), m.hubs.reduce((a, [h]) => a + hubTotal(h), 0), m.hubs.reduce((a, [h]) => a + hubNeed(h), 0)])
    download(xlsxBlob('Hub wise designation', new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka' }), heads, rows), 'Hub-Designation.xlsx')
  }
  return <section className="panel">
    <div className="da-bar"><h2 style={{ margin: 0 }}>হাব অনুযায়ী কোন পদে কতজন</h2>
      <span className="row-acts"><Link to="/app/manpower" className="btn-ghost">লোক লাগবে →</Link>
        <button className="secondary sm" onClick={exportXlsx} disabled={!m.hubs.length}><Icon name="xls" size={14} />Excel</button></span></div>
    <p className="muted small">সংখ্যা = সক্রিয় কর্মী। লাল <b>+n</b> = অনুমোদিত “লোক লাগবে” চাহিদা, যা এখনো পূরণ হয়নি। হাবের নামে চাপলে সেই হাবের কর্মী তালিকা খোলে।</p>
    {q.error ? <p className="da-error">{hrFriendly(q.error)}</p> : q.loading && !q.data ? <p className="muted">লোড হচ্ছে…</p> :
      <div className="da-table-wrap"><table className="da-table hpm">
        <thead><tr><th>হাব</th>{m.posts.map(p => <th key={p.id}>{p.name}</th>)}<th>মোট</th></tr></thead>
        <tbody>{m.hubs.map(([h, name]) => <tr key={h}>
          <td>{onHub ? <button type="button" className="btn-ghost" style={{ padding: 0 }} onClick={() => onHub(h)}><b>{name}</b></button> : <b>{name}</b>}</td>
          {m.posts.map(p => { const c = cell(h, p.id); return <td key={p.id} className="num" title={c ? `সক্রিয় ${c.active} · নিষ্ক্রিয় ${c.inactive} · আইডির অপেক্ষায় ${c.applicant}` : ''}>
            {bn(c?.active ?? 0)}{c?.needed ? <span className="hpm-need"> +{c.needed.toLocaleString('bn-BD')}</span> : null}</td> })}
          <td className="num"><b>{bn(hubTotal(h))}</b>{hubNeed(h) ? <span className="hpm-need"> +{hubNeed(h).toLocaleString('bn-BD')}</span> : null}</td></tr>)}</tbody>
        <tfoot><tr><th>মোট</th>{m.posts.map(p => <th key={p.id} className="num">{bn(postTotal(p.id))}{postNeed(p.id) ? <span className="hpm-need"> +{postNeed(p.id).toLocaleString('bn-BD')}</span> : null}</th>)}
          <th className="num">{bn(m.hubs.reduce((a, [h]) => a + hubTotal(h), 0))}</th></tr></tfoot>
      </table></div>}
  </section>
}
