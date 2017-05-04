import { wrap } from 'async-middleware'
import * as bodyParser from 'body-parser'
import * as express from 'express'
import * as HttpStatus from 'http-status-codes'
import * as knex from 'knex'
import { MarshalFrom, SlugMarshaller } from 'raynor'

import { newAuthInfoMiddleware, newCorsMiddleware, newRequestTimeMiddleware, Request, startupMigration } from '@neoncity/common-server-js'
import { ActionsOverviewResponse,
         BankInfo,
         BankInfoMarshaller,
	 CauseState,
	 CreateCauseRequest,
	 CreateDonationRequest,
	 CreateShareRequest,
	 CurrencyAmount,
	 DonationEventType,
	 DonationForUser,
         PictureSet,
         PictureSetMarshaller,
	 PublicCause,
	 PublicCausesResponse,
	 PublicCauseResponse,
	 PrivateCause,
	 PrivateCauseResponse,
	 ShareForUser,
	 UpdateCauseRequest,
	 UserActionsOverview,
	 UserDonationResponse,
	 UserShareResponse} from '@neoncity/core-sdk-js'
import { IdentityClient, newIdentityClient, User } from '@neoncity/identity-sdk-js'
import { slugify } from '@neoncity/common-js/slugify'

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
    const actionsOverviewResponseMarshaller = new (MarshalFrom(ActionsOverviewResponse))();
    const pictureSetMarshaller = new PictureSetMarshaller();
    const currencyAmountMarshaller = new (MarshalFrom(CurrencyAmount))();
    const bankInfoMarshaller = new BankInfoMarshaller();
    const slugMarshaller = new SlugMarshaller();

    const causePublicFields = [
	'core.cause.id as cause_id',
	'core.cause.state as cause_state',
	'core.cause.user_id as cause_user_id',
	'core.cause.time_created as cause_time_created',
	'core.cause.time_last_updated as cause_time_last_updated',
	'core.cause.slugs as cause_slugs',
	'core.cause.title as cause_title',
	'core.cause.description as cause_description',
	'core.cause.picture_set as cause_picture_set',
	'core.cause.deadline as cause_deadline',
	'core.cause.goal as cause_goal'
    ];

    const causePrivateFields = causePublicFields.slice();
    causePrivateFields.push('core.cause.bank_info as cause_bank_info');

    const donationFields = [
	'core.donation.id as donation_id',
	'core.donation.time_created as donation_time_created',
	'core.donation.cause_id as donation_cause_id',
	'core.donation.user_id as donation_user_id',
	'core.donation.amount as donation_amount'
    ];

    const shareFields = [
	'core.share.id as share_id',
	'core.share.time_created as share_time_created',
	'core.share.cause_id as share_cause_id',
	'core.share.user_id as share_user_id',
        'core.share.facebook_post_id as facebook_post_id'
    ];

    app.use(newRequestTimeMiddleware());
    app.use(newCorsMiddleware(config.CLIENTS));
    app.use(newAuthInfoMiddleware());
    app.use(bodyParser.json());

    const publicCausesRouter = express.Router();

    publicCausesRouter.get('/', wrap(async (_: Request, res: express.Response) => {
	let dbCauses: any[]|null = null;
	try {
	    dbCauses = await conn('core.cause')
		.select(causePublicFields)
		.where({state: CauseState.Active})
		.orderBy('time_created', 'desc') as any[];
	} catch (e) {
	    console.log(`DB read error - ${e.toString()}`);
	    res.status(HttpStatus.INTERNAL_SERVER_ERROR);
	    res.end();
	    return;
	}

	const causes = dbCauses.map((dbC: any) => {
	    const cause = new PublicCause();
	    cause.id = dbC['cause_id'];
	    cause.state = dbC['cause_state'];
	    cause.timeCreated = new Date(dbC['cause_time_created']);
	    cause.timeLastUpdated = new Date(dbC['cause_time_last_updated']);
	    cause.slug = _latestSlug(dbC['cause_slugs'].slugs);
	    cause.title = dbC['cause_title'];
	    cause.description = dbC['cause_description'];
	    cause.pictureSet = pictureSetMarshaller.extract(dbC['cause_picture_set']);
	    cause.deadline = dbC['cause_deadline'];
	    cause.goal = currencyAmountMarshaller.extract(dbC['cause_goal']);

	    return cause;
	});

	const publicCausesResponse = new PublicCausesResponse();
	publicCausesResponse.causes = causes;
	
        res.write(JSON.stringify(publicCausesResponseMarshaller.pack(publicCausesResponse)))
	res.status(HttpStatus.OK);
        res.end();
    }));

    publicCausesRouter.get('/:causeId', wrap(async (req: Request, res: express.Response) => {
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
		  .where({id: causeId, state: CauseState.Active})
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
	cause.id = dbCause['cause_id'];
	cause.state = dbCause['cause_state'];
	cause.timeCreated = new Date(dbCause['cause_time_created']);
	cause.timeLastUpdated = new Date(dbCause['cause_time_last_updated']);
	cause.slug = _latestSlug(dbCause['cause_slugs'].slugs);
	cause.title = dbCause['cause_title'];
	cause.description = dbCause['cause_description'];
	cause.pictureSet = pictureSetMarshaller.extract(dbCause['cause_picture_set']);
	cause.deadline = dbCause['cause_deadline'];
	cause.goal = currencyAmountMarshaller.extract(dbCause['cause_goal']);

	const publicCauseResponse = new PublicCauseResponse();
	publicCauseResponse.cause = cause;
		
        res.write(JSON.stringify(publicCauseResponseMarshaller.pack(publicCauseResponse)))
	res.status(HttpStatus.OK);
        res.end();
    }));

    publicCausesRouter.post('/:causeId/donations', wrap(async (req: Request, res: express.Response) => {
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
		      .where({id: causeId, state: CauseState.Active});

		if (dbCauses.length == 0) {
		    throw new Error('Cause does not exist');
		}

		dbCause = dbCauses[0];

		const dbIds = await trx
		      .from('core.donation')
		      .returning('id')
		      .insert({
			  'time_created': req.requestTime,
			  'amount': currencyAmountMarshaller.pack((createDonationRequest as CreateDonationRequest).amount),
			  'cause_id': causeId,
			  'user_id': (user as User).id
		      });

		if (dbIds.length == 0) {
		    throw new Error('Failed to insert donation');
		}

		dbId = dbIds[0];

		const dbDonationEventIds = await trx
		      .from('core.donation_event')
		      .returning('id')
		      .insert({
			  'type': DonationEventType.Created,
			  'timestamp': req.requestTime,
			  'data': createDonationRequestMarshaller.pack(createDonationRequest as CreateDonationRequest),
			  'donation_id': dbId
		      });

		if (dbDonationEventIds.length == 0) {
		    throw new Error('Failed to insert creation event');
		}
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
	cause.id = dbCause['cause_id'];
	cause.state = dbCause['cause_state'];
	cause.timeCreated = new Date(dbCause['cause_time_created']);
	cause.timeLastUpdated = new Date(dbCause['cause_time_last_updated']);
	cause.slug = _latestSlug(dbCause['cause_slugs'].slugs);
	cause.title = dbCause['cause_title'];
	cause.description = dbCause['cause_description'];
	cause.pictureSet = pictureSetMarshaller.extract(dbCause['cause_picture_set']);
	cause.deadline = dbCause['cause_deadline'];
	cause.goal = currencyAmountMarshaller.extract(dbCause['cause_goal']);

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

    publicCausesRouter.post('/:causeId/shares', wrap(async (req: Request, res: express.Response) => {
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
		      .where({id: causeId, state: CauseState.Active});

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
			  'user_id': (user as User).id,
                          'facebook_post_id': (createShareRequest as CreateShareRequest).facebookPostId
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
	cause.id = dbCause['cause_id'];
	cause.state = dbCause['cause_state'];
	cause.timeCreated = new Date(dbCause['cause_time_created']);
	cause.timeLastUpdated = new Date(dbCause['cause_time_last_updated']);
	cause.slug = _latestSlug(dbCause['cause_slugs'].slugs);
	cause.title = dbCause['cause_title'];
	cause.description = dbCause['cause_description'];
	cause.pictureSet = pictureSetMarshaller.extract(dbCause['cause_picture_set']);
	cause.deadline = dbCause['cause_deadline'];
	cause.goal = currencyAmountMarshaller.extract(dbCause['cause_goal']);

	const shareForUser = new ShareForUser();
	shareForUser.id = dbId as number;
	shareForUser.timeCreated = req.requestTime;
	shareForUser.forCause = cause;
        shareForUser.facebookPostId = createShareRequest.facebookPostId;

	const userShareResponse = new UserShareResponse();
	userShareResponse.share = shareForUser;

	res.write(JSON.stringify(userShareResponseMarshaller.pack(userShareResponse)));
        res.status(HttpStatus.CREATED);
        res.end();
    }));

    const privateCausesRouter = express.Router();

    privateCausesRouter.post('/', wrap(async (req: Request, res: express.Response) => {
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

	// Create slug.
	const slug = slugify(createCauseRequest.title);

	try {
	    slugMarshaller.extract(slug);
	} catch (e) {
	    console.log('Title cannot be slugified');
	    res.status(HttpStatus.BAD_REQUEST);
	    res.end();
	    return;
	}

	const slugs = {slugs: [{slug: slug, timeCreated: req.requestTime.getTime()}]};

	// Create cause
	let dbId: number|null = null;
	try {
	    const dbIds = await conn('core.cause')
		.returning('id')
		.insert({
		    'state': CauseState.Active,
		    'user_id': user.id,
		    'time_created': req.requestTime,
		    'time_last_updated': req.requestTime,
		    'time_removed': null,
		    'slugs': slugs,
		    'title': createCauseRequest.title,
		    'description': createCauseRequest.description,
		    'picture_set': pictureSetMarshaller.pack(createCauseRequest.pictureSet),
		    'deadline': createCauseRequest.deadline,
		    'goal': currencyAmountMarshaller.pack(createCauseRequest.goal),
		    'bank_info': bankInfoMarshaller.pack(createCauseRequest.bankInfo)
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
	cause.slug = slug;
	cause.title = createCauseRequest.title;
	cause.description = createCauseRequest.description;
	cause.pictureSet = createCauseRequest.pictureSet;
	cause.deadline = createCauseRequest.deadline;
	cause.goal = createCauseRequest.goal;
	cause.bankInfo = createCauseRequest.bankInfo;

	const privateCauseResponse = new PrivateCauseResponse();
	privateCauseResponse.cause = cause;
	
        res.write(JSON.stringify(privateCauseResponseMarshaller.pack(privateCauseResponse)));
	res.status(HttpStatus.CREATED);
        res.end();
    }));

    privateCausesRouter.get('/', wrap(async (req: Request, res: express.Response) => {
	if (req.authInfo == null) {
	    console.log('No authInfo');
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
		  .where({user_id: user.id, state: CauseState.Active})
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
	cause.id = dbCause['cause_id'];
	cause.state = dbCause['cause_state'];
	cause.timeCreated = new Date(dbCause['cause_time_created']);
	cause.timeLastUpdated = new Date(dbCause['cause_time_last_updated']);
	cause.slug = _latestSlug(dbCause['cause_slugs'].slugs);
	cause.title = dbCause['cause_title'];
	cause.description = dbCause['cause_description'];
	cause.pictureSet = pictureSetMarshaller.extract(dbCause['cause_picture_set']);
	cause.deadline = dbCause['cause_deadline'];
	cause.goal = currencyAmountMarshaller.extract(dbCause['cause_goal']);
	cause.bankInfo = bankInfoMarshaller.extract(dbCause['cause_bank_info']);

	const privateCauseResponse = new PrivateCauseResponse();
	privateCauseResponse.cause = cause;

        res.write(JSON.stringify(privateCauseResponseMarshaller.pack(privateCauseResponse)))
	res.status(HttpStatus.OK);
        res.end();
    }));

    privateCausesRouter.put('/', wrap(async (req: Request, res: express.Response) => {
	if (req.authInfo == null) {
	    console.log('No authInfo');
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

	const updateDict: any = {
            'time_last_updated': req.requestTime
        };

        if (updateCauseRequest.hasOwnProperty('title')) {
            updateDict['title'] = updateCauseRequest.title;
        }

        if (updateCauseRequest.hasOwnProperty('description')) {
            updateDict['description'] = updateCauseRequest.description;
        }

        if (updateCauseRequest.hasOwnProperty('pictureSet')) {
            updateDict['picture_set'] = pictureSetMarshaller.pack(updateCauseRequest.pictureSet as PictureSet);
        }

        if (updateCauseRequest.hasOwnProperty('deadline')) {
            updateDict['deadline'] = updateCauseRequest.deadline;
        }

        if (updateCauseRequest.hasOwnProperty('goal')) {
            updateDict['goal'] = currencyAmountMarshaller.pack(updateCauseRequest.goal as CurrencyAmount);
        }

        if (updateCauseRequest.hasOwnProperty('bankInfo')) {
            updateDict['bank_info'] = bankInfoMarshaller.pack(updateCauseRequest.bankInfo as BankInfo);
        }

	// Update the cause of this user.
	let dbCause: any|null = null;
	try {
	    const dbCauses = await conn('core.cause')
		  .where({user_id: user.id, state: CauseState.Active})
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
	cause.id = dbCause['cause_id'];
	cause.state = dbCause['cause_state'];
	cause.timeCreated = new Date(dbCause['cause_time_created']);
	cause.timeLastUpdated = new Date(dbCause['cause_time_last_updated']);
	cause.slug = _latestSlug(dbCause['cause_slugs'].slugs);
	cause.title = dbCause['cause_title'];
	cause.description = dbCause['cause_description'];
	cause.pictureSet = pictureSetMarshaller.extract(dbCause['cause_picture_set']);
	cause.deadline = dbCause['cause_deadline'];
	cause.goal = currencyAmountMarshaller.extract(dbCause['cause_goal']);
	cause.bankInfo = bankInfoMarshaller.extract(dbCause['cause_bank_info']);

	const privateCauseResponse = new PrivateCauseResponse();
	privateCauseResponse.cause = cause;
	
        res.write(JSON.stringify(privateCauseResponseMarshaller.pack(privateCauseResponse)));
	res.status(HttpStatus.OK);
        res.end();
    }));

    privateCausesRouter.delete('/', wrap(async (req: Request, res: express.Response) => {
	if (req.authInfo == null) {
	    console.log('No authInfo');
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
		  .where({user_id: user.id, state: CauseState.Active})
		  .update({
		      'state': CauseState.Removed,
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

    const privateActionsOverviewRouter = express.Router();

    privateActionsOverviewRouter.get('/', wrap(async (req: Request, res: express.Response) => {
	if (req.authInfo == null) {
	    console.log('No authInfo');
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

	// Retrieve donations and shares.
	let dbDonations: any[]|null = null;
	let dbShares: any[]|null = null;
	try {
	    dbDonations = await conn('core.donation')
		.join('core.cause', 'core.donation.cause_id', '=', 'core.cause.id')
		.where({'core.donation.user_id': user.id})
		.select(donationFields.concat(causePublicFields)) as any[];

	    dbShares = await conn('core.share')
		.join('core.cause', 'core.share.cause_id', '=', 'core.cause.id')
		.where({'core.share.user_id': user.id})
		.select(shareFields.concat(causePublicFields)) as any[];
	} catch (e) {
	    console.log(`DB read error - ${e.toString()}`);
	    res.status(HttpStatus.INTERNAL_SERVER_ERROR);
	    res.end();
	    return;
	}

	// Return value.
	const donations = dbDonations.map((dbD) => {
	    const cause = new PublicCause();
	    cause.id = dbD['cause_id'];
	    cause.state = dbD['cause_state'];
	    cause.timeCreated = new Date(dbD['cause_time_created']);
	    cause.timeLastUpdated = new Date(dbD['cause_time_last_updated']);
	    cause.slug = _latestSlug(dbD['cause_slugs'].slugs);
	    cause.title = dbD['cause_title'];
	    cause.description = dbD['cause_description'];
	    cause.pictureSet = pictureSetMarshaller.extract(dbD['cause_picture_set']);
	    cause.deadline = dbD['cause_deadline'];
	    cause.goal = currencyAmountMarshaller.extract(dbD['cause_goal']);

	    const donationForUser = new DonationForUser();
	    donationForUser.id = dbD['donation_id'];
	    donationForUser.timeCreated = dbD['donation_time_created'];
	    donationForUser.forCause = cause;
	    donationForUser.amount = currencyAmountMarshaller.extract(dbD['donation_amount']);

	    return donationForUser;
	});

	const shares = dbShares.map((dbD) => {
	    const cause = new PublicCause();
	    cause.id = dbD['cause_id'];
	    cause.state = dbD['cause_state'];
	    cause.timeCreated = new Date(dbD['cause_time_created']);
	    cause.timeLastUpdated = new Date(dbD['cause_time_last_updated']);
	    cause.slug = _latestSlug(dbD['cause_slugs'].slugs);
	    cause.title = dbD['cause_title'];
	    cause.description = dbD['cause_description'];
	    cause.pictureSet = pictureSetMarshaller.extract(dbD['cause_picture_set']);
	    cause.deadline = dbD['cause_deadline'];
	    cause.goal = currencyAmountMarshaller.extract(dbD['cause_goal']);

	    const shareForUser = new ShareForUser();
	    shareForUser.id = dbD['share_id'];
	    shareForUser.timeCreated = dbD['share_time_created'];
	    shareForUser.forCause = cause;
            shareForUser.facebookPostId = dbD['share_facebook_post_id'];

	    return shareForUser;
	});	

	const userActionsOverview = new UserActionsOverview();
	userActionsOverview.donations = donations;
	userActionsOverview.shares = shares;

	const actionsOverviewResponse = new ActionsOverviewResponse();
	actionsOverviewResponse.actionsOverview = userActionsOverview;

	res.write(JSON.stringify(actionsOverviewResponseMarshaller.pack(actionsOverviewResponse)));
	res.status(HttpStatus.OK);
	res.end();
    }));

    app.use('/public/causes', publicCausesRouter);
    app.use('/private/causes', privateCausesRouter);
    app.use('/private/actions-overview', privateActionsOverviewRouter);

    app.listen(config.PORT, config.ADDRESS, () => {
	console.log(`Started core service on ${config.ADDRESS}:${config.PORT}`);
    });
}


function _latestSlug(slugs: any[]): string {
    if (slugs.length == 0) {
	throw new Error('Should have some slugs');
    }

    let latestSlug = slugs[0].slug;
    let latestSlugTime = slugs[0].timeCreated;

    for (let i = 1; i < slugs.length; i++) {
	if (slugs[i].timeCreated > latestSlugTime) {
	    latestSlug = slugs[i].slug;
	    latestSlugTime = slugs[i].timeCreated;
	}
    }

    return latestSlug;
}


main();
