import { readFileSync } from 'fs';

import { Env, parseEnv, isLocal, isOnServer } from '@neoncity/common-js';

export const NAME: string = 'core';
export const ENV: Env = parseEnv(process.env.ENV);
export const ADDRESS: string = process.env.ADDRESS;
export const PORT: number = parseInt(process.env.PORT, 10);
export const DATABASE_URL: string = process.env.DATABASE_URL;
export const DATABASE_MIGRATIONS_DIR: string = process.env.DATABASE_MIGRATIONS_DIR;
export const DATABASE_MIGRATIONS_TABLE: string = process.env.DATABASE_MIGRATIONS_TABLE;
export const ORIGIN: string = process.env.ORIGIN;
export const CLIENTS: string[] = process.env.CLIENTS.split(',');
export const IDENTITY_SERVICE_HOST: string = process.env.IDENTITY_SERVICE_HOST;

export let THE_KEY: string;

export let LOGGLY_TOKEN: string | null;
export let LOGGLY_SUBDOMAIN: string | null;
export let ROLLBAR_TOKEN: string | null;

if (isLocal(ENV)) {
    const secrets = JSON.parse(readFileSync(process.env.SECRETS_PATH, 'utf-8'));

    THE_KEY = secrets['THE_KEY'];
} else {
    THE_KEY = process.env.THE_KEY;
}

if (isOnServer(ENV)) {
    LOGGLY_TOKEN = process.env.LOGGLY_TOKEN;
    LOGGLY_SUBDOMAIN = process.env.LOGGLY_SUBDOMAIN;
    ROLLBAR_TOKEN = process.env.ROLLBAR_TOKEN;
} else {
    LOGGLY_TOKEN = null;
    LOGGLY_SUBDOMAIN = null;
    ROLLBAR_TOKEN = null;
}
