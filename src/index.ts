import { wrap } from 'async-middleware'
import * as bodyParser from 'body-parser'
import * as express from 'express'
import * as HttpStatus from 'http-status-codes'
import * as knex from 'knex'
import { MarshalFrom } from 'raynor'

import { isLocal } from '@neoncity/common-js/env'
import { newAuthInfoMiddleware, newCorsMiddleware, newRequestTimeMiddleware, startupMigration } from '@neoncity/common-server-js'
import { ActionsOverviewResponse,
	 CauseAnalyticsResponse,
	 CauseEventsResponse,
	 CreateCauseRequest,
	 CreateDonationRequest,
	 CreateShareRequest,
	 PublicCausesResponse,
	 PublicCauseResponse,
	 PrivateCauseResponse,
	 PrivateCauseResponseMarshaller,
	 UpdateCauseRequest,
	 UserDonationResponse,
	 UserShareResponse} from '@neoncity/core-sdk-js'
import { IdentityClient, newIdentityClient } from '@neoncity/identity-sdk-js'

import * as config from './config'
import { CoreRequest } from './core-request'
import { newIdentityMiddleware } from './identity-middleware'
import { Repository } from './repository'


async function main() {
    startupMigration();

    const app = express();
    const identityClient: IdentityClient = newIdentityClient(config.ENV, config.IDENTITY_SERVICE_HOST);
    const conn = knex({
        client: 'pg',
    	connection: config.DATABASE_URL
    });

    const createCauseRequestMarshaller = new (MarshalFrom(CreateCauseRequest))();
    const updateCauseRequestMarshaller = new (MarshalFrom(UpdateCauseRequest))();
    const createDonationRequestMarshaller = new (MarshalFrom(CreateDonationRequest))();
    const createShareRequestMarshaller = new (MarshalFrom(CreateShareRequest))();    
    const publicCausesResponseMarshaller = new (MarshalFrom(PublicCausesResponse))();
    const publicCauseResponseMarshaller = new (MarshalFrom(PublicCauseResponse))();
    const privateCauseResponseMarshaller = new PrivateCauseResponseMarshaller();
    const userDonationResponseMarshaller = new (MarshalFrom(UserDonationResponse))();
    const userShareResponseMarshaller = new (MarshalFrom(UserShareResponse))();
    const causeEventsResponseMarshaller = new (MarshalFrom(CauseEventsResponse))();
    const causeAnalyticsResponseMarshaller = new (MarshalFrom(CauseAnalyticsResponse))();
    const actionsOverviewResponseMarshaller = new (MarshalFrom(ActionsOverviewResponse))();

    const repository = new Repository(conn);

    app.use(newRequestTimeMiddleware());
    app.use(newCorsMiddleware(config.CLIENTS));
    app.use(newAuthInfoMiddleware());
    app.use(bodyParser.json());

    const publicCausesRouter = express.Router();

    publicCausesRouter.get('/', wrap(async (_: CoreRequest, res: express.Response) => {
	try {
	    const publicCauses = await repository.getPublicCauses();

	    const publicCausesResponse = new PublicCausesResponse();
	    publicCausesResponse.causes = publicCauses;
	    
            res.write(JSON.stringify(publicCausesResponseMarshaller.pack(publicCausesResponse)))
	    res.status(HttpStatus.OK);
            res.end();
	} catch (e) {
	    console.log(`DB read error - ${e.toString()}`);
	    if (isLocal(config.ENV)) {
                console.log(e);
	    }
	    
	    res.status(HttpStatus.INTERNAL_SERVER_ERROR);
	    res.end();
	    return;
	}
    }));

    publicCausesRouter.get('/:causeId', wrap(async (req: CoreRequest, res: express.Response) => {
	// Parse request data.
	const causeId = parseInt(req.params['causeId']);

	if (isNaN(causeId)) {
	    console.log('Invalid cause id');
	    res.status(HttpStatus.BAD_REQUEST);
	    res.end();
	    return;
	}

	try {
	    const publicCause = await repository.getPublicCause(causeId);

	    const publicCauseResponse = new PublicCauseResponse();
	    publicCauseResponse.cause = publicCause;
	    
            res.write(JSON.stringify(publicCauseResponseMarshaller.pack(publicCauseResponse)))
	    res.status(HttpStatus.OK);
            res.end();
	} catch (e) {
	    if (e.name == 'CauseNotFoundError') {
		console.log(e.message);
		res.status(HttpStatus.NOT_FOUND);
		res.end();
		return;
	    }
	    
	    console.log(`DB retrieval error - ${e.toString()}`);
	    if (isLocal(config.ENV)) {
                console.log(e);
	    }
	    
	    res.status(HttpStatus.INTERNAL_SERVER_ERROR);
	    res.end();
	}
    }));

    publicCausesRouter.post('/:causeId/donations', newIdentityMiddleware(config.ENV, identityClient), wrap(async (req: CoreRequest, res: express.Response) => {
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
	    if (isLocal(config.ENV)) {
                console.log(e);
	    }
	    
	    res.status(HttpStatus.BAD_REQUEST);
	    res.end();
	    return;
	}

	try {
	    const donationForUser = await repository.createDonation(req.user, causeId, createDonationRequest, req.requestTime);

	    const userDonationResponse = new UserDonationResponse();
	    userDonationResponse.donation = donationForUser;

	    res.write(JSON.stringify(userDonationResponseMarshaller.pack(userDonationResponse)));
            res.status(HttpStatus.CREATED);
            res.end();
	} catch (e) {
	    if (e.name == 'CauseNotFoundError') {
		console.log(e.message);
		res.status(HttpStatus.NOT_FOUND);
		res.end();
		return;
	    }

	    console.log(`DB insertion error - ${e.toString()}`);
	    if (isLocal(config.ENV)) {
                console.log(e);
	    }
	    
	    res.status(HttpStatus.INTERNAL_SERVER_ERROR);
	    res.end();
	}
    }));

    publicCausesRouter.post('/:causeId/shares', newIdentityMiddleware(config.ENV, identityClient), wrap(async (req: CoreRequest, res: express.Response) => {
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
	    if (isLocal(config.ENV)) {
                console.log(e);
	    }
	    
	    res.status(HttpStatus.BAD_REQUEST);
	    res.end();
	    return;
	}

	try {
	    const shareForUser = await repository.createShare(req.user, causeId, createShareRequest, req.requestTime);

	    const userShareResponse = new UserShareResponse();
	    userShareResponse.share = shareForUser;

	    res.write(JSON.stringify(userShareResponseMarshaller.pack(userShareResponse)));
            res.status(HttpStatus.CREATED);
            res.end();
	} catch (e) {
	    if (e.name == 'CauseNotFoundError') {
		console.log(e.message);
		res.status(HttpStatus.NOT_FOUND);
		res.end();
		return;
	    }

	    console.log(`DB insertion error - ${e.toString()}`);
	    if (isLocal(config.ENV)) {
                console.log(e);
	    }
	    
	    res.status(HttpStatus.INTERNAL_SERVER_ERROR);
	    res.end();
	}
    }));

    const privateCausesRouter = express.Router();

    privateCausesRouter.use(newIdentityMiddleware(config.ENV, identityClient));

    privateCausesRouter.post('/', wrap(async (req: CoreRequest, res: express.Response) => {
	// Parse creation data.
	let createCauseRequest: CreateCauseRequest|null = null;
	try {
	    createCauseRequest = createCauseRequestMarshaller.extract(req.body) as CreateCauseRequest;
	} catch (e) {
	    console.log(`Invalid creation data - ${e.toString()}`);
	    if (isLocal(config.ENV)) {
                console.log(e);
	    }
	    
	    res.status(HttpStatus.BAD_REQUEST);
	    res.end();
	    return;
	}

	try {
	    const cause = await repository.createCause(req.user, createCauseRequest, req.requestTime);

	    const privateCauseResponse = new PrivateCauseResponse();
	    privateCauseResponse.causeIsRemoved = false;
	    privateCauseResponse.cause = cause;
	
            res.write(JSON.stringify(privateCauseResponseMarshaller.pack(privateCauseResponse)));
	    res.status(HttpStatus.CREATED);
            res.end();
	} catch (e) {
	    if (e.name == 'InvalidCausePropertiesError') {
		console.log(e.message);
		res.status(HttpStatus.BAD_REQUEST);
		res.end();
		return;
	    }
	    
	    if (e.name == 'CauseAlreadyExistsError') {
		console.log(e.message);
		res.status(HttpStatus.CONFLICT);
		res.end();
		return;
	    }

	    console.log(`DB insertion error - ${e.toString()}`);
	    if (isLocal(config.ENV)) {
                console.log(e);
	    }
	    
	    res.status(HttpStatus.INTERNAL_SERVER_ERROR);
	    res.end();
	}
    }));

    privateCausesRouter.get('/', wrap(async (req: CoreRequest, res: express.Response) => {
	try {
	    const cause = await repository.getCause(req.user);
	    
	    const privateCauseResponse = new PrivateCauseResponse();
	    privateCauseResponse.causeIsRemoved = false;
	    privateCauseResponse.cause = cause;

            res.write(JSON.stringify(privateCauseResponseMarshaller.pack(privateCauseResponse)))
	    res.status(HttpStatus.OK);
            res.end();
	} catch (e) {
	    if (e.name == 'CauseNotFoundError') {
		console.log(e.message);
		res.status(HttpStatus.NOT_FOUND);
		res.end();
		return;
	    }

	    if (e.name == 'CauseRemovedError') {
		const privateCauseResponse = new PrivateCauseResponse();
		privateCauseResponse.causeIsRemoved = true;
		privateCauseResponse.cause = null;

		res.write(JSON.stringify(privateCauseResponseMarshaller.pack(privateCauseResponse)))
		res.status(HttpStatus.OK);
		res.end();
		return;
	    }

	    console.log(`DB retrieval error - ${e.toString()}`);
	    if (isLocal(config.ENV)) {
                console.log(e);
	    }
	    
	    res.status(HttpStatus.INTERNAL_SERVER_ERROR);
	    res.end();	    
	}
    }));

    privateCausesRouter.get('/analytics', wrap(async (req: CoreRequest, res: express.Response) => {
	try {
	    const causeAnalytics = await repository.getCauseAnalytics(req.user);
	    
	    const causeAnalyticsResponse = new CauseAnalyticsResponse();
	    causeAnalyticsResponse.causeAnalytics = causeAnalytics;

	    res.write(JSON.stringify(causeAnalyticsResponseMarshaller.pack(causeAnalyticsResponse)));
	    res.status(HttpStatus.OK);
            res.end();	    
	} catch (e) {
	    if (e.name == 'CauseNotFoundError') {
		console.log(e.message);
		res.status(HttpStatus.NOT_FOUND);
		res.end();
		return;
	    }
	    
	    console.log(`DB read error - ${e.toString()}`);
	    if (isLocal(config.ENV)) {
                console.log(e);
	    }
	    
	    res.status(HttpStatus.INTERNAL_SERVER_ERROR);
	    res.end();	    
	}
    }));

    privateCausesRouter.put('/', wrap(async (req: CoreRequest, res: express.Response) => {
	let updateCauseRequest: UpdateCauseRequest|null = null;
	try {
	    updateCauseRequest = updateCauseRequestMarshaller.extract(req.body) as UpdateCauseRequest;
	} catch (e) {
	    console.log(`Invalid creation data - ${e.toString()}`);
	    if (isLocal(config.ENV)) {
                console.log(e);
	    }
	    
	    res.status(HttpStatus.BAD_REQUEST);
	    res.end();
	    return;
	}

	try {
	    const cause = await repository.updateCause(req.user, updateCauseRequest, req.requestTime);

	    const privateCauseResponse = new PrivateCauseResponse();
	    privateCauseResponse.causeIsRemoved = false;
	    privateCauseResponse.cause = cause;
	    
            res.write(JSON.stringify(privateCauseResponseMarshaller.pack(privateCauseResponse)));
	    res.status(HttpStatus.OK);
            res.end();
	} catch (e) {
	    if (e.name == 'CauseNotFoundError') {
		console.log(e.message);
		res.status(HttpStatus.NOT_FOUND);
		res.end();
		return;
	    }

	    if (e.name == 'CauseRemovedError') {
		const privateCauseResponse = new PrivateCauseResponse();
		privateCauseResponse.causeIsRemoved = true;
		privateCauseResponse.cause = null;

		res.write(JSON.stringify(privateCauseResponseMarshaller.pack(privateCauseResponse)))
		res.status(HttpStatus.OK);
		res.end();
		return;
	    }

	    console.log(`DB retrieval error - ${e.toString()}`);
	    if (isLocal(config.ENV)) {
                console.log(e);
	    }
	    
	    res.status(HttpStatus.INTERNAL_SERVER_ERROR);
	    res.end();	    
	}
    }));

    privateCausesRouter.delete('/', wrap(async (req: CoreRequest, res: express.Response) => {
	// Mark the cause of this user as deleted.
	try {
	    await repository.deleteCause(req.user, req.requestTime);

	    res.status(HttpStatus.NO_CONTENT);
            res.end();
	} catch (e) {
	    if (e.name == 'CauseNotFoundError') {
		console.log(e.message);
		res.status(HttpStatus.NOT_FOUND);
		res.end();
		return;
	    }
	    
	    console.log(`DB update error - ${e.toString()}`);
	    if (isLocal(config.ENV)) {
                console.log(e);
	    }
	    
	    res.status(HttpStatus.INTERNAL_SERVER_ERROR);
	    res.end();
	}
    }));

    privateCausesRouter.get('/events', wrap(async (req: CoreRequest, res: express.Response) => {
	try {
	    const causeEvents = await repository.getCauseEvents(req.user);

            const causeEventsResponse = new CauseEventsResponse();
            causeEventsResponse.events = causeEvents;
	    
            res.write(JSON.stringify(causeEventsResponseMarshaller.pack(causeEventsResponse)));
            res.end();
	} catch (e) {
	    if (e.name == 'CauseNotFoundError') {
		console.log(e.message);
		res.status(HttpStatus.NOT_FOUND);
		res.end();
		return;
	    }
	    
	    console.log(`DB read error - ${e.toString()}`);
	    if (isLocal(config.ENV)) {
                console.log(e);
	    }
	    
	    res.status(HttpStatus.INTERNAL_SERVER_ERROR);
	    res.end();
	}
    }));    

    const privateActionsOverviewRouter = express.Router();

    privateActionsOverviewRouter.use(newIdentityMiddleware(config.ENV, identityClient));

    privateActionsOverviewRouter.get('/', wrap(async (req: CoreRequest, res: express.Response) => {
	try {
	    const userActionsOverview = await repository.getActionsOverview(req.user);

	    const actionsOverviewResponse = new ActionsOverviewResponse();
	    actionsOverviewResponse.actionsOverview = userActionsOverview;

	    res.write(JSON.stringify(actionsOverviewResponseMarshaller.pack(actionsOverviewResponse)));
	    res.status(HttpStatus.OK);
	    res.end();
	} catch (e) {
	    if (e.name == 'CauseNotFoundError') {
		console.log(e.message);
		res.status(HttpStatus.NOT_FOUND);
		res.end();
		return;
	    }
	    
	    console.log(`DB read error - ${e.toString()}`);
	    if (isLocal(config.ENV)) {
                console.log(e);
	    }
	    
	    res.status(HttpStatus.INTERNAL_SERVER_ERROR);
	    res.end();
	}
    }));

    app.use('/public/causes', publicCausesRouter);
    app.use('/private/causes', privateCausesRouter);
    app.use('/private/actions-overview', privateActionsOverviewRouter);

    app.listen(config.PORT, config.ADDRESS, () => {
	console.log(`Started core service on ${config.ADDRESS}:${config.PORT}`);
    });
}


main();
