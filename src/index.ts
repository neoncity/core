import { wrap } from 'async-middleware'
import * as bodyParser from 'body-parser'
import * as express from 'express'
import * as HttpStatus from 'http-status-codes'
import * as knex from 'knex'
import { MarshalFrom } from 'raynor'

import { newAuthInfoMiddleware, newCorsMiddleware, newRequestTimeMiddleware, Request, startupMigration } from '@neoncity/common-server-js'
import { Cause, CauseResponse, CausesResponse, CauseState, CreateCauseRequest, UpdateCauseRequest } from '@neoncity/core-sdk-js'
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

    const createCauseRequestMarshaller = new (MarshalFrom(CreateCauseRequest))();
    const updateCauseRequestMarshaller = new (MarshalFrom(UpdateCauseRequest))();
    const causesResponseMarshaller = new (MarshalFrom(CausesResponse))();
    const causeResponseMarshaller = new (MarshalFrom(CauseResponse))();

    app.use(newRequestTimeMiddleware());
    app.use(newCorsMiddleware(config.CLIENTS));
    app.use(newAuthInfoMiddleware());
    app.use(bodyParser.json());
    
    // The API is:
    // GET /causes - retrieves a selection of interesting causes. Tailored to the current user, but can be unauthed.
    // POST /causes - create a new cause. Must be a registered user.
    // GET /causes/:causeId - retrieves a particular cause. Tailored to the current user, but can be anauthed.
    // PUT /causes/:causeId - update something for the particular cause. Must be a registered user and the owner of the cause.
    // DELETE /causes/:causeId - remove the cause. Must be a registered user and the owner of the cause.
    // POST /causes/:causeId/donations - record that a donation has been made by a user for this cause.
    // POST /causes/:causeId/shares - share that a share has been made by a user for this cause.

    const causePublicFields = [
	'id',
	'state',
	'user_id',
	'time_created',
	'time_last_updated',
	'title',
	'description',
	'pictures',
	'deadline',
	'goal'
    ];

    const causePrivateFields = causePublicFields.slice();
    causePrivateFields.push('bank_info');

    const causesRouter = express.Router();

    causesRouter.get('/', wrap(async (_: Request, res: express.Response) => {
	let dbCauses: any[]|null = null;
	try {
	    dbCauses = await conn('core.cause')
		.select(causePublicFields)
		.where({state: 'active'})
		.orderBy('time_created', 'desc') as any[];
	} catch (e) {
	    console.log(`DB read error - ${e.toString()}`);
	    res.status(HttpStatus.INTERNAL_SERVER_ERROR);
	    res.end();
	    return;
	}

	const causes = dbCauses.map((dbC: any) => {
	    const cause = new Cause();
	    cause.id = dbC['id'];
	    cause.state = _dbCauseStateToCauseState(dbC['state']);
	    cause.timeCreated = new Date(dbC['time_created']);
	    cause.timeLastUpdated = new Date(dbC['time_last_updated']);
	    cause.title = dbC['title'];
	    cause.description = dbC['description'];
	    cause.pictures = dbC['pictures'];
	    cause.deadline = dbC['deadline'];
	    cause.goal = dbC['goal'];
	    cause.bankInfo = null;

	    return cause;
	});

	const causesResponse = new CausesResponse();
	causesResponse.causes = causes;
	
        res.write(JSON.stringify(causesResponseMarshaller.pack(causesResponse)))
	res.status(HttpStatus.OK);
        res.end();
    }));

    causesRouter.post('/', wrap(async (req: Request, res: express.Response) => {
	if (req.authInfo == null) {
	    console.log('No authInfo');
	    res.status(HttpStatus.BAD_REQUEST);
	    res.end();
	    return;
	}

	// Parse creation data.
	let createCauseRequest: CreateCauseRequest|null = null;
	try {
	    createCauseRequest = createCauseRequestMarshaller.extract(req.body) as CreateCauseRequest;
	} catch (e) {
	    console.log(`Invalid creation data - ${e.toString()}`);
	    res.status(HttpStatus.BAD_REQUEST);
	    res.end();
	    return;
	}

	// Make a call to the identity service to retrieve the user.
	let user: User|null = null;
	try {
	    user = await identityClient.getUser(req.authInfo.auth0AccessToken);
	} catch (e) {
	    // In lieu of instanceof working
	    if (e.name == 'UnauthorizedIdentityError') {
		console.log('User is unauthorized try');
		res.status(HttpStatus.UNAUTHORIZED);
	    } else {
		console.log(`Call to identity service failed - ${e.toString()}`);
		res.status(HttpStatus.INTERNAL_SERVER_ERROR);
	    }
	    
	    res.end();
	    return;
	}

	// Check deadline is appropriate.
	// TODO: do it

	// Create cause
	let dbId: number|null = null;
	try {
	    dbId = await conn('core.cause')
		.returning('id')
		.insert({
		    'state': _causeStateToDbCauseState(CauseState.Active),
		    'user_id': user.id,
		    'time_created': req.requestTime,
		    'time_last_updated': req.requestTime,
		    'time_removed': null,
		    'title': createCauseRequest.title,
		    'description': createCauseRequest.description,
		    'pictures': createCauseRequest.pictures,
		    'deadline': createCauseRequest.deadline,
		    'goal': createCauseRequest.goal,
		    'bank_info': createCauseRequest.bankInfo
		}) as number;
	} catch (e) {
	    if (e.detail == 'Key (user_id)=(1) already exists.') {
		console.log('Cause already exists for user');
		res.status(HttpStatus.CONFLICT);
	    } else {
		console.log(`DB insertion error - ${e.toString()}`);
		res.status(HttpStatus.INTERNAL_SERVER_ERROR);
	    }
	    
	    res.end();
	    return;
	}

	// Return value.
	const cause = new Cause();
	cause.id = dbId;
	cause.state = CauseState.Active;
	cause.timeCreated = req.requestTime;
	cause.timeLastUpdated = req.requestTime;
	cause.title = createCauseRequest.title;
	cause.description = createCauseRequest.description;
	cause.pictures = createCauseRequest.pictures;
	cause.deadline = createCauseRequest.deadline;
	cause.goal = createCauseRequest.goal;
	cause.bankInfo = createCauseRequest.bankInfo;

	const causeResponse = new CauseResponse();
	causeResponse.cause = cause;
	
        res.write(JSON.stringify(causeResponseMarshaller.pack(causeResponse)));
	res.status(HttpStatus.CREATED);
        res.end();
    }));

    causesRouter.get('/:causeId', wrap(async (req: Request, res: express.Response) => {
	// Parse request data.
	const causeId = parseInt(req.params['causeId']);

	// Make a call to the identity service to retrieve the user.
	let user: User|null = null;
	if (req.authInfo != null) {
	    try {
		user = await identityClient.getUser(req.authInfo.auth0AccessToken);
	    } catch (e) {
		// In lieu of instanceof working
		if (e.name == 'UnauthorizedIdentityError') {
		    console.log('User is unauthorized');
		    res.status(HttpStatus.UNAUTHORIZED);
		} else {
		    console.log(`Call to identity service failed - ${e.toString()}`);
		    res.status(HttpStatus.INTERNAL_SERVER_ERROR);
		}
		
		res.end();
		return;
	    }
	}

	let dbCause: any|null = null;
	try {
	    const dbCauses = await conn('core.cause')
		  .select(causePrivateFields)
		  .where({id: causeId, state: _causeStateToDbCauseState(CauseState.Active)})
		  .limit(1);

	    if (dbCauses.length == 0) {
		console.log('Cause does not exist');
		res.status(HttpStatus.NOT_FOUND);
		res.end();
		return;
	    }

	    dbCause = dbCauses[0];
	} catch (e) {
	    console.log(`DB read error - ${e.toString()}`);
	    res.status(HttpStatus.INTERNAL_SERVER_ERROR);
	    res.end();
	    return;
	}

	const cause = new Cause();
	cause.id = dbCause['id'];
	cause.state = _dbCauseStateToCauseState(dbCause['state']);
	cause.timeCreated = new Date(dbCause['time_created']);
	cause.timeLastUpdated = new Date(dbCause['time_last_updated']);
	cause.title = dbCause['title'];
	cause.description = dbCause['description'];
	cause.pictures = dbCause['pictures'];
	cause.deadline = dbCause['deadline'];
	cause.goal = dbCause['goal'];
	cause.bankInfo = user != null && user.id == dbCause['user_id'] ? dbCause['bank_info'] : null;

	const causeResponse = new CauseResponse();
	causeResponse.cause = cause;
		
        res.write(JSON.stringify(causeResponseMarshaller.pack(causeResponse)))
	res.status(HttpStatus.OK);
        res.end();
    }));

    causesRouter.put('/:causeId', wrap(async (req: Request, res: express.Response) => {
	if (req.authInfo == null) {
	    console.log('No authInfo');
	    res.status(HttpStatus.BAD_REQUEST);
	    res.end();
	    return;
	}

	// Parse request data.
	const causeId = parseInt(req.params['causeId']);

	let updateCauseRequest: UpdateCauseRequest|null = null;
	try {
	    updateCauseRequest = updateCauseRequestMarshaller.extract(req.body) as UpdateCauseRequest;
	} catch (e) {
	    console.log(`Invalid creation data - ${e.toString()}`);
	    res.status(HttpStatus.BAD_REQUEST);
	    res.end();
	    return;
	}

	// Make a call to the identity service to retrieve the user.
	let user: User|null = null;
	try {
	    user = await identityClient.getUser(req.authInfo.auth0AccessToken);
	} catch (e) {
	    // In lieu of instanceof working
	    if (e.name == 'UnauthorizedIdentityError') {
		console.log('User is unauthorized');
		res.status(HttpStatus.UNAUTHORIZED);
	    } else {
		console.log(`Call to identity service failed - ${e.toString()}`);
		res.status(HttpStatus.INTERNAL_SERVER_ERROR);
	    }
	    
	    res.end();
	    return;
	}

	// TODO: verify deadlline is OK.

	// TODO: improve typing here.
	const updateDict: any = {};
	for (let prop of Object.keys(updateCauseRequest)) {
	    updateDict[_nameToDbName(prop)] = (updateCauseRequest as any)[prop];
	}
	console.log(updateDict);

	// Update the cause of this user.
	let dbCause: any|null = null;
	try {
	    const dbCauses = await conn('core.cause')
		  .where({id: causeId, user_id: user.id, state: _causeStateToDbCauseState(CauseState.Active)})
		  .returning(causePrivateFields)
		  .update(updateDict) as any[];

	    if (dbCauses.length == 0) {
		console.log('Cause does not exist');
		res.status(HttpStatus.NOT_FOUND);
		res.end();
		return;
	    }

	    dbCause = dbCauses[0];
	} catch (e) {
	    console.log(`DB update error - ${e.toString()}`);
	    res.status(HttpStatus.INTERNAL_SERVER_ERROR);
	    res.end();
	    return;
	}

	// Return value.
	const cause = new Cause();
	cause.id = dbCause['id'];
	cause.state = _dbCauseStateToCauseState(dbCause['state']);
	cause.timeCreated = new Date(dbCause['time_created']);
	cause.timeLastUpdated = new Date(dbCause['time_last_updated']);
	cause.title = dbCause['title'];
	cause.description = dbCause['description'];
	cause.pictures = dbCause['pictures'];
	cause.deadline = dbCause['deadline'];
	cause.goal = dbCause['goal'];
	cause.bankInfo = dbCause['bank_info'];

	const causeResponse = new CauseResponse();
	causeResponse.cause = cause;
	
        res.write(JSON.stringify(causeResponseMarshaller.pack(causeResponse)));
	res.status(HttpStatus.OK);
        res.end();
    }));

    causesRouter.delete('/:causeId', wrap(async (req: Request, res: express.Response) => {
	if (req.authInfo == null) {
	    console.log('No authInfo');
	    res.status(HttpStatus.BAD_REQUEST);
	    res.end();
	    return;
	}

	// Parse request data.
	const causeId = parseInt(req.params['causeId']);

	// Make a call to the identity service to retrieve the user.
	let user: User|null = null;
	try {
	    user = await identityClient.getUser(req.authInfo.auth0AccessToken);
	} catch (e) {
	    // In lieu of instanceof working
	    if (e.name == 'UnauthorizedIdentityError') {
		console.log('User is unauthorized');
		res.status(HttpStatus.UNAUTHORIZED);
	    } else {
		console.log(`Call to identity service failed - ${e.toString()}`);
		res.status(HttpStatus.INTERNAL_SERVER_ERROR);
	    }
	    
	    res.end();
	    return;
	}

	// Mark the cause of this user as deleted.
	try {
	    const dbIds = await conn('core.cause')
		  .where({id: causeId, user_id: user.id, state: _causeStateToDbCauseState(CauseState.Active)})
		  .update({
		      'state': _causeStateToDbCauseState(CauseState.Removed),
		      'time_removed': req.requestTime
		  }, 'id') as number[];

	    if (dbIds.length == 0) {
		console.log('Cause does not exist');
		res.status(HttpStatus.NOT_FOUND);
		res.end();
		return;
	    }
	} catch (e) {
	    console.log(`DB update error - ${e.toString()}`);
	    res.status(HttpStatus.INTERNAL_SERVER_ERROR);
	    res.end();
	    return;
	}

	res.status(HttpStatus.NO_CONTENT);
        res.end();
    }));

    causesRouter.post('/:causeId/donations', wrap(async (_: Request, res: express.Response) => {
        res.write('POST a donation to a cause');
        res.end();
    }));

    causesRouter.post('/:causeId/shares', wrap(async (_: Request, res: express.Response) => {
        res.write('POST a share to a cause');
        res.end();
    }));

    app.use('/causes', causesRouter);

    app.listen(config.PORT, config.ADDRESS, () => {
	console.log(`Started core service on ${config.ADDRESS}:${config.PORT}`);
    });
}


function _causeStateToDbCauseState(causeState: CauseState): 'active'|'succeeded'|'removed' {
    switch (causeState) {
    case CauseState.Active:
	return 'active';
    case CauseState.Succeeded:
	return 'succeeded';
    case CauseState.Removed:
	return 'removed';
    default:
	throw new Error('Invalid cause state');
    }
}


function _dbCauseStateToCauseState(dbCauseState: 'active'|'succeeded'|'removed'): CauseState {
    switch (dbCauseState) {
    case 'active':
	return CauseState.Active;
    case 'succeeded':
	return CauseState.Succeeded;
    case 'removed':
	return CauseState.Removed;
    }
}


function _nameToDbName(prop: string): string {
    if (prop == 'bankInfo') {
	return 'bank_info';
    } else {
	return prop;
    }
}


main();
