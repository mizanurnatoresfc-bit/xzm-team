// The signed-in person's own photo (their newest employee "photo" document) as a short-lived link, cached for 50 minutes.
// After the person puts up a new photo, refreshMyPhoto() makes every avatar on screen load it again.
import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from './supabase'

let photoCache: { user: string; at: number; p: Promise<string | null> } | null = null
const listeners = new Set<() => void>()

export function myPhoto(user: string): Promise<string | null> {
  if (photoCache && photoCache.user === user && Date.now() - photoCache.at < 3_000_000) return photoCache.p
  const p = (async () => {
    const { data: emp } = await supabase.rpc('my_employee_id')
    if (!emp) return null
    const { data } = await supabase.from('employee_documents').select('storage_path').eq('employee_id', emp as string).eq('doc_type', 'photo')
      .is('archived_at', null).order('created_at', { ascending: false }).limit(1)
    const path = (data?.[0] as { storage_path?: string } | undefined)?.storage_path
    if (!path) return null
    const { data: url } = await supabase.storage.from('employee-docs').createSignedUrl(path, 3600)
    return url?.signedUrl ?? null
  })().catch(() => null)
  photoCache = { user, at: Date.now(), p }; return p
}

/** Forget the cached photo and tell every avatar on screen to load it again. */
export function refreshMyPhoto() { photoCache = null; listeners.forEach(f => f()) }

/** Call `f` whenever the person's photo changes. Returns the unsubscribe function. */
export function onMyPhotoChange(f: () => void) { listeners.add(f); return () => { listeners.delete(f) } }

/** The signed-in person's photo URL: undefined while loading, null when there is none. */
export function useMyPhoto(): string | null | undefined {
  const { session } = useAuth()
  const user = session?.user.id ?? ''
  const [p, setP] = useState<string | null | undefined>(undefined)
  const [tick, setTick] = useState(0)
  useEffect(() => onMyPhotoChange(() => setTick(t => t + 1)), [])
  useEffect(() => { let live = true; if (user) void myPhoto(user).then(x => { if (live) setP(x) }); return () => { live = false } }, [user, tick])
  return p
}
