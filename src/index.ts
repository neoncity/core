import * as express from 'express'
import * as knex from 'knex'
import { MarshalFrom } from 'raynor'

import { newAuthInfoMiddleware, newCorsMiddleware, newRequestTimeMiddleware, Request, startupMigration } from '@neoncity/common-server-js'
import { Cause, CauseResponse, CreateCauseRequest } from '@neoncity/core-sdk-js'
import { IdentityClient, newIdentityClient, User } from '@neoncity/identity-sdk-js'

import * as config from './config'


async function main() {
    startupMigration();

    const app = express();
    const identityClient: IdentityClient = newIdentityClient(config.IDENTITY_SERVICE_HOST);
    const conn = knex({
        client: 'pg',
    	connection: process.env.DATABASE_URL
    });

    const createCauseRequestMarshaller = new (MarshalFrom(CreateCauseMarshaller))();
    const causeResponseMarshaller = new (MarshalFrom(CauseResponse))();    

    app.use(newRequestTimeMiddleware());
    app.use(newCorsMiddleware(config.CLIENTS));
    app.use(newAuthInfoMiddleware());
    
    // The API is:
    // GET /causes - retrieves a selection of interesting causes. Tailored to the current user, but can be unauthed.
    // POST /causes - create a new cause. Must be a registered user.
    // GET /causes/:causeId - retrieves a particular cause. Tailored to the current user, but can be anauthed.
    // PUT /causes/:causeId - update something for the particular cause. Must be a registered user and the owner of the cause.
    // DELETE /causes/:causeId - remove the cause. Must be a registered user and the owner of the cause.
    // POST /causes/:causeId/donations - record that a donation has been made by a user for this cause.
    // POST /causes/:causeId/shares - share that a share has been made by a user for this cause.

    const causesRouter = express.Router();

    causesRouter.get('/', async (_: Request, res: express.Response) => {
        res.write('GET Causes');
        res.end();
    });

    causesRouter.post('/', async (req: Request, res: express.Response) => {
	if (req.authInfo == null) {
	    res.status(400);
	    res.end();
	    return;
	}

	// Make a call to the identity service to retrieve the user.
	let user: User|null = null;
	try {
	    user = await identityClient.getUser(req.authInfo.auth0AccessToken);
	} catch (e) {
	    res.status(500);
	    res.end();
	    return;
	}

	// Parse creation data.

	// Create cause
	let dbId: number|null = null;
	try {
	    dbId = await conn('core.cause')
		.returning('id')
		.insert({
		    'state': 'active',
		    'user_id': user.id,
		    'time_created': req.requestTime,
		    'time_last_updated': req.requestTime,
		    'time_removeed': null,
		    'title': createCauseRequest.title,
		    'description': createCauseRequest.description,
		    'pictures': createCauseRequest.pictures,
		    'deadline': createCauseRequest.deadline,
		    'goal': createCauseRequest.goal,
		    'bank_info': createCauseRequest.bankInfo
		});
	} catch (e) {
	    res.status(500);
	    res.end();
	    return;
	}

	// Return value.
	const cause = new Cause();

	const causeResponse = new CauseResponse();
	causeResponse.cause = cause;
	
        res.write(JSON.stringify(causeResponseMarshaller.pack(causeResponse)));
        res.end();
    });

    causesRouter.get('/:causeId', async (_: Request, res: express.Response) => {
        res.write('GET one cause');
        res.end();
    });

    causesRouter.put('/:causeId', async (_: Request, res: express.Response) => {
        res.write('PUT one cause');
        res.end();
    });

    causesRouter.delete('/:causeId', async (_: Request, res: express.Response) => {
        res.write('DELETE one cause');
        res.end();
    });

    causesRouter.post('/:causeId/donations', async (_: Request, res: express.Response) => {
        res.write('POST a donation to a cause');
        res.end();
    });

    causesRouter.post('/:causeId/shares', async (_: Request, res: express.Response) => {
        res.write('POST a share to a cause');
        res.end();
    });

    app.use('/causes', causesRouter);

    app.listen(config.PORT, config.ADDRESS, () => {
	console.log(`Started ... ${config.ADDRESS}:${config.PORT}`);
    });
}

main();
