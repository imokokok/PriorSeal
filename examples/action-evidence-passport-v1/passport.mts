/**
 * Compatibility exports for the documented example. The formal implementation
 * is published from priorseal-sdk so applications and the browser share it.
 */
export {
  createActionEvidencePassport,
  parseActionEvidencePassport,
  summarizeActionEvidencePassport,
  verifyActionEvidencePassport,
} from '../../sdk/dist/action-evidence-passport.js'
export type {
  ActionEvidencePassport,
  ActionEvidencePassportSummary,
  ActionEvidencePassportVerification,
  ServicePaymentAttachment,
} from '../../sdk/dist/action-evidence-passport.js'
