import { wrap } from 'async-middleware'
import * as bodyParser from 'body-parser'
import * as compression from 'compression'
import * as express from 'express'
import * as HttpStatus from 'http-status-codes'
import * as knex from 'knex'
import { MarshalFrom } from 'raynor'

import { isLocal, WebFetcher } from '@neoncity/common-js'
import {
    AuthInfoLevel,
    InternalWebFetcher,
    newAuthInfoMiddleware,
    newCheckOriginMiddleware,
    newCheckXsrfTokenMiddleware,
    newJsonContentMiddleware,
    newRequestTimeMiddleware,
    newSessionMiddleware,
    SessionLevel,
    startupMigration
} from '@neoncity/common-server-js'
import {
    AllCauseSummariesResponse,
    CauseAnalyticsResponse,
    CreateCauseRequest,
    CreateDonationRequest,
    CreateShareRequest,
    PublicCausesResponse,
    PublicCauseResponse,
    PrivateCauseResponse,
    PrivateCauseResponseMarshaller,
    SessionDonationResponse,
    SessionShareResponse,
    UpdateCauseRequest,
    UserActionsOverviewResponse
} from '@neoncity/core-sdk-js'
import { AuthInfo, IdentityClient, newIdentityClient, Session } from '@neoncity/identity-sdk-js'

import * as config from './config'
import { CoreRequest } from './core-request'
import { Repository } from './repository'


async function main() {
    startupMigration();

    const app = express();
    const internalWebFetcher: WebFetcher = new InternalWebFetcher();
    const identityClient: IdentityClient = newIdentityClient(config.ENV, config.ORIGIN, config.IDENTITY_SERVICE_HOST, internalWebFetcher);
    const conn = knex({
        client: 'pg',
        connection: config.DATABASE_URL
    });

    const createCauseRequestMarshaller = new (MarshalFrom(CreateCauseRequest))();
    const updateCauseRequestMarshaller = new (MarshalFrom(UpdateCauseRequest))();
    const createDonationRequestMarshaller = new (MarshalFrom(CreateDonationRequest))();
    const createShareRequestMarshaller = new (MarshalFrom(CreateShareRequest))();
    const allCauseSummariesResponseMarshaller = new (MarshalFrom(AllCauseSummariesResponse))();
    const publicCausesResponseMarshaller = new (MarshalFrom(PublicCausesResponse))();
    const publicCauseResponseMarshaller = new (MarshalFrom(PublicCauseResponse))();
    const privateCauseResponseMarshaller = new PrivateCauseResponseMarshaller();
    const sessionDonationResponseMarshaller = new (MarshalFrom(SessionDonationResponse))();
    const sessionShareResponseMarshaller = new (MarshalFrom(SessionShareResponse))();
    const causeAnalyticsResponseMarshaller = new (MarshalFrom(CauseAnalyticsResponse))();
    const userActionsOverviewResponseMarshaller = new (MarshalFrom(UserActionsOverviewResponse))();

    const repository = new Repository(conn);

    app.disable('x-powered-by');
    app.use(newRequestTimeMiddleware());
    app.use(newCheckOriginMiddleware(config.CLIENTS));
    app.use(bodyParser.json());
    app.use(newJsonContentMiddleware());

    if (!isLocal(config.ENV)) {
        app.use(compression());
    }

    const publicCausesRouter = express.Router();

    publicCausesRouter.get('/summaries', [
        newAuthInfoMiddleware(AuthInfoLevel.None),
        newSessionMiddleware(SessionLevel.None, config.ENV, identityClient)
    ], wrap(async (_: CoreRequest, res: express.Response) => {
        try {
            const allCauseSummaries = await repository.getAllCauseSummaries();

            const allCauseSummariesResponse = new AllCauseSummariesResponse();
            allCauseSummariesResponse.causeSummaries = allCauseSummaries;

            res.write(JSON.stringify(allCauseSummariesResponseMarshaller.pack(allCauseSummariesResponse)))
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

    publicCausesRouter.get('/', [
        newAuthInfoMiddleware(AuthInfoLevel.None),
        newSessionMiddleware(SessionLevel.None, config.ENV, identityClient)
    ], wrap(async (_: CoreRequest, res: express.Response) => {
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

    publicCausesRouter.get('/:causeId', [
        newAuthInfoMiddleware(AuthInfoLevel.None),
        newSessionMiddleware(SessionLevel.None, config.ENV, identityClient)
    ], wrap(async (req: CoreRequest, res: express.Response) => {
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

    publicCausesRouter.post('/:causeId/donations', [
        newAuthInfoMiddleware(AuthInfoLevel.SessionId),
        newSessionMiddleware(SessionLevel.Session, config.ENV, identityClient),
        newCheckXsrfTokenMiddleware()
    ], wrap(async (req: CoreRequest, res: express.Response) => {
        // Parse request data.
        const causeId = parseInt(req.params['causeId']);

        if (isNaN(causeId)) {
            console.log('Invalid cause id');
            res.status(HttpStatus.BAD_REQUEST);
            res.end();
            return;
        }

        let createDonationRequest: CreateDonationRequest | null = null;
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
            const donationForSession = await repository.createDonation(req.authInfo as AuthInfo, req.session as Session, causeId, createDonationRequest, req.requestTime);

            const sessionDonationResponse = new SessionDonationResponse();
            sessionDonationResponse.donation = donationForSession;

            res.write(JSON.stringify(sessionDonationResponseMarshaller.pack(sessionDonationResponse)));
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

    publicCausesRouter.post('/:causeId/shares', [
        newAuthInfoMiddleware(AuthInfoLevel.SessionId),
        newSessionMiddleware(SessionLevel.Session, config.ENV, identityClient),
        newCheckXsrfTokenMiddleware()
    ], wrap(async (req: CoreRequest, res: express.Response) => {
        // Parse request data.
        const causeId = parseInt(req.params['causeId']);

        if (isNaN(causeId)) {
            console.log('Invalid cause id');
            res.status(HttpStatus.BAD_REQUEST);
            res.end();
            return;
        }

        let createShareRequest: CreateShareRequest | null = null;
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
            const shareForSession = await repository.createShare(req.authInfo as AuthInfo, req.session as Session, causeId, createShareRequest, req.requestTime);

            const sessionShareResponse = new SessionShareResponse();
            sessionShareResponse.share = shareForSession;

            res.write(JSON.stringify(sessionShareResponseMarshaller.pack(sessionShareResponse)));
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

    privateCausesRouter.use(newAuthInfoMiddleware(AuthInfoLevel.SessionIdAndAuth0AccessToken));
    privateCausesRouter.use(newSessionMiddleware(SessionLevel.SessionAndUser, config.ENV, identityClient));

    privateCausesRouter.post('/', newCheckXsrfTokenMiddleware(), wrap(async (req: CoreRequest, res: express.Response) => {
        // Parse creation data.
        let createCauseRequest: CreateCauseRequest | null = null;
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
            const cause = await repository.createCause(req.session as Session, createCauseRequest, req.requestTime);

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
            const cause = await repository.getCause(req.session as Session);

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
            const causeAnalytics = await repository.getCauseAnalytics(req.session as Session);

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

    privateCausesRouter.put('/', newCheckXsrfTokenMiddleware(), wrap(async (req: CoreRequest, res: express.Response) => {
        let updateCauseRequest: UpdateCauseRequest | null = null;
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
            const cause = await repository.updateCause(req.session as Session, updateCauseRequest, req.requestTime);

            const privateCauseResponse = new PrivateCauseResponse();
            privateCauseResponse.causeIsRemoved = false;
            privateCauseResponse.cause = cause;

            res.write(JSON.stringify(privateCauseResponseMarshaller.pack(privateCauseResponse)));
            res.status(HttpStatus.OK);
            res.end();
        } catch (e) {
            if (e.name == 'InvalidCausePropertiesError') {
                console.log(e.message);
                res.status(HttpStatus.BAD_REQUEST);
                res.end();
                return;
            }

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

    privateCausesRouter.delete('/', newCheckXsrfTokenMiddleware(), wrap(async (req: CoreRequest, res: express.Response) => {
        try {
            await repository.deleteCause(req.session as Session, req.requestTime);

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

    const privateUserActionsOverviewRouter = express.Router();

    privateUserActionsOverviewRouter.use(newAuthInfoMiddleware(AuthInfoLevel.SessionIdAndAuth0AccessToken));
    privateUserActionsOverviewRouter.use(newSessionMiddleware(SessionLevel.SessionAndUser, config.ENV, identityClient));

    privateUserActionsOverviewRouter.get('/', wrap(async (req: CoreRequest, res: express.Response) => {
        try {
            const userActionsOverview = await repository.getUserActionsOverview(req.session as Session);

            const userActionsOverviewResponse = new UserActionsOverviewResponse();
            userActionsOverviewResponse.userActionsOverview = userActionsOverview;

            res.write(JSON.stringify(userActionsOverviewResponseMarshaller.pack(userActionsOverviewResponse)));
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
    app.use('/private/user-actions-overview', privateUserActionsOverviewRouter);

    app.listen(config.PORT, config.ADDRESS, () => {
        console.log(`Started core service on ${config.ADDRESS}:${config.PORT}`);
    });
}


main();
