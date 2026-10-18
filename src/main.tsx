import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { initProvidersFile } from './lib/providerFile'
import { initTasksSync } from './lib/tasksSync'

// خواندن providers.json (قابل ویرایش دستی، به سبک OpenCode) در استارت
initProvidersFile()
// اتصال به سرویس کارهای پس‌زمینه/زمان‌بندی‌شدهٔ پروسهٔ اصلی
initTasksSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
