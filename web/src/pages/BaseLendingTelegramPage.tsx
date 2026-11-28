import { AppShell, Notice, PageHeader } from '../components'
import './base-lending-telegram.css'

export function BaseLendingTelegramPage() {
  return <AppShell><div className="lending-mini-app" data-telegram-mini-app="true">
    <PageHeader eyebrow="INSIGHT × PRIORSEAL / TELEGRAM" title="Base lending is being prepared">The lending experience will use a guided risk form with enough time to review. It will not ask you to paste transaction JSON or Unix timestamps.</PageHeader>
    <Notice tone="info" title="Not open for testing yet">The current lending assessment API signs decisions bound to exact call data. This product will reopen after the read-only assessment contract and account experience are ready.</Notice>
    <section className="panel lending-form"><div className="lending-form-heading"><span className="exact-index">ASSESSMENT ONLY</span><h2>No user action has been taken</h2><p>This page does not connect a wallet, request authorization or signatures, build transactions, or submit calls.</p></div></section>
  </div></AppShell>
}
