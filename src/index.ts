import { wrap } from 'async-middleware'
import * as bodyParser from 'body-parser'
import * as express from 'express'
import * as HttpStatus from 'http-status-codes'
import * as knex from 'knex'
import { MarshalFrom } from 'raynor'

import { newAuthInfoMiddleware, newCorsMiddleware, newRequestTimeMiddleware, Request, startupMigration } from '@neoncity/common-server-js'
import { CauseState,
	 CreateCauseRequest,
	 CreateDonationRequest,
	 CreateShareRequest,
	 DonationForUser,
	 PublicCause,
	 PublicCausesResponse,
	 PublicCauseResponse,
	 PrivateCause,
	 PrivateCauseResponse,
	 ShareForUser,
	 UpdateCauseRequest,
	 UserDonationResponse,
	 UserShareResponse } from '@neoncity/core-sdk-js'
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
    const createDonationRequestMarshaller = new (MarshalFrom(CreateDonationRequest))();
    const createShareRequestMarshaller = new (MarshalFrom(CreateShareRequest))();    
    const publicCausesResponseMarshaller = new (MarshalFrom(PublicCausesResponse))();
    const publicCauseResponseMarshaller = new (MarshalFrom(PublicCauseResponse))();
    const privateCauseResponseMarshaller = new (MarshalFrom(PrivateCauseResponse))();
    const userDonationResponseMarshaller = new (MarshalFrom(UserDonationResponse))();
    const userShareResponseMarshaller = new (MarshalFrom(UserShareResponse))();

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

    const causesPublicRouter = express.Router();

    causesPublicRouter.get('/', wrap(async (_: Request, res: express.Response) => {
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
	    const cause = new PublicCause();
	    cause.id = dbC['id'];
	    cause.state = _dbCauseStateToCauseState(dbC['state']);
	    cause.timeCreated = new Date(dbC['time_created']);
	    cause.timeLastUpdated = new Date(dbC['time_last_updated']);
	    cause.title = dbC['title'];
	    cause.description = dbC['description'];
	    cause.pictures = dbC['pictures'];
	    cause.deadline = dbC['deadline'];
	    cause.goal = dbC['goal'];

	    return cause;
	});

	const publicCausesResponse = new PublicCausesResponse();
	publicCausesResponse.causes = causes;
	
        res.write(JSON.stringify(publicCausesResponseMarshaller.pack(publicCausesResponse)))
	res.status(HttpStatus.OK);
        res.end();
    }));

    causesPublicRouter.get('/:causeId', wrap(async (req: Request, res: express.Response) => {
	// Parse request data.
	const causeId = parseInt(req.params['causeId']);

	if (isNaN(causeId)) {
	    console.log('Invalid cause id');
	    res.status(HttpStatus.BAD_REQUEST);
	    res.end();
	    return;
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

	const cause = new PublicCause();
	cause.id = dbCause['id'];
	cause.state = _dbCauseStateToCauseState(dbCause['state']);
	cause.timeCreated = new Date(dbCause['time_created']);
	cause.timeLastUpdated = new Date(dbCause['time_last_updated']);
	cause.title = dbCause['title'];
	cause.description = dbCause['description'];
	cause.pictures = dbCause['pictures'];
	cause.deadline = dbCause['deadline'];
	cause.goal = dbCause['goal'];

	const publicCauseResponse = new PublicCauseResponse();
	publicCauseResponse.cause = cause;
		
        res.write(JSON.stringify(publicCauseResponseMarshaller.pack(publicCauseResponse)))
	res.status(HttpStatus.OK);
        res.end();
    }));

    causesPublicRouter.post('/:causeId/donations', wrap(async (req: Request, res: express.Response) => {
	if (req.authInfo == null) {
	    console.log('No authInfo');
	    res.status(HttpStatus.BAD_REQUEST);
	    res.end();
	    return;
	}

	// Parse request data.
	const causeId = parseInt(req.params['causeId']);

	if (isNaN(causeId)) {
	    console.log('Invalid cause id');
	    res.status(HttpStatus.BAD_REQUEST);
	    res.end();
	    return;
	}

	let createDonationRequest: CreateDonationRequest|null = null;
	try {
	    createDonationRequest = createDonationRequestMarshaller.extract(req.body);
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

	// Create donation
	let dbCause: any|null = null;
	let dbId: number = -1;
	try {
	    await conn.transaction(async (trx) => {
		const dbCauses = await trx
		      .from('core.cause')
		      .select(causePublicFields)
		      .where({id: causeId, state: _causeStateToDbCauseState(CauseState.Active)});

		if (dbCauses.length == 0) {
		    throw new Error('Cause does not exist');
		}

		dbCause = dbCauses[0];

		const dbIds = await trx
		      .from('core.donation')
		      .returning('id')
		      .insert({
			  'time_created': req.requestTime,
			  'cause_id': causeId,
			  'user_id': (user as User).id,
			  'amount': (createDonationRequest as CreateDonationRequest).amount
		      });

		if (dbIds.length == 0) {
		    throw new Error('Failed to insert donation');
		}

		dbId = dbIds[0];
	    });
	} catch (e) {
	    if (e.message == 'Cause does not exist') {
		console.log('Cause does not exist');
		res.status(HttpStatus.NOT_FOUND);
	    } else {
		console.log(`DB insertion error - ${e.toString()}`);
		res.status(HttpStatus.INTERNAL_SERVER_ERROR);
	    }
	    
	    res.end();
	    return;
	}

	const cause = new PublicCause();
	cause.id = dbCause['id'];
	cause.state = _dbCauseStateToCauseState(dbCause['state']);
	cause.timeCreated = new Date(dbCause['time_created']);
	cause.timeLastUpdated = new Date(dbCause['time_last_updated']);
	cause.title = dbCause['title'];
	cause.description = dbCause['description'];
	cause.pictures = dbCause['pictures'];
	cause.deadline = dbCause['deadline'];
	cause.goal = dbCause['goal'];

	const donationForUser = new DonationForUser();
	donationForUser.id = dbId as number;
	donationForUser.timeCreated = req.requestTime;
	donationForUser.forCause = cause;
	donationForUser.amount = createDonationRequest.amount;

	const userDonationResponse = new UserDonationResponse();
	userDonationResponse.donation = donationForUser;

	res.write(JSON.stringify(userDonationResponseMarshaller.pack(userDonationResponse)));
        res.status(HttpStatus.CREATED);
        res.end();
    }));

    causesPublicRouter.post('/:causeId/shares', wrap(async (req: Request, res: express.Response) => {
	if (req.authInfo == null) {
	    console.log('No authInfo');
	    res.status(HttpStatus.BAD_REQUEST);
	    res.end();
	    return;
	}

	// Parse request data.
	const causeId = parseInt(req.params['causeId']);

	if (isNaN(causeId)) {
	    console.log('Invalid cause id');
	    res.status(HttpStatus.BAD_REQUEST);
	    res.end();
	    return;
	}

	let createShareRequest: CreateShareRequest|null = null;
	try {
	    createShareRequest = createShareRequestMarshaller.extract(req.body);
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

	// Create share
	let dbCause: any|null = null;
	let dbId: number = -1;
	try {
	    await conn.transaction(async (trx) => {
		const dbCauses = await trx
		      .from('core.cause')
		      .select(causePublicFields)
		      .where({id: causeId, state: _causeStateToDbCauseState(CauseState.Active)});

		if (dbCauses.length == 0) {
		    throw new Error('Cause does not exist');
		}

		dbCause = dbCauses[0];

		const dbIds = await trx
		      .from('core.share')
		      .returning('id')
		      .insert({
			  'time_created': req.requestTime,
			  'cause_id': causeId,
			  'user_id': (user as User).id
		      });

		if (dbIds.length == 0) {
		    throw new Error('Failed to insert share');
		}

		dbId = dbIds[0];
	    });
	} catch (e) {
	    if (e.message == 'Cause does not exist') {
		console.log('Cause does not exist');
		res.status(HttpStatus.NOT_FOUND);
	    } else {
		console.log(`DB insertion error - ${e.toString()}`);
		res.status(HttpStatus.INTERNAL_SERVER_ERROR);
	    }
	    
	    res.end();
	    return;
	}

	const cause = new PublicCause();
	cause.id = dbCause['id'];
	cause.state = _dbCauseStateToCauseState(dbCause['state']);
	cause.timeCreated = new Date(dbCause['time_created']);
	cause.timeLastUpdated = new Date(dbCause['time_last_updated']);
	cause.title = dbCause['title'];
	cause.description = dbCause['description'];
	cause.pictures = dbCause['pictures'];
	cause.deadline = dbCause['deadline'];
	cause.goal = dbCause['goal'];

	const shareForUser = new ShareForUser();
	shareForUser.id = dbId as number;
	shareForUser.timeCreated = req.requestTime;
	shareForUser.forCause = cause;

	const userShareResponse = new UserShareResponse();
	userShareResponse.share = shareForUser;

	res.write(JSON.stringify(userShareResponseMarshaller.pack(userShareResponse)));
        res.status(HttpStatus.CREATED);
        res.end();
    }));

    const causesPrivateRouter = express.Router();

    causesPrivateRouter.post('/', wrap(async (req: Request, res: express.Response) => {
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
	    const dbIds = await conn('core.cause')
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
		}) as number[];

	    if (dbIds.length == 0) {
		throw new Error('Failed to insert cause');
	    }

	    dbId = dbIds[0];
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
	const cause = new PrivateCause();
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

	const privateCauseResponse = new PrivateCauseResponse();
	privateCauseResponse.cause = cause;
	
        res.write(JSON.stringify(privateCauseResponseMarshaller.pack(privateCauseResponse)));
	res.status(HttpStatus.CREATED);
        res.end();
    }));

    causesPrivateRouter.get('/:causeId', wrap(async (req: Request, res: express.Response) => {
	if (req.authInfo == null) {
	    console.log('No authInfo');
	    res.status(HttpStatus.BAD_REQUEST);
	    res.end();
	    return;
	}
        
	// Parse request data.
	const causeId = parseInt(req.params['causeId']);

	if (isNaN(causeId)) {
	    console.log('Invalid cause id');
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

	let dbCause: any|null = null;
	try {
	    const dbCauses = await conn('core.cause')
		  .select(causePrivateFields)
		  .where({id: causeId, user_id: user.id, state: _causeStateToDbCauseState(CauseState.Active)})
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

	const cause = new PrivateCause();
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

	const privateCauseResponse = new PrivateCauseResponse();
	privateCauseResponse.cause = cause;
		
        res.write(JSON.stringify(privateCauseResponseMarshaller.pack(privateCauseResponse)))
	res.status(HttpStatus.OK);
        res.end();
    }));

    causesPrivateRouter.put('/:causeId', wrap(async (req: Request, res: express.Response) => {
	if (req.authInfo == null) {
	    console.log('No authInfo');
	    res.status(HttpStatus.BAD_REQUEST);
	    res.end();
	    return;
	}

	// Parse request data.
	const causeId = parseInt(req.params['causeId']);

	if (isNaN(causeId)) {
	    console.log('Invalid cause id');
	    res.status(HttpStatus.BAD_REQUEST);
	    res.end();
	    return;
	}

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
	const cause = new PrivateCause();
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

	const privateCauseResponse = new PrivateCauseResponse();
	privateCauseResponse.cause = cause;
	
        res.write(JSON.stringify(privateCauseResponseMarshaller.pack(privateCauseResponse)));
	res.status(HttpStatus.OK);
        res.end();
    }));

    causesPrivateRouter.delete('/:causeId', wrap(async (req: Request, res: express.Response) => {
	if (req.authInfo == null) {
	    console.log('No authInfo');
	    res.status(HttpStatus.BAD_REQUEST);
	    res.end();
	    return;
	}

	// Parse request data.
	const causeId = parseInt(req.params['causeId']);

	if (isNaN(causeId)) {
	    console.log('Invalid cause id');
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

    app.use('/causes/public', causesPublicRouter);
    app.use('/causes/private', causesPrivateRouter);

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
