exports.up = (knex, Promise) => knex.schema.raw(`
    CREATE TABLE core.cause (
        id Serial,
        state SmallInt NOT NULL,
        user_id Int NOT NULL,
        time_created Timestamp NOT NULL,
        time_last_updated Timestamp NOT NULL,
        time_removed Timestamp NULL,
        slugs Jsonb NOT NULL,
        title VarChar(128) NOT NULL,
        description Text NOT NULL,
        picture_set Jsonb NOT NULL,
        deadline Timestamp NOT NULL,
        goal Jsonb NOT NULL,
	bank_info Jsonb NOT NULL,
	PRIMARY KEY (id)
    );

    CREATE UNIQUE INDEX cause_user_id ON core.cause(user_id);
`);

exports.down = (knex, Promise) => knex.schema.raw(`
    DROP INDEX IF EXISTS core.cause_user_id;
    DROP TABLE IF EXISTS core.cause;
`);
