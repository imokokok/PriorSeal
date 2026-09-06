import * as asn1js from 'asn1js';
import { AlgorithmIdentifier, Certificate, CryptoEngine, MessageImprint, PKIStatus, SignedData, TSTInfo, TimeStampReq, TimeStampResp, setEngine } from 'pkijs';

export const RFC3161_POLICY_SCHEMA = 'priorseal.timestamp-policy.v1';
export const RFC3161_EVIDENCE_SCHEMA = 'priorseal.rfc3161-evidence.v1';
export const DIGICERT_RFC3161_PROFILE = 'digicert-rfc3161-v1';
export const DIGICERT_RFC3161_URL = 'http://timestamp.digicert.com';
export const DIGICERT_POLICY_OID = '2.16.840.1.114412.7.1';

const SHA256_OID = '2.16.840.1.101.3.4.2.1';
const TIMESTAMPING_EKU_OID = '1.3.6.1.5.5.7.3.8';
const TRUSTED_ROOTS = [
  {
    fingerprint: '3e9099b5015e8f486c00bcea9d111ee721faba355a89bcf1df69561e3dc6325c',
    der: 'MIIDtzCCAp+gAwIBAgIQDOfg5RfYRv6P5WD8G/AwOTANBgkqhkiG9w0BAQUFADBlMQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3d3cuZGlnaWNlcnQuY29tMSQwIgYDVQQDExtEaWdpQ2VydCBBc3N1cmVkIElEIFJvb3QgQ0EwHhcNMDYxMTEwMDAwMDAwWhcNMzExMTEwMDAwMDAwWjBlMQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3d3cuZGlnaWNlcnQuY29tMSQwIgYDVQQDExtEaWdpQ2VydCBBc3N1cmVkIElEIFJvb3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCtDhXO5EOAXLGH87dg+XESpa7cJpSIqvTO9SA5KFhgDPiA2qkVlTJhPLWxKISKityfCgyDF3qPkKyK53lTXDGEKvYPmDI2dsze3Tyoou9q+yHyUmHfnyDXH+Kx2f4YZNISW1/5WBg1vEfNoTb5a3/UsDg+wRvDjDPZ2C8Y/igPs6eD1sNuRMBhNZYW/lmci3Zt1/GiSw0r/wty2p5g0I6QNcZ4VYcgoc/lbQrISXwxmDNsIumH0DJaoroTghHtORedmTpyoeb6pNnVFzF1roV9Iq4/AUaG9ih5yLHa5FcXxH4cDrC0kqZWs72yl+2qp/C3xag/lRbQ/6GW6whfGHdPAgMBAAGjYzBhMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBRF66Kv9JLLgjEtUYunpyGd823IDzAfBgNVHSMEGDAWgBRF66Kv9JLLgjEtUYunpyGd823IDzANBgkqhkiG9w0BAQUFAAOCAQEAog683+Lt8ONyc3pklL/3cmbYMuRCdWKuh+vy1dneVrOfzM4UKLkNl2BcEkxY5NM9g0lFWJc1aRqoR+pWxnmrEthngYTffwk8lOa4JiwgvT2zKIn3X/8i4peEH+ll74fg38FnSbNd67IJKusm7Xi+fT8r87cmNW1fiQG2SVufAQWbqz0lwcy2f8Lxb4bG+mRo64EtlOtCt/qMHt1i8b5QZ7dsvfPxH2sMNgcWfzd8qVttevESRmCD1ycEvkvOl77DZypoEd+A5wwzZr8TDRRu838fYxAe+o0bJW1sj6W3YQGx0qMmoRBxna3iw/nDmVG3KwcIzi7mULKn+gpFL6Lw8g==',
  },
  {
    fingerprint: '552f7bdcf1a7af9e6ce672017f4f12abf77240c78e761ac203d1d9d20ac89988',
    der: 'MIIFkDCCA3igAwIBAgIQBZsbV56OITLiOQe9p3d1XDANBgkqhkiG9w0BAQwFADBiMQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3d3cuZGlnaWNlcnQuY29tMSEwHwYDVQQDExhEaWdpQ2VydCBUcnVzdGVkIFJvb3QgRzQwHhcNMTMwODAxMTIwMDAwWhcNMzgwMTE1MTIwMDAwWjBiMQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3d3cuZGlnaWNlcnQuY29tMSEwHwYDVQQDExhEaWdpQ2VydCBUcnVzdGVkIFJvb3QgRzQwggIiMA0GCSqGSIb3DQEBAQUAA4ICDwAwggIKAoICAQC/5pBzaN675F1KPDAiMGkz7MKnJS7JIT3yithZwuEppz1Yq3aaza57G4QNxDAf8xukOBbrVsaXbR2rsnnyyhHS5F/WBTxSD1Ifxp4VpX6+n6lXFllVcq9ok3DCsrp1mWpzMpTREEQQLt+C8weE5nQ7bXHiLQwb7iDVySAdYyktzuxeTsiT+CFhmzTrBcZe7FsavOvJz82sNEBfsXpm7nfISKhmV1efVFiODCu3T6cw2Vbuyntd463JT17lNecxy9qTXtyOj4DatpGYQJB5w3jHtrHEtWoYOAMQjdjUN6QuBX2I9YI+EJFwq1WCQTLX2wRzKm6RAXwhTNS8rhsDdV14Ztk6MUSaM0C/CNdaSaTC5qmgZ92kJ7yhTzm1EVgX9yRcRo9k98FpiHaYdj1ZXUJ2h4mXaXpI8OCiEhtmmnTK3kse5w5jrubU75KSOp493ADkRSWJtppEGSt+wJS00mFt6zPZxd9LBADMfRyVw4/3IbKyEbe7f/LVjHAsQWCqsWMYRJUadmJ+9oCw++hkpjPRiQfhvbfmQ6QYuKZ3AeEPlAwhHbJUKSWJbOUOUlFHdL4mrLZBdd56rF+NP8m800ERElvlEFDrMcXKchYiCd98THU/Y+whX8QgUWtvsauGi0/C1kVfnSD8oR7FwI+isX4KJpn15GkvmB0t9dmpsh3lGwIDAQABo0IwQDAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAdBgNVHQ4EFgQU7NfjgtJxXWRM3y5nP+e6mK4cD08wDQYJKoZIhvcNAQEMBQADggIBALth2X2pbL4XxJEbw6GiAI3jZGgPVs93rnD5/ZpKmbnJeFwMDF/k5hQpVgs2SV1EY+CtnJYYZhsjDT156W1r1lT40jzBQ0CuHVD1UvyQO7uYmWlrx8GnqGikJ9yd+SeuMIW59mdNOj6PWTkiU0TryF0Dyu1Qen1iIQqAyHNm0aAFYF/opbSnr6j3bTWcfFqK1qI4mfN4i/RN0iAL3gTujJtHgXINwBQy7zBZLq7gcfJW5GqXb5JQbZaNaHqasjYUegbyJLkJEVDXCLG4iXqEI2FCKeWjzaIgQdfRnGTZ6iahixTXTBmyUEFxPT9NcCOGDErcgdLMMpSEDQgJlxxPwO5rIHQw0uA5NBCFIRUBCOhVMt5xSdkoF1BN5r5N0XWs0Mr7QbhDparTwwVETyw2m+L64kW4I1NsBm9nVX9GtUw/bihaeSbSpKhil9Ie4u1Ki7wb/UdKDd9nZn6yW0HQO+T0O/QEY+nvwlQAUaCKKsnOeMzV6ocEGLPOr0mIr/OSmbaz5mEP0oUA51Aa5BuVnRmhuZyxm7EAHu/QD09CbMkKvO5D+jpxpchNJqU1/YldvIViHTLSoCtU7ZpXwdv6EM8Zt4tKG48BtieVU+i2iW1bvGjUI+iLUaJW+fCmgKDWHrO8Dw9TdSmq6hN35N6MgSGtBxBHEa2HPQfRdbzP82Z+',
  },
];

export function buildTimestampPolicy(input = {}) {
  const schema = input.schema ?? RFC3161_POLICY_SCHEMA;
  const profile = input.profile ?? DIGICERT_RFC3161_PROFILE;
  const maxClockSkewSeconds = input.maxClockSkewSeconds ?? 300;
  if (schema !== RFC3161_POLICY_SCHEMA || profile !== DIGICERT_RFC3161_PROFILE) throw new TypeError('Only the DigiCert RFC 3161 timestamp profile is supported');
  if (!Number.isSafeInteger(maxClockSkewSeconds) || maxClockSkewSeconds < 0 || maxClockSkewSeconds > 3_600) throw new TypeError('timestampPolicy.maxClockSkewSeconds must be between 0 and 3600');
  return { schema, profile, maxClockSkewSeconds };
}

export async function createTimestampRequest(data, cryptoProvider = globalThis.crypto) {
  const crypto = requireCrypto(cryptoProvider);
  configureEngine(crypto);
  const bytes = toBytes(data);
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  nonceBytes[0] &= 0x7f;
  if (nonceBytes.every((value) => value === 0)) nonceBytes[nonceBytes.length - 1] = 1;
  const nonce = new asn1js.Integer({ valueHex: toArrayBuffer(nonceBytes) });
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes));
  const messageImprint = new MessageImprint({ hashAlgorithm: new AlgorithmIdentifier({ algorithmId: SHA256_OID }), hashedMessage: new asn1js.OctetString({ valueHex: digest }) });
  const request = new TimeStampReq({ version: 1, messageImprint, nonce, certReq: true });
  return { body: new Uint8Array(request.toSchema().toBER(false)), nonce: integerHex(nonce) };
}

export async function buildTimestampEvidence({ response, authorizationHash, requestedAt, nonce, tsaUrl = DIGICERT_RFC3161_URL, cryptoProvider = globalThis.crypto }) {
  const bytes = toBytes(response);
  const parsed = parseResponse(bytes);
  const metadata = timestampMetadata(parsed);
  const responseHash = await sha256Hex(bytes, cryptoProvider);
  return {
    schema: RFC3161_EVIDENCE_SCHEMA,
    domain: 'priorseal/rfc3161-evidence/v1',
    profile: DIGICERT_RFC3161_PROFILE,
    tsaUrl,
    authorizationHash,
    requestedAt,
    nonce,
    timestamp: metadata.timestamp,
    serialNumber: metadata.serialNumber,
    policyOid: metadata.policyOid,
    digestAlgorithm: 'SHA-256',
    responseHash,
    response: encodeBase64Url(bytes),
  };
}

export async function verifyTimestampEvidence(evidence, data, policy, { authorizationHash, requestedAt, before, cryptoProvider = globalThis.crypto } = {}) {
  try {
    const normalizedPolicy = buildTimestampPolicy(policy);
    const claims = validateTimestampEvidenceClaims(evidence, normalizedPolicy, { authorizationHash, requestedAt, before });
    if (!claims.valid) return claims;
    const crypto = requireCrypto(cryptoProvider);
    configureEngine(crypto);
    const responseBytes = decodeBase64Url(evidence.response);
    if (evidence.responseHash !== await sha256Hex(responseBytes, crypto)) return invalid('TIMESTAMP_RESPONSE_HASH_MISMATCH');
    const response = parseResponse(responseBytes);
    const metadata = timestampMetadata(response);
    if (metadata.timestamp !== evidence.timestamp || metadata.serialNumber !== evidence.serialNumber || metadata.policyOid !== evidence.policyOid || metadata.nonce !== evidence.nonce) return invalid('TIMESTAMP_METADATA_MISMATCH');
    if (metadata.policyOid !== DIGICERT_POLICY_OID) return invalid('INVALID_TIMESTAMP_POLICY');
    let result;
    try {
      result = await response.verify({
        signer: 0,
        trustedCerts: trustedCertificates(),
        data: toArrayBuffer(toBytes(data)),
        checkChain: true,
        passedWhenNotRevValues: true,
        extendedMode: true,
      });
    } catch {
      return invalid('INVALID_TIMESTAMP_SIGNATURE');
    }
    if (result !== true && (!result?.signatureVerified || !result?.signerCertificateVerified)) return invalid('INVALID_TIMESTAMP_SIGNATURE');
    const signer = result === true ? null : result.signerCertificate;
    const eku = signer?.extensions?.find((extension) => extension.extnID === '2.5.29.37')?.parsedValue?.keyPurposes;
    if (!Array.isArray(eku) || !eku.includes(TIMESTAMPING_EKU_OID)) return invalid('INVALID_TIMESTAMP_CERTIFICATE_USAGE');
    const pathRoot = result === true ? null : result.certificatePath?.at(-1);
    if (!pathRoot || !TRUSTED_ROOTS.some((root) => root.fingerprint === certificateFingerprint(pathRoot))) return invalid('UNTRUSTED_TIMESTAMP_ROOT');
    return { valid: true, code: 'OK', timestamp: metadata.timestamp, serialNumber: metadata.serialNumber, profile: evidence.profile };
  } catch {
    return invalid('INVALID_TIMESTAMP_EVIDENCE');
  }
}

export function validateTimestampEvidenceClaims(evidence, policy, { authorizationHash, requestedAt, before } = {}) {
  try {
    const normalizedPolicy = buildTimestampPolicy(policy);
    if (!evidence || evidence.schema !== RFC3161_EVIDENCE_SCHEMA || evidence.domain !== 'priorseal/rfc3161-evidence/v1') return invalid('INVALID_TIMESTAMP_EVIDENCE');
    if (evidence.profile !== normalizedPolicy.profile || evidence.tsaUrl !== DIGICERT_RFC3161_URL || evidence.digestAlgorithm !== 'SHA-256') return invalid('INVALID_TIMESTAMP_PROFILE');
    if (evidence.authorizationHash !== authorizationHash || evidence.requestedAt !== requestedAt) return invalid('TIMESTAMP_AUTHORIZATION_MISMATCH');
    if (!Number.isSafeInteger(evidence.timestamp) || evidence.timestamp < requestedAt - normalizedPolicy.maxClockSkewSeconds || evidence.timestamp > requestedAt + normalizedPolicy.maxClockSkewSeconds) return invalid('TIMESTAMP_CLOCK_SKEW');
    if (before !== undefined && evidence.timestamp > before) return invalid('TIMESTAMP_AFTER_EXECUTION');
    if (!/^[0-9a-f]+$/i.test(evidence.nonce) || !/^[0-9a-f]+$/i.test(evidence.serialNumber) || !/^[0-9a-f]{64}$/i.test(evidence.responseHash) || typeof evidence.response !== 'string') return invalid('INVALID_TIMESTAMP_EVIDENCE');
    return { valid: true, code: 'OK', timestamp: evidence.timestamp, serialNumber: evidence.serialNumber, profile: evidence.profile };
  } catch {
    return invalid('INVALID_TIMESTAMP_EVIDENCE');
  }
}

function parseResponse(bytes) {
  const decoded = asn1js.fromBER(toArrayBuffer(bytes));
  if (decoded.offset === -1) throw new TypeError('Invalid RFC 3161 response');
  const response = new TimeStampResp({ schema: decoded.result });
  if (response.status.status !== PKIStatus.granted || !response.timeStampToken) throw new TypeError('RFC 3161 request was not granted');
  return response;
}

function timestampMetadata(response) {
  const signedData = new SignedData({ schema: response.timeStampToken.content });
  const content = signedData.encapContentInfo.eContent?.valueBlock?.valueHexView;
  if (!content) throw new TypeError('RFC 3161 token has no TSTInfo');
  const decoded = asn1js.fromBER(toArrayBuffer(content));
  if (decoded.offset === -1) throw new TypeError('Invalid RFC 3161 TSTInfo');
  const info = new TSTInfo({ schema: decoded.result });
  if (info.messageImprint.hashAlgorithm.algorithmId !== SHA256_OID || !info.nonce) throw new TypeError('Unsupported RFC 3161 token');
  return { timestamp: Math.floor(info.genTime.getTime() / 1000), serialNumber: integerHex(info.serialNumber), nonce: integerHex(info.nonce), policyOid: info.policy };
}

function trustedCertificates() {
  return TRUSTED_ROOTS.map((root) => {
    const decoded = asn1js.fromBER(toArrayBuffer(decodeBase64(root.der)));
    if (decoded.offset === -1) throw new TypeError('Invalid trusted certificate');
    return new Certificate({ schema: decoded.result });
  });
}

function certificateFingerprint(certificate) {
  const bytes = new Uint8Array(certificate.toSchema(true).toBER(false));
  // The pinned value is used only after PKI.js has built and verified the path.
  return TRUSTED_ROOTS.find((root) => equalBytes(bytes, decodeBase64(root.der)))?.fingerprint ?? '';
}

function configureEngine(crypto) {
  setEngine('priorseal-rfc3161', crypto, new CryptoEngine({ name: 'priorseal-rfc3161', crypto, subtle: crypto.subtle }));
}

function requireCrypto(value) {
  if (!value?.subtle || !value?.getRandomValues) throw new TypeError('WebCrypto is required for RFC 3161 verification');
  return value;
}

async function sha256Hex(value, crypto = globalThis.crypto) {
  const digest = await requireCrypto(crypto).subtle.digest('SHA-256', toArrayBuffer(toBytes(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function integerHex(value) { return [...value.valueBlock.valueHexView].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
function toBytes(value) { return value instanceof Uint8Array ? value : new Uint8Array(value); }
function toArrayBuffer(value) { const bytes = toBytes(value); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); }
function equalBytes(left, right) { return left.length === right.length && left.every((value, index) => value === right[index]); }
function encodeBase64Url(value) { return encodeBase64(toBytes(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); }
function decodeBase64Url(value) { return decodeBase64(String(value).replaceAll('-', '+').replaceAll('_', '/')); }
function encodeBase64(value) { let binary = ''; for (const byte of value) binary += String.fromCharCode(byte); return btoa(binary); }
function decodeBase64(value) { const normalized = value + '='.repeat((4 - value.length % 4) % 4); return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0)); }
function invalid(code) { return { valid: false, code }; }
