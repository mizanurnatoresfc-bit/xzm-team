import { Component, type ReactNode } from 'react'

/** One broken screen must not blank the whole app: show a plain message with a way back. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: unknown) { console.error(error) }
  render() {
    if (!this.state.failed) return this.props.children
    return <main className="crash"><div>
      <h1>এই পাতায় সমস্যা হয়েছে</h1>
      <p className="muted">আপনার সেভ করা তথ্য ঠিক আছে। পাতাটা আবার খুলুন; বারবার হলে অ্যাডমিনকে জানান।</p>
      <p style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => location.reload()}>আবার চেষ্টা করুন</button>
        <button className="secondary" onClick={() => { location.href = '/app' }}>হোমে যান</button></p>
    </div></main>
  }
}
