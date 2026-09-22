CREATE TABLE IF NOT EXISTS authorization_log_merkle_nodes (
  start_sequence BIGINT NOT NULL,
  level INTEGER NOT NULL CHECK (level >= 0 AND level <= 52),
  node_hash TEXT NOT NULL CHECK (node_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (start_sequence, level)
);
