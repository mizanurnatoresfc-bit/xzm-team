import { useEffect, useState } from 'react'
import { loadNodiFeatures, subscribeNodiFeatures, type NodiFeatures } from './nodi'

/** Which নদী AI parts are switched on. null while loading: callers hide the part until it is known. */
export function useNodiFeatures(): NodiFeatures | null {
  const [f, setF] = useState<NodiFeatures | null>(null)
  useEffect(() => {
    let live = true
    void loadNodiFeatures().then(x => { if (live) setF(x) })
    const off = subscribeNodiFeatures(x => { if (live) setF(x) })
    return () => { live = false; off() }
  }, [])
  return f
}
