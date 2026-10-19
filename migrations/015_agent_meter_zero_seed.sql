-- Match D1 0006: self-serve claims seed accounts at zero credits, so the
-- positive-seed CHECK moves from the schema into the operator issue flow.
ALTER TABLE agent_meter_accounts DROP CONSTRAINT agent_meter_accounts_provisioned_credits_check;
ALTER TABLE agent_meter_accounts ADD CONSTRAINT agent_meter_accounts_provisioned_credits_check CHECK (provisioned_credits >= 0);
