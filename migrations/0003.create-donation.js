exports.up = (knex, Promise) => knex.schema.raw(`
    CREATE TABLE core.donation (
        id Serial,
        time_created Timestamp NOT NULL,
        cause_id Int NOT NULL REFERENCES core.cause(id),
        user_id Int NOT NULL,
        amount Json NOT NULL,
	PRIMARY KEY (id)
    );

    CREATE INDEX donation_cause_id ON core.donation(cause_id);
    CREATE INDEX donation_user_id ON core.donation(user_id);
`);

exports.down = (knex, Promise) => knex.schema.raw(`
    DROP INDEX IF EXISTS core.donation_cause_id;
    DROP INDEX IF EXISTS core.donation_user_id;
    DROP TABLE IF EXISTS core.donation;
`);
