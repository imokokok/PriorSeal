-- Keep adapter-level identity rules enforceable after the initial schema.
ALTER TABLE execution_observations ALTER COLUMN intent_hash DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS intents_intent_id_idx ON intents(intent_id);
