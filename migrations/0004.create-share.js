exports.up = (knex, Promise) => knex.schema.raw(`
    CREATE TABLE core.share (
        id Serial,
        time_created Timestamp NOT NULL,
        cause_id Int NOT NULL REFERENCES core.cause(id),
        user_id Int NOT NULL,
	PRIMARY KEY (id)
    );

    CREATE INDEX share_cause_id ON core.share(cause_id);
    CREATE INDEX share_user_id ON core.share(user_id);
`);

exports.down = (knex, Promise) => knex.schema.raw(`
    DROP INDEX IF EXISTS core.share_user_id;
    DROP INDEX IF EXISTS core.share_cause_id;
    DROP TABLE IF EXISTS core.share;
`);
