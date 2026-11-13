import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { setupNativeApp } from './lib/native'

setupNativeApp()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
)
