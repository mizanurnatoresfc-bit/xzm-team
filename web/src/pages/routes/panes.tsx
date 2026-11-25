// Binds each part of the route module (the list in lib/routeModule.ts) to the component that shows it.
// To add a part: (1) add its entry to ROUTE_PANES, (2) write its view in views.tsx, (3) name it here. Nothing else needs to change —
// the tab bar, the menu shortcut, the permission check and the page-list rules all read ROUTE_PANES.
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { Finding } from '../../lib/routeChecks'
import type { NewDraft } from './RouteEditor'
import type { RouteHub, ZoneOverview, ZoneRoute } from '../../lib/routes'

/** What the page gives every part. `o` is null only while the zone is loading or the person has no zone — a zone part is not shown then. */
export type PaneCtx = {
  zone: string; hub: string; setHub: (h: string) => void
  o: ZoneOverview | null; hubOf: Record<string, RouteHub>
  /** the zone's routes, narrowed to the picked hub */
  routes: ZoneRoute[]
  sel: string | null; setSel: (id: string | null) => void
  canEdit: (hubId: string) => boolean; canArchive: (hubId: string) => boolean
  findings: Finding[]
  edit: (r: ZoneRoute | NewDraft) => void; riders: (r: ZoneRoute) => void; archive: (r: ZoneRoute) => void
  reload: () => Promise<void>; toast: (m: string) => void
  /** open another part (and optionally pick a hub / a route there) */
  go: (tab: string, patch?: { hub?: string; route?: string | null }) => void
}
export type PaneView = ComponentType<{ c: PaneCtx }>
type ViewName = Exclude<keyof typeof import('./views'), never>
const view = (name: ViewName): LazyExoticComponent<PaneView> => lazy(() => import('./views').then(m => ({ default: m[name] as PaneView })))

/** id (as in ROUTE_PANES) → view. tests/routeModule.test.mjs checks the two lists name the same parts. */
export const PANE_VIEWS: Record<string, LazyExoticComponent<PaneView>> = {
  map: view('MapView'),
  routes: view('RoutesView'),
  hub: view('HubView'),
  sorting: view('SortingView'),
  locations: view('LocationsView'),
  places: view('PlacesView'),
  cover: view('CoverView'),
  plan: view('PlanView'),
  load: view('LoadView'),
  day: view('DayPane'),
  warn: view('WarnView'),
  rules: view('RulesView'),
}
