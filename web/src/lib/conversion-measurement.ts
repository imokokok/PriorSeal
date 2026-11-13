export type ConversionEvent = 'choose_path' | 'flagship_workflow' | 'new_verified_action' | 'verification_completed'

/**
 * Sends one bounded, cookieless first-party product signal. This deliberately
 * carries no visitor, wallet, receipt, route, referrer, or outcome value.
 */
export function trackConversion(event: ConversionEvent) {
  if (navigator.doNotTrack === '1' || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return
  void fetch('/v1/experience-events', {
    method: 'POST',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event }),
  }).catch(() => {
    // Product measurement must never interrupt the action a visitor chose.
  })
}
