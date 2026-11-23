import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { setupNativeApp } from './lib/native'
import { setupKeyboard } from './lib/nativeFeel'
import { startBanglaText } from './lib/bnText'
import { ErrorBoundary } from './components/ErrorBoundary'

setupNativeApp()
setupKeyboard()
startBanglaText()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>,
)
