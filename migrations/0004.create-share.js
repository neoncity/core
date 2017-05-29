exports.up = (knex, Promise) => knex.schema.raw(`
    CREATE TABLE core.share (
        -- Primary key
        id Serial,
	PRIMARY KEY (id),
        -- Foreign key
        cause_id Int NOT NULL REFERENCES core.cause(id),
        -- Foreign key to external systems
        session_id Uuid NULL,
        user_id Int NULL,
        facebook_post_id VarChar(128) NOT NULL,
        -- Denormalized data
        time_created Timestamp NOT NULL
    );

    CREATE INDEX share_cause_id ON core.share(cause_id);
    CREATE INDEX share_session_id ON core.share(session_id);
    CREATE INDEX share_user_id ON core.share(user_id);
`);

exports.down = (knex, Promise) => knex.schema.raw(`
    DROP INDEX IF EXISTS core.share_user_id;
    DROP INDEX IF EXISTS core.share_session_id;
    DROP INDEX IF EXISTS core.share_cause_id;
    DROP TABLE IF EXISTS core.share;
`);
