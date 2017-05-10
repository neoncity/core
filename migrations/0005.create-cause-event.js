exports.up = (knex, Promise) => knex.schema.raw(`
    CREATE TABLE core.cause_event (
        -- Primary key
	id Serial,
	PRIMARY KEY (id),
        -- Core properties
        type SmallInt NOT NULL,
        timestamp Timestamp NOT NULL,
        data Jsonb NULL,
        -- Foreign key
        cause_id Int NOT NULL REFERENCES core.cause(id)
    );

    CREATE INDEX cause_event_cause_id ON core.cause_event(cause_id);
`);

exports.down = (knex, Promise) => knex.schema.raw(`
    DROP INDEX IF EXISTS core.cause_event_cause_id;
    DROP TABLE IF EXISTS core.cause_event;
`);

