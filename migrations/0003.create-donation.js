exports.up = (knex, Promise) => knex.schema.raw(`
    CREATE TABLE core.donation (
        -- Primary key
        id Serial,
        PRIMARY KEY (id),
        -- Core properties
        amount Json NOT NULL,
        -- Foreign key
        cause_id Int NOT NULL REFERENCES core.cause(id),
        -- Foreign key to external systems
        session_id Uuid NULL,
        user_id Int NULL,
        -- Denormalized data
        time_created Timestamp NOT NULL
    );

    CREATE INDEX donation_cause_id ON core.donation(cause_id);
    CREATE INDEX donation_session_id ON core.donation(session_id);
    CREATE INDEX donation_user_id ON core.donation(user_id);
`);

exports.down = (knex, Promise) => knex.schema.raw(`
    DROP INDEX IF EXISTS core.donation_user_id;
    DROP INDEX IF EXISTS core.donation_session_id;
    DROP INDEX IF EXISTS core.donation_cause_id;
    DROP TABLE IF EXISTS core.donation;
`);
