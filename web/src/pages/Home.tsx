import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Icon } from '../components/Icon'
import { PublicTop } from '../components/PublicTop'
import { useBrandText } from '../components/Brand'
import { usePrefs } from '../lib/prefs'

/** Public home page shown before sign-in. */
export function Home() {
  const { session, loading } = useAuth()
  const { L } = usePrefs()
  const { name } = useBrandText()
  if (!loading && session) return <Navigate to="/app" replace />
  return <div className="nh">
    <PublicTop />
    <main>
      <section className="nh-hero" style={{ gridTemplateColumns: '1fr' }}>
        <div className="nh-hero-card" style={{ textAlign: 'center', alignItems: 'center', minHeight: '46vh' }}>
          <h1><span>XZM-Team</span></h1>
          <p className="nh-bn">{L('এখন লাইভ: নাটোর জোন', 'Now live: Natore Zone')}</p>
          <div className="nh-acts">
            <Link to="/staff/login" className="nh-btn"><Icon name="key" size={18} />{L('স্টাফ লগইন', 'Staff login')}</Link>
          </div>
        </div>
      </section>
    </main>
    <footer className="pub-foot">© {name} · <Link to="/terms">{L('শর্তাবলি', 'Terms')}</Link></footer>
  </div>
}
