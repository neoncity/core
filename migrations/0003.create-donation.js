exports.up = (knex, Promise) => knex.schema.raw(`
    CREATE TABLE core.donation (
        -- Primary key
        id Serial,
	PRIMARY KEY (id),
        -- Core properties
        time_created Timestamp NOT NULL,
        amount Json NOT NULL,
        -- Foreign key
        cause_id Int NOT NULL REFERENCES core.cause(id),
        -- Foreign key to external systems
        user_id Int NOT NULL
    );

    CREATE INDEX donation_cause_id ON core.donation(cause_id);
    CREATE INDEX donation_user_id ON core.donation(user_id);
`);

exports.down = (knex, Promise) => knex.schema.raw(`
    DROP INDEX IF EXISTS core.donation_cause_id;
    DROP INDEX IF EXISTS core.donation_user_id;
    DROP TABLE IF EXISTS core.donation;
`);
