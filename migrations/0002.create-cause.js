exports.up = (knex, Promise) => knex.schema.raw(`
    CREATE TYPE CauseState AS ENUM ('active', 'succeeded', 'removed');

    CREATE TABLE core.cause (
        id Serial,
        state CauseState,
        user_id Int NOT NULL,
        time_created Timestamp NOT NULL,
        time_last_updated Timestamp NOT NULL,
        time_removed Timestamp NULL,
        title VarChar(128) NOT NULL,
        description Text NOT NULL,
        pictures Json NOT NULL,
        deadline Timestamp NOT NULL,
        goal Json NOT NULL,
	bank_info Json NOT NULL,
	PRIMARY KEY (id)
    );

    CREATE UNIQUE INDEX cause_user_id ON core.cause(user_id);
`);

exports.down = (knex, Promise) => knex.schema.raw(`
    DROP INDEX IF EXISTS core.cause_user_id;
    DROP TABLE IF EXISTS core.cause;
    DROP TYPE CauseState
`);
