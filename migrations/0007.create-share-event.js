exports.up = (knex, Promise) => knex.schema.raw(`
    CREATE TABLE core.share_event (
        -- Primary key
	id Serial,
	PRIMARY KEY (id),
        -- Core properties
        type SmallInt NOT NULL,
        timestamp Timestamp NOT NULL,
        data Jsonb NULL,
        -- Foreign key
        share_id Int NOT NULL REFERENCES core.share(id)
    );

    CREATE INDEX share_event_share_id ON core.share_event(share_id);
`);

exports.down = (knex, Promise) => knex.schema.raw(`
    DROP INDEX IF EXISTS core.share_event_share_id;
    DROP TABLE IF EXISTS core.share_event;
`);
