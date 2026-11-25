// The company's "New Admin & Rider ID Creat Information" sheet, filled from the staff records.
// The layout lives with the other company sheets (HR requests → কোম্পানি শিট), so when the company
// changes its columns it is changed there, not in code. The layout below is only the fallback for
// a database that has no such sheet yet.
import { buildSheet, companySheets, downloadSheet, type CompanySheet, type SheetCol } from './companySheet'
import { customFields } from './staffAdmin'

const B = 'blank'
export const ID_CREATE_COLUMNS: SheetCol[] = [
  { head: 'SL', src: 'sl', w: 7.4 }, { head: 'Name', src: 'emp:full_name', w: 17.6 }, { head: 'Phone Number', src: 'emp:mobile', w: 26.7 },
  { head: 'Alternative Phone Number', src: 'emp:cf:alt_mobile|emp:emergency_contact_phone', w: 29.9 }, { head: 'Hub Name', src: 'emp:hub_name' },
  { head: 'Designation', src: 'emp:position_name' }, { head: 'Gmail Only for Admin', src: 'emp:email', w: 24.4 }, { head: 'Blood Group', src: 'emp:cf:blood_group' },
  { head: 'Date Of Birth', src: 'emp:date_of_birth' }, { head: 'Permament Address', src: 'emp:permanent_address|emp:present_address', w: 20.7 },
  { head: 'Raferance Name & ID', src: 'ref', w: 21.4 }, { head: 'NID/ Birth Certificate Number', src: 'emp:nid_number', w: 25.6 },
  { head: 'Employee Picture', src: 'doc:photo', w: 21.3 }, { head: 'NID Front Picture', src: 'doc:nid_front', w: 19.7 }, { head: 'NID Back Picture', src: 'doc:nid_back', w: 23.7 },
  { head: 'Birth Certificate Picture', src: 'doc:birth_certificate', w: 25 },
  { head: 'Basic', src: 'emp:basic_salary' }, { head: 'Phn bill', src: B }, { head: 'Conveyance', src: 'emp:transport_allowance' }, { head: 'Commission', src: 'emp:commission' },
  { head: 'Pick & Drop', src: B }, { head: 'Return', src: B }, { head: 'Weight Bonus', src: B, w: 18.7 }, { head: 'Entry Com.', src: B }, { head: 'Reason', src: B }, { head: 'Remarks', src: B }]
type Layout = Pick<CompanySheet, 'name' | 'source' | 'kind' | 'format_id' | 'title' | 'title_at' | 'columns' | 'file_name'>
const FALLBACK: Layout = { name: 'New Admin & Rider ID Creat Information', source: 'staff', kind: null, format_id: null,
  title: 'New Admin & Rider ID Creat Format', title_at: null, columns: ID_CREATE_COLUMNS, file_name: 'New-Admin-Rider-ID-Creat-Information.xlsx' }

/** Builds and downloads the sheet for the staff the signed-in person may see (optionally one zone / hub / status / search). Returns how many rows. */
export async function downloadIdCreateFile(o: { zone?: string | null; hub?: string | null; status?: string | null; q?: string | null } = {}): Promise<number> {
  const [sheets, custom] = await Promise.all([companySheets.list().catch(() => [] as CompanySheet[]), customFields()])
  const staff = sheets.filter(s => s.source === 'staff')
  const layout: Layout = staff.find(s => /creat/i.test(s.name)) ?? staff[0] ?? FALLBACK
  const built = await buildSheet(layout, { zone: o.zone, hub: o.hub, status: o.status, q: o.q, custom })
  if (!built.rows.length) return 0
  downloadSheet(layout, built.rows.map(r => r.cells))
  return built.rows.length
}
