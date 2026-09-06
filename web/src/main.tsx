import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './RootApp'
import './styles.css'
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
