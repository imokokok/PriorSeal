import { AppShell, Notice, PageHeader } from '../components'
import './base-lending-telegram.css'

export function TelegramScenarioMiniAppPage() {
  return <AppShell><div className="lending-mini-app" data-telegram-mini-app="true">
    <PageHeader eyebrow="INSIGHT × PRIORSEAL / TELEGRAM" title="Assessment review">The Telegram product is being rolled out in stages. The Polymarket market assessment is the only active user flow today.</PageHeader>
    <Notice tone="info" title="Other assessment reviews are not enabled">Base lending, Hyperliquid perps, and DEX swap will appear here after each scenario has a guided input form, account-aware usage limits, and an assessment-only response that contains no executable call or order envelope.</Notice>
    <section className="panel lending-form"><div className="lending-form-heading"><span className="exact-index">READ ONLY</span><h2>No wallet or transaction access</h2><p>Insight and PriorSeal will provide risk assessments and verifiable evidence. They will not connect to user wallets, request transaction signatures, create authorizations, submit orders, or relay user transactions through this Telegram product.</p></div></section>
  </div></AppShell>
}
