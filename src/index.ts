import { execSync } from 'child_process'
import * as express from 'express'
// import * as knex from 'knex'

import * as config from './config'


async function main() {
    execSync('./node_modules/.bin/knex migrate:latest');

    const app = express();
    
    app.use((_: express.Request, res: express.Response, next: () => void) => {
	res.header('Access-Control-Allow-Origin', config.CLIENTS);
	res.header('Access-Control-Allow-Headers', 'X-NeonCity-AuthInfo'); // TODO: make this better
	next();
    });

    app.get('/hello', async (_: express.Request, res: express.Response) => {
        res.write('Hello World');
        res.end();
    });

    app.listen(config.PORT, config.ADDRESS, () => {
	console.log(`Started ... ${config.ADDRESS}:${config.PORT}`);
    });
}

main();
