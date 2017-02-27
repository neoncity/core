import { execSync } from 'child_process'
import * as express from 'express'
// import * as knex from 'knex'

import { newCorsMiddleware } from '@neoncity/common-server-js'

import * as config from './config'


async function main() {
    execSync('./node_modules/.bin/knex migrate:latest');

    const app = express();

    app.use(newCorsMiddleware(config.CLIENTS));

    // The API is:
    // GET /causes - retrieves a selection of interesting causes. Tailored to the current user, but can be unauthed.
    // POST /causes - create a new cause. Must be a registered user.
    // GET /causes/:causeId - retrieves a particular cause. Tailored to the current user, but can be anauthed.
    // PUT /causes/:causeId - update something for the particular cause. Must be a registered user and the owner of the cause.
    // DELETE /causes/:causeId - remove the cause. Must be a registered user and the owner of the cause.
    // POST /causes/:causeId/donations - record that a donation has been made by a user for this cause.
    // POST /causes/:causeId/shares - share that a share has been made by a user for this cause.

    const causesRouter = express.Router();

    causesRouter.get('/', async (_: express.Request, res: express.Response) => {
        res.write('GET Causes');
        res.end();
    });

    causesRouter.post('/', async (_: express.Request, res: express.Response) => {
        res.write('POST Causes');
        res.end();
    });

    causesRouter.get('/:causeId', async (_: express.Request, res: express.Response) => {
        res.write('GET one cause');
        res.end();
    });

    causesRouter.put('/:causeId', async (_: express.Request, res: express.Response) => {
        res.write('PUT one cause');
        res.end();
    });

    causesRouter.delete('/:causeId', async (_: express.Request, res: express.Response) => {
        res.write('DELETE one cause');
        res.end();
    });

    causesRouter.post('/:causeId/donations', async (_: express.Request, res: express.Response) => {
        res.write('POST a donation to a cause');
        res.end();
    });

    causesRouter.post('/:causeId/shares', async (_: express.Request, res: express.Response) => {
        res.write('POST a share to a cause');
        res.end();
    });

    app.use('/causes', causesRouter);

    app.listen(config.PORT, config.ADDRESS, () => {
	console.log(`Started ... ${config.ADDRESS}:${config.PORT}`);
    });
}

main();
