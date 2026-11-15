import { supabase } from './supabase'

/** Issues (follow-up) and the hub group. Every write goes through a database function. */
export type IssueKind = 'parcel' | 'vehicle' | 'staff' | 'cash' | 'other'
export type IssueStatus = 'open' | 'in_progress' | 'solved' | 'approved' | 'cancelled'
export type Priority = 'low' | 'normal' | 'high' | 'urgent'
export type IssueRow = {
  id: string; issue_no: string; title: string; kind: IssueKind; priority: Priority; status: IssueStatus; hub_id: string; hub: string | null
  parcel_ref: string | null; due_at: string | null; created_at: string; solved_at: string | null; reopen_count: number
  assigned_by_name: string | null; assigned_by_nodi: boolean; assignee: string | null; assignee_code: string | null
  is_mine: boolean; is_giver: boolean; overdue: boolean
}
export type Panels = { mine: IssueRow[]; to_check: IssueRow[]; given: IssueRow[]; waiting_for_check_of_mine: IssueRow[]; hub: IssueRow[] }
export type IssueEvent = { id: string; action: string; note: string | null; by_name: string | null; at: string }
export type IssueDetail = {
  issue: IssueRow & { body: string | null; photo_path: string | null; solve_photo: string | null; solved_note: string | null; approve_note: string | null; status_bn: string }
  events: IssueEvent[]; parcel: Record<string, unknown> | null
}
export type GroupHub = { hub_id: string; hub_name: string; hub_code: string; open_issues: number; unseen: number }
export type Post = {
  id: string; author_name: string; is_nodi: boolean; mine: boolean; kind: 'text' | 'issue' | 'nodi'; body: string | null; photo_path: string | null; created_at: string
  issue: { id: string; issue_no: string; title: string; status: IssueStatus; status_bn: string; assignee: string | null; parcel_ref: string | null; priority: Priority } | null
  reactions: Record<string, { n: number; mine: boolean }>; seen_count: number; seen_by_me: boolean
}
export type Who = { full_name: string; employee_code: string | null; seen_at?: string; at?: string; emoji?: string }

export const KIND_BN: Record<IssueKind, string> = { parcel: 'পার্সেল', vehicle: 'গাড়ি', staff: 'স্টাফ', cash: 'টাকা', other: 'অন্যান্য' }
export const PRIORITY_BN: Record<Priority, string> = { low: 'কম', normal: 'সাধারণ', high: 'জরুরি', urgent: 'অতি জরুরি' }
export const EMOJIS = ['👍', '❤️', '😮', '😢', '✅', '🙏']
export const ACTION_BN: Record<string, string> = {
  created: 'ইস্যু তৈরি', assigned: 'কাজ দেওয়া', assigned_by_nodi: 'নদী AI কাজ দিল', started: 'কাজ শুরু', solved: 'সমাধান জানানো',
  approved: 'অনুমোদন', reopened: 'আবার করতে বলা', cancelled: 'বাতিল',
}

function fail(error: { message: string } | null) { if (error) throw error }
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args); fail(error); return data as T
}

export const issues = {
  panels: () => rpc<Panels>('issue_panels'),
  detail: (id: string) => rpc<IssueDetail | null>('issue_detail', { p_id: id }),
  create: (x: { hub: string; title?: string; body?: string; kind?: IssueKind; parcel_ref?: string; photo?: string | null; assignee?: string | null; due?: string | null; priority?: Priority }) =>
    rpc<string>('issue_create', { p_hub: x.hub, p_title: x.title ?? null, p_body: x.body ?? null, p_kind: x.kind ?? 'parcel', p_parcel_ref: x.parcel_ref ?? null,
      p_photo: x.photo ?? null, p_assignee: x.assignee ?? null, p_due: x.due || null, p_priority: x.priority ?? 'normal' }),
  assign: (id: string, assignee: string, note?: string) => rpc<void>('issue_assign', { p_id: id, p_assignee: assignee, p_note: note ?? null }),
  act: (id: string, action: 'start' | 'solve' | 'approve' | 'reopen' | 'cancel', note?: string, photo?: string | null) =>
    rpc<void>('issue_act', { p_id: id, p_action: action, p_note: note ?? null, p_photo: photo ?? null }),
  groupHubs: () => rpc<GroupHub[]>('hub_group_hubs'),
  feed: (hub: string, before?: string | null) => rpc<Post[]>('hub_feed', { p_hub: hub, p_before: before ?? null, p_limit: 30 }),
  post: (hub: string, body: string, photo?: string | null) => rpc<string>('hub_post_create', { p_hub: hub, p_body: body, p_photo: photo ?? null }),
  react: (post: string, emoji: string) => rpc<boolean>('hub_post_react', { p_post: post, p_emoji: emoji }),
  markSeen: (ids: string[]) => rpc<number>('hub_posts_seen', { p_posts: ids }),
  seenBy: (post: string) => rpc<Who[]>('hub_post_seen_by', { p_post: post }),
  reactedBy: (post: string) => rpc<Who[]>('hub_post_reacted_by', { p_post: post }),
  /** Upload a picture to the private bucket; the first folder is the hub (the database checks the hub group). */
  uploadPhoto: async (hub: string, file: File) => {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const path = `${hub}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('issue-photos').upload(path, file, { contentType: file.type || undefined, upsert: false }); fail(error as { message: string } | null)
    return path
  },
  photoUrl: async (path: string) => {
    const { data, error } = await supabase.storage.from('issue-photos').createSignedUrl(path, 300); fail(error as { message: string } | null); return data!.signedUrl
  },
}
