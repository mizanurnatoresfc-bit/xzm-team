// The route module's list of parts ("panes"). ONE page — /app/routes — shows them as tabs; adding a feature = adding an entry here and
// binding its component in pages/routes/panes.tsx (docs/ROUTE_MODULE.md walks through it). Pure file: tests/routeModule.test.mjs runs it.
import { ROUTE_OLD_PAGES, ROUTE_PAGE, ROUTE_PERMS } from './routeAccess.ts'

/** What a pane works on: `zone` = the zone's routes (needs a zone the person may see), `hub` = one hub, `center` = one sorting centre, `none` = nothing loaded first. */
export type PaneNeeds = 'zone' | 'hub' | 'center' | 'none'
export type PaneGroup = 'routes' | 'places' | 'plan' | 'watch' | 'setup'
export type RoutePane = {
  /** the `?tab=` value; keep it stable — old links and saved bookmarks use it */
  id: string
  icon: string; bn: string; en: string
  hint?: { bn: string; en: string }
  group: PaneGroup
  needs: PaneNeeds
  /** holding any one opens it; the database checks again */
  perms: readonly string[]
  /** the old pages this part used to live on: a role whose page list names one of them (or the module itself) keeps this part */
  legacy: readonly string[]
  /** a sidebar shortcut straight to this part (the rest are reached from the tabs inside the module) */
  menu?: boolean
  /** shown only to someone who has no zone-level parts (a hub manager): the zone map already does this for everyone else */
  onlyWithoutZone?: boolean
  /** the zone panes that also need a flag of the loaded overview (e.g. may see check-ins) */
  flag?: 'visits'
}

export const PANE_GROUPS: Record<PaneGroup, { bn: string; en: string; icon: string }> = {
  routes: { bn: 'রুট', en: 'Routes', icon: 'map' },
  places: { bn: 'এলাকা ও লোকেশন', en: 'Areas & locations', icon: 'hub' },
  plan: { bn: 'পরিকল্পনা', en: 'Planning', icon: 'box' },
  watch: { bn: 'নজরদারি', en: 'Watching', icon: 'check' },
  setup: { bn: 'সেটিং', en: 'Settings', icon: 'gear' },
}

const ZONE_PAGES = ['/app/zonal/routes'] as const
/** In declared order = tab order. */
export const ROUTE_PANES: readonly RoutePane[] = [
  { id: 'map', icon: 'map', bn: 'ম্যাপ', en: 'Map', hint: { bn: 'জোনের সব হাবের রাইডার রুট আসল ম্যাপে', en: "Every hub's rider routes on a real map" },
    group: 'routes', needs: 'zone', perms: ROUTE_PERMS.zone, legacy: ZONE_PAGES },
  { id: 'routes', icon: 'table', bn: 'রুট তালিকা', en: 'Route list', hint: { bn: 'সব রুট তালিকায় — এক্সেল ও প্রিন্ট', en: 'All routes as a table — Excel and print' },
    group: 'routes', needs: 'zone', perms: ROUTE_PERMS.zone, legacy: ZONE_PAGES },
  { id: 'hub', icon: 'truck', bn: 'হাবের রুট', en: 'Hub routes', hint: { bn: 'এলাকার নাম দিয়ে রুট বানান ও রাইডারদের রুট দিন', en: 'Make routes from area names and give riders their route' },
    group: 'routes', needs: 'hub', perms: ROUTE_PERMS.hub, legacy: ['/app/hub/routes'], onlyWithoutZone: true },
  { id: 'sorting', icon: 'box', bn: 'সোর্টিং → হাব', en: 'Sorting → hubs', hint: { bn: 'সোর্টিং সেন্টার থেকে হাবে যাওয়ার গাড়ির রুট', en: 'Vehicle routes from the sorting centre to the hubs' },
    group: 'routes', needs: 'center', perms: ROUTE_PERMS.sorting, legacy: ['/app/sorting/routes'], menu: true },
  { id: 'locations', icon: 'pin', bn: 'লোকেশন যোগ', en: 'Add locations', hint: { bn: 'লোকেশন ছাড়া স্টপ ঠিক করুন, নতুন জায়গা যোগ করুন, ফাইল থেকে অনেক একসাথে', en: 'Fix stops without a location, add new places, many at once from a file' },
    group: 'places', needs: 'zone', perms: ROUTE_PERMS.zone, legacy: ZONE_PAGES, menu: true },
  { id: 'places', icon: 'hub', bn: 'এলাকা ও সাজেশন', en: 'Areas & suggestions', hint: { bn: 'উপজেলা ধরে গ্রাম-বাজারের নাম আর রুট সাজেশন', en: 'Villages and markets by upazila, with route suggestions' },
    group: 'places', needs: 'zone', perms: ROUTE_PERMS.zone, legacy: ZONE_PAGES },
  { id: 'cover', icon: 'check', bn: 'কাভারেজ', en: 'Coverage', hint: { bn: 'কোন এলাকা এখনো কোনো রুটে নেই', en: 'Which places are on no route yet' },
    group: 'places', needs: 'zone', perms: ROUTE_PERMS.zone, legacy: ZONE_PAGES },
  { id: 'plan', icon: 'box', bn: 'আজকের পরিকল্পনা', en: "Today's plan", hint: { bn: 'আজ কোন রাইডার কোন রুটে কয়টা পার্সেল নেবেন', en: 'Who takes how many parcels on which route today' },
    group: 'plan', needs: 'none', perms: ROUTE_PERMS.plan, legacy: ['/app/routes/plan', ...ZONE_PAGES], menu: true },
  { id: 'pdfs', icon: 'upload', bn: 'হাব ও রাইডার PDF', en: 'Hub & rider PDFs',
    group: 'plan', needs: 'zone', perms: ROUTE_PERMS.zone, legacy: ZONE_PAGES },
  { id: 'morning', icon: 'users', bn: 'সকালের রুট হাজিরা', en: 'Morning route attendance',
    group: 'plan', needs: 'zone', perms: ['ops.route_plan.approve'], legacy: ['/app/routes/plan', ...ZONE_PAGES] },
  { id: 'load', icon: 'chart', bn: 'পার্সেল ও পরামর্শ', en: 'Parcels & suggestions', hint: { bn: 'রুটে পার্সেল কত, রাইডার কয়জন লাগে', en: 'Parcels per route and riders needed' },
    group: 'plan', needs: 'zone', perms: ROUTE_PERMS.zone, legacy: ZONE_PAGES },
  { id: 'day', icon: 'check', bn: 'চেক-ইন', en: 'Check-ins', hint: { bn: 'কোন রাইডার কোন স্টপে পৌঁছালেন', en: 'Which rider reached which stop' },
    group: 'watch', needs: 'zone', perms: ROUTE_PERMS.visits, legacy: ZONE_PAGES, flag: 'visits' },
  { id: 'warn', icon: 'alert', bn: 'সতর্কতা', en: 'Warnings', hint: { bn: 'যা ঠিক করা দরকার', en: 'What needs fixing' },
    group: 'watch', needs: 'zone', perms: ROUTE_PERMS.zone, legacy: ZONE_PAGES },
  { id: 'rules', icon: 'gear', bn: 'জোনের নিয়ম', en: 'Zone rules', hint: { bn: 'স্টপ, রাইডার, গতি, চেক-ইনের নিয়ম', en: 'Stops, riders, speed and check-in rules' },
    group: 'setup', needs: 'zone', perms: ROUTE_PERMS.zone, legacy: ZONE_PAGES },
]

/** The sidebar shortcuts into the module (the first row, "রুট", opens the module itself). The menu builds its rows from this, so a new `menu: true` pane shows up there by itself. */
export const ROUTE_MENU_PANES = ROUTE_PANES.filter(p => p.menu)
export const paneLink = (id: string) => id === 'map' ? ROUTE_PAGE : `${ROUTE_PAGE}?tab=${id}`
/** Where an old route address goes now (the query it had is kept by the redirect). */
export const routeRedirect = (oldPath: string): string | null => {
  const id = ROUTE_OLD_PAGES[oldPath.replace(/\/+$/, '')]
  return id ? paneLink(id) : null
}

export type PaneAccess = { can: (permission: string) => boolean; menu: string[] | null
  /** does the person have any zone to look at (route_zones returned something)? */ hasZone: boolean
  /** the loaded zone overview says check-ins may be read */ visits?: boolean }
/**
 * The parts this person may use, in tab order.
 * A part shows when the person holds one of its permissions AND their role's page list allows it (no list = allowed; the module page or a page the
 * part used to live on in the list = allowed), AND the thing it works on exists (a zone for zone parts).
 */
export function panesFor(a: PaneAccess): RoutePane[] {
  const bare = (x: string) => x.split('?')[0].replace(/\/+$/, '')
  const listed = (p: RoutePane) => a.menu === null || a.menu.some(m => bare(m) === ROUTE_PAGE || p.legacy.includes(bare(m)))
  const zonePanes = ROUTE_PANES.filter(p => p.needs === 'zone')
  const anyZone = a.hasZone && zonePanes.some(p => p.perms.some(a.can) && listed(p))
  return ROUTE_PANES.filter(p => p.perms.some(a.can) && listed(p)
    && (p.needs !== 'zone' || a.hasZone) && (!p.flag || a.visits !== false) && (!p.onlyWithoutZone || !anyZone))
}
/** The tab to open: the one asked for if it is allowed, else the first allowed one. */
export const pickPane = (panes: readonly RoutePane[], want: string | null): RoutePane | undefined => panes.find(p => p.id === want) ?? panes[0]
