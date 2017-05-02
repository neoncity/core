exports.up = (knex, Promise) => knex.schema.raw(`
    CREATE TABLE core.donation_event (
        -- Primary key
	id Serial,
	PRIMARY KEY (id),
        -- Core properties
        type SmallInt NOT NULL,
        timestamp Timestamp NOT NULL,
        data Jsonb NOT NULL,
        -- Foreign key
        donation_id Int NOT NULL REFERENCES core.donation(id)
    );

    CREATE INDEX donation_event_donation_id ON core.donation_event(donation_id);
`);

exports.down = (knex, Promise) => knex.schema.raw(`
    DROP INDEX IF EXISTS core.donation_event_donation_id;
    DROP TABLE IF EXISTS core.donation_event;
`);
