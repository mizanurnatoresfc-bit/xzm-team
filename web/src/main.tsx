import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { setupNativeApp } from './lib/native'
import { ErrorBoundary } from './components/ErrorBoundary'

setupNativeApp()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>,
)
