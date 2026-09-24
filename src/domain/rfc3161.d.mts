// Generated from rfc3161-source.mts by npm run core:build. Do not edit directly.
export type TimestampPolicy = {
    schema: 'priorseal.timestamp-policy.v1';
    profile: 'digicert-rfc3161-v1';
    maxClockSkewSeconds: number;
};
export type TimestampEvidence = {
    schema: 'priorseal.rfc3161-evidence.v1';
    domain: string;
    profile: string;
    tsaUrl: string;
    authorizationHash: string;
    requestedAt: number;
    nonce: string;
    timestamp: number;
    serialNumber: string;
    policyOid: string;
    digestAlgorithm: string;
    responseHash: string;
    response: string;
};
export type TimestampVerificationResult = {
    valid: boolean;
    code: string;
    timestamp?: number;
    serialNumber?: string;
    profile?: string;
};
type TimestampOptions = {
    authorizationHash?: string;
    requestedAt?: number;
    before?: number;
    cryptoProvider?: Crypto;
};
export declare const RFC3161_POLICY_SCHEMA = "priorseal.timestamp-policy.v1";
export declare const RFC3161_EVIDENCE_SCHEMA = "priorseal.rfc3161-evidence.v1";
export declare const DIGICERT_RFC3161_PROFILE = "digicert-rfc3161-v1";
export declare const DIGICERT_RFC3161_URL = "http://timestamp.digicert.com";
export declare const DIGICERT_POLICY_OID = "2.16.840.1.114412.7.1";
export declare function buildTimestampPolicy(inputValue?: unknown): TimestampPolicy;
export declare function createTimestampRequest(data: Uint8Array, cryptoProvider?: Crypto): Promise<{
    body: Uint8Array<ArrayBuffer>;
    nonce: string;
}>;
export declare function buildTimestampEvidence({ response, authorizationHash, requestedAt, nonce, tsaUrl, cryptoProvider }: {
    response: Uint8Array;
    authorizationHash: string;
    requestedAt: number;
    nonce: string;
    tsaUrl?: string;
    cryptoProvider?: Crypto;
}): Promise<TimestampEvidence>;
export declare function verifyTimestampEvidence(evidence: TimestampEvidence | null | undefined, data: Uint8Array, policy: unknown, { authorizationHash, requestedAt, before, cryptoProvider }?: TimestampOptions): Promise<TimestampVerificationResult>;
export declare function validateTimestampEvidenceClaims(evidence: TimestampEvidence | null | undefined, policy: unknown, { authorizationHash, requestedAt, before }?: TimestampOptions): TimestampVerificationResult;
export {};
