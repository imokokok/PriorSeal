-- Authorization and signer nonce claims are permanent, including rejected/uncertain attempts.
CREATE TABLE rwa_execution_attempts (
  authorization_id TEXT PRIMARY KEY CHECK (authorization_id ~ '^auth_[0-9a-f]{32}$'),
  nonce_key TEXT NOT NULL UNIQUE CHECK (nonce_key ~ '^[0-9a-f]{64}$'),
  record_json JSONB NOT NULL CHECK (
    jsonb_typeof(record_json) = 'object'
    AND record_json->>'authorizationId' = authorization_id
    AND record_json->>'nonceKey' = nonce_key
    AND record_json->>'status' IN ('RESERVED','SUBMITTING','SUBMITTED','UNCERTAIN','REJECTED','CONFIRMED','REVERTED')
  )
);
