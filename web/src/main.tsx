import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { setupNativeApp } from './lib/native'
import { setupKeyboard } from './lib/nativeFeel'
import { startBanglaText } from './lib/bnText'
import { ErrorBoundary } from './components/ErrorBoundary'

// Let the app open with no internet (public/sw.js). Only in the built site; a failure to register never matters to the app.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => undefined) })
}

setupNativeApp()
setupKeyboard()
startBanglaText()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>,
)
