import * as knex from 'knex'
import { Marshaller, MarshalFrom, SlugMarshaller } from 'raynor'

import { slugify } from '@neoncity/common-js'
import {
    BankInfo,
    BankInfoMarshaller,
    CauseAnalytics,
    CauseEventType,
    CauseState,
    CauseSummary,
    CreateCauseRequest,
    CreateDonationRequest,
    CreateShareRequest,
    CurrencyAmount,
    DonationForSession,
    DonationEventType,
    PictureSet,
    PictureSetMarshaller,
    PrivateCause,
    PublicCause,
    ShareForSession,
    ShareEventType,
    UpdateCauseRequest,
    UserActionsOverview
} from '@neoncity/core-sdk-js'
import {
    AuthInfo,
    IdentityClient,
    PublicUser,
    Session,
    User
} from '@neoncity/identity-sdk-js'

const moment = require('moment')


export class RepositoryError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RepositoryError';
    }
}


export class CauseNotFoundError extends RepositoryError {
    constructor(message: string) {
        super(message);
        this.name = 'CauseNotFoundError';
    }
}


export class CauseRemovedError extends CauseNotFoundError {
    constructor(message: string) {
        super(message);
        this.name = 'CauseRemovedError';
    }
}


export class InvalidCausePropertiesError extends RepositoryError {
    constructor(message: string) {
        super(message);
        this.name = 'InvalidCausePropertiesError';
    }
}


export class CauseAlreadyExistsError extends RepositoryError {
    constructor(message: string) {
        super(message);
        this.name = 'CauseAlreadyExistsError';
    }
}


type UserIdToUserMap = { [k: number]: PublicUser };


export class Repository {
    private static readonly MAX_NUMBER_OF_CAUSES: number = 20;
    private static readonly MAX_NUMBER_OF_DONATIONS: number = 100;
    private static readonly MAX_NUMBER_OF_SHARES: number = 100;

    private static readonly _causeSummaryFields = [
        'core.cause.id as cause_id',
        'core.cause.slugs as cause_slugs',
        'core.cause.time_last_updated as cause_time_last_updated'
    ];

    private static readonly _causePublicFields = [
        'core.cause.id as cause_id',
        'core.cause.state as cause_state',
        'core.cause.slugs as cause_slugs',
        'core.cause.title as cause_title',
        'core.cause.description as cause_description',
        'core.cause.picture_set as cause_picture_set',
        'core.cause.deadline as cause_deadline',
        'core.cause.goal as cause_goal',
        'core.cause.user_id as cause_user_id',
        'core.cause.time_created as cause_time_created',
        'core.cause.time_last_updated as cause_time_last_updated'
    ];

    private static readonly _causePrivateFields = Repository._causePublicFields.concat('core.cause.bank_info as cause_bank_info');

    private static readonly _donationFields = [
        'core.donation.id as donation_id',
        'core.donation.amount as donation_amount',
        'core.donation.cause_id as donation_cause_id',
        'core.donation.session_id as donation_session_id',
        'core.donation.user_id as donation_user_id',
        'core.donation.time_created as donation_time_created'
    ];

    private static readonly _shareFields = [
        'core.share.id as share_id',
        'core.share.cause_id as share_cause_id',
        'core.share.session_id as share_session_id',
        'core.share.user_id as share_user_id',
        'core.share.facebook_post_id as facebook_post_id',
        'core.share.time_created as share_time_created'
    ];

    private readonly _conn: knex;
    private readonly _identityClient: IdentityClient;
    private readonly _createCauseRequestMarshaller: Marshaller<CreateCauseRequest>;
    private readonly _updateCauseRequestMarshaller: Marshaller<UpdateCauseRequest>;
    private readonly _createDonationRequestMarshaller: Marshaller<CreateDonationRequest>;
    private readonly _createShareRequestMarshaller: Marshaller<CreateShareRequest>;
    private readonly _pictureSetMarshaller: Marshaller<PictureSet>;
    private readonly _currencyAmountMarshaller: Marshaller<CurrencyAmount>;
    private readonly _bankInfoMarshaller: BankInfoMarshaller;
    private readonly _slugMarshaller: SlugMarshaller;

    constructor(conn: knex, identityClient: IdentityClient) {
        this._conn = conn;
        this._identityClient = identityClient;
        this._createCauseRequestMarshaller = new (MarshalFrom(CreateCauseRequest))();
        this._updateCauseRequestMarshaller = new (MarshalFrom(UpdateCauseRequest))();
        this._createDonationRequestMarshaller = new (MarshalFrom(CreateDonationRequest))();
        this._createShareRequestMarshaller = new (MarshalFrom(CreateShareRequest))();
        this._pictureSetMarshaller = new PictureSetMarshaller();
        this._currencyAmountMarshaller = new (MarshalFrom(CurrencyAmount))();
        this._bankInfoMarshaller = new BankInfoMarshaller();
        this._slugMarshaller = new SlugMarshaller();
    }

    async getAllCauseSummaries(): Promise<CauseSummary[]> {
        const dbCauseSummaries = await this._conn('core.cause')
            .select(Repository._causeSummaryFields)
            .where({ state: CauseState.Active })
            .orderBy('time_created', 'desc');

        return dbCauseSummaries.map((dbCS: any) => {
            const causeSummary = new CauseSummary();
            causeSummary.id = dbCS['cause_id'];
            causeSummary.slug = Repository._latestSlug(dbCS['cause_slugs'].slugs);
            causeSummary.timeLastUpdated = new Date(dbCS['cause_time_last_updated']);

            return causeSummary;
        });
    }

    async getPublicCauses(authInfo: AuthInfo): Promise<PublicCause[]> {
        const dbCauses = await this._conn('core.cause')
            .select(Repository._causePublicFields)
            .where({ state: CauseState.Active })
            .orderBy('time_created', 'desc')
            .limit(Repository.MAX_NUMBER_OF_CAUSES) as any[];

        const users = await this._identityClient.withContext(authInfo).getUsersInfo(dbCauses.map(dbC => dbC['cause_user_id']));
        const usersById: UserIdToUserMap = {};
        for (let user of users)
            usersById[user.id] = user;

        return dbCauses.map((dbC: any) => {
            const cause = new PublicCause();
            cause.id = dbC['cause_id'];
            cause.state = dbC['cause_state'];
            cause.slug = Repository._latestSlug(dbC['cause_slugs'].slugs);
            cause.title = dbC['cause_title'];
            cause.description = dbC['cause_description'];
            cause.pictureSet = this._pictureSetMarshaller.extract(dbC['cause_picture_set']);
            cause.deadline = dbC['cause_deadline'];
            cause.goal = this._currencyAmountMarshaller.extract(dbC['cause_goal']);
            cause.timeCreated = new Date(dbC['cause_time_created']);
            cause.timeLastUpdated = new Date(dbC['cause_time_last_updated']);
            cause.user = usersById[dbC['cause_user_id']];

            return cause;
        });
    }

    async getPublicCause(authInfo: AuthInfo, causeId: number): Promise<PublicCause> {
        const dbCauses = await this._conn('core.cause')
            .select(Repository._causePublicFields)
            .where({ id: causeId, state: CauseState.Active })
            .limit(1);

        if (dbCauses.length == 0) {
            throw new CauseNotFoundError('Cause does not exist');
        }

        const dbCause = dbCauses[0];

        const users = await this._identityClient.withContext(authInfo).getUsersInfo([dbCause['cause_user_id']]);

        const cause = new PublicCause();
        cause.id = dbCause['cause_id'];
        cause.state = dbCause['cause_state'];
        cause.slug = Repository._latestSlug(dbCause['cause_slugs'].slugs);
        cause.title = dbCause['cause_title'];
        cause.description = dbCause['cause_description'];
        cause.pictureSet = this._pictureSetMarshaller.extract(dbCause['cause_picture_set']);
        cause.deadline = dbCause['cause_deadline'];
        cause.goal = this._currencyAmountMarshaller.extract(dbCause['cause_goal']);
        cause.timeCreated = new Date(dbCause['cause_time_created']);
        cause.timeLastUpdated = new Date(dbCause['cause_time_last_updated']);
        cause.user = users[0];

        return cause;
    }

    async createCause(session: Session, createCauseRequest: CreateCauseRequest, requestTime: Date): Promise<PrivateCause> {
        // Create slug.
        const slug = slugify(createCauseRequest.title);

        try {
            this._slugMarshaller.extract(slug);
        } catch (e) {
            throw new InvalidCausePropertiesError('Title cannot be slugified');
        }

        const slugs = { slugs: [{ slug: slug, timeCreated: requestTime.getTime() }] };

        // Check that the deadline is not in the past.
        if (createCauseRequest.deadline.getTime() < Date.now()) {
            throw new InvalidCausePropertiesError('Deadline is in the past');
        }

        let dbId: number = -1;

        try {
            await this._conn.transaction(async (trx) => {
                const dbIds = await trx
                    .from('core.cause')
                    .returning('id')
                    .insert({
                        'state': CauseState.Active,
                        'slugs': slugs,
                        'title': createCauseRequest.title,
                        'description': createCauseRequest.description,
                        'picture_set': this._pictureSetMarshaller.pack(createCauseRequest.pictureSet),
                        'deadline': createCauseRequest.deadline,
                        'goal': this._currencyAmountMarshaller.pack(createCauseRequest.goal),
                        'bank_info': this._bankInfoMarshaller.pack(createCauseRequest.bankInfo),
                        'user_id': (session.user as User).id,
                        'time_created': requestTime,
                        'time_last_updated': requestTime,
                        'time_removed': null
                    }) as number[];

                dbId = dbIds[0];

                await trx
                    .from('core.cause_event')
                    .returning('id')
                    .insert({
                        'type': CauseEventType.Created,
                        'timestamp': requestTime,
                        'data': this._createCauseRequestMarshaller.pack(createCauseRequest as CreateCauseRequest),
                        'cause_id': dbId
                    });
            });
        } catch (e) {
            if (e.detail.match(/^Key [(]user_id[)]=[(]\d+[)] already exists.$/) != null) {
                throw new CauseAlreadyExistsError('Cause already exists for user');
            }

            throw e;
        }

        // Return value.
        const cause = new PrivateCause();
        cause.id = dbId;
        cause.state = CauseState.Active;
        cause.slug = slug;
        cause.title = createCauseRequest.title;
        cause.description = createCauseRequest.description;
        cause.pictureSet = createCauseRequest.pictureSet;
        cause.deadline = createCauseRequest.deadline;
        cause.goal = createCauseRequest.goal;
        cause.bankInfo = createCauseRequest.bankInfo;
        cause.timeCreated = requestTime;
        cause.timeLastUpdated = requestTime;

        return cause;
    }

    async getCause(session: Session): Promise<PrivateCause> {
        const dbCauses = await this._conn('core.cause')
            .select(Repository._causePrivateFields)
            .where({ user_id: (session.user as User).id })
            .limit(1);

        if (dbCauses.length == 0) {
            throw new CauseNotFoundError('Cause does not exist');
        }

        const dbCause = dbCauses[0];

        if (dbCause['cause_state'] == CauseState.Removed) {
            throw new CauseRemovedError('Cause exists but is removed');
        }

        const cause = new PrivateCause();
        cause.id = dbCause['cause_id'];
        cause.state = dbCause['cause_state'];
        cause.slug = Repository._latestSlug(dbCause['cause_slugs'].slugs);
        cause.title = dbCause['cause_title'];
        cause.description = dbCause['cause_description'];
        cause.pictureSet = this._pictureSetMarshaller.extract(dbCause['cause_picture_set']);
        cause.deadline = dbCause['cause_deadline'];
        cause.goal = this._currencyAmountMarshaller.extract(dbCause['cause_goal']);
        cause.bankInfo = this._bankInfoMarshaller.extract(dbCause['cause_bank_info']);
        cause.timeCreated = new Date(dbCause['cause_time_created']);
        cause.timeLastUpdated = new Date(dbCause['cause_time_last_updated']);

        return cause;
    }

    async updateCause(session: Session, updateCauseRequest: UpdateCauseRequest, requestTime: Date): Promise<PrivateCause> {
        // TODO: improve typing here.

        const updateDict: any = {
            'time_last_updated': requestTime
        };

        if (updateCauseRequest.hasOwnProperty('title')) {
            updateDict['title'] = updateCauseRequest.title;
        }

        if (updateCauseRequest.hasOwnProperty('description')) {
            updateDict['description'] = updateCauseRequest.description;
        }

        if (updateCauseRequest.hasOwnProperty('pictureSet')) {
            updateDict['picture_set'] = this._pictureSetMarshaller.pack(updateCauseRequest.pictureSet as PictureSet);
        }

        if (updateCauseRequest.hasOwnProperty('deadline')) {
            // Check that the deadline is not in the past.
            if ((updateCauseRequest.deadline as Date).getTime() < Date.now()) {
                throw new InvalidCausePropertiesError('Deadline is in the past');
            }

            updateDict['deadline'] = updateCauseRequest.deadline;
        }

        if (updateCauseRequest.hasOwnProperty('goal')) {
            updateDict['goal'] = this._currencyAmountMarshaller.pack(updateCauseRequest.goal as CurrencyAmount);
        }

        if (updateCauseRequest.hasOwnProperty('bankInfo')) {
            updateDict['bank_info'] = this._bankInfoMarshaller.pack(updateCauseRequest.bankInfo as BankInfo);
        }

        // Update the cause of this user.
        let dbCause: any | null = null;
        await this._conn.transaction(async (trx) => {
            const dbCauses = await trx
                .from('core.cause')
                .where({ user_id: (session.user as User).id })
                .returning(Repository._causePrivateFields)
                .update(updateDict) as any[];

            if (dbCauses.length == 0) {
                throw new CauseNotFoundError('Cause does not exist');
            }

            dbCause = dbCauses[0];

            if (dbCause['cause_state'] == CauseState.Removed) {
                throw new CauseRemovedError('Cause exists but is removed');
            }

            await trx
                .from('core.cause_event')
                .returning('id')
                .insert({
                    'type': CauseEventType.Updated,
                    'timestamp': requestTime,
                    'data': this._updateCauseRequestMarshaller.pack(updateCauseRequest),
                    'cause_id': dbCause['cause_id']
                });
        });

        const cause = new PrivateCause();
        cause.id = dbCause['cause_id'];
        cause.state = dbCause['cause_state'];
        cause.slug = Repository._latestSlug(dbCause['cause_slugs'].slugs);
        cause.title = dbCause['cause_title'];
        cause.description = dbCause['cause_description'];
        cause.pictureSet = this._pictureSetMarshaller.extract(dbCause['cause_picture_set']);
        cause.deadline = dbCause['cause_deadline'];
        cause.goal = this._currencyAmountMarshaller.extract(dbCause['cause_goal']);
        cause.bankInfo = this._bankInfoMarshaller.extract(dbCause['cause_bank_info']);
        cause.timeCreated = new Date(dbCause['cause_time_created']);
        cause.timeLastUpdated = new Date(dbCause['cause_time_last_updated']);

        return cause;
    }

    async deleteCause(session: Session, requestTime: Date): Promise<void> {
        await this._conn.transaction(async (trx) => {
            const dbIds = await trx
                .from('core.cause')
                .where({ user_id: (session.user as User).id, state: CauseState.Active })
                .update({
                    'state': CauseState.Removed,
                    'time_last_updated': requestTime,
                    'time_removed': requestTime
                }, 'id') as number[];

            if (dbIds.length == 0) {
                throw new CauseNotFoundError('Cause does not exist');
            }

            const dbId = dbIds[0];

            await trx
                .from('core.cause_event')
                .returning('id')
                .insert({
                    'type': CauseEventType.Removed,
                    'timestamp': requestTime,
                    'data': null,
                    'cause_id': dbId
                });
        });
    }

    async createDonation(authInfo: AuthInfo, session: Session, causeId: number, createDonationRequest: CreateDonationRequest, requestTime: Date): Promise<DonationForSession> {
        let dbCause: any | null = null;
        let dbId: number = -1;

        await this._conn.transaction(async (trx) => {
            const dbCauses = await trx
                .from('core.cause')
                .select(Repository._causePublicFields)
                .where({ id: causeId, state: CauseState.Active })
                .limit(1);

            if (dbCauses.length == 0) {
                throw new CauseNotFoundError('Cause does not exist');
            }

            dbCause = dbCauses[0];

            const dbIds = await trx
                .from('core.donation')
                .returning('id')
                .insert({
                    'amount': this._currencyAmountMarshaller.pack(createDonationRequest.amount),
                    'cause_id': causeId,
                    'session_id': session.hasUser() ? null : authInfo.sessionId,
                    'user_id': session.hasUser() ? (session.user as User).id : null,
                    'time_created': requestTime
                });

            dbId = dbIds[0];

            await trx
                .from('core.donation_event')
                .returning('id')
                .insert({
                    'type': DonationEventType.Created,
                    'timestamp': requestTime,
                    'data': this._createDonationRequestMarshaller.pack(createDonationRequest),
                    'donation_id': dbId
                });
        });

        const cause = new PublicCause();
        cause.id = dbCause['cause_id'];
        cause.state = dbCause['cause_state'];
        cause.slug = Repository._latestSlug(dbCause['cause_slugs'].slugs);
        cause.title = dbCause['cause_title'];
        cause.description = dbCause['cause_description'];
        cause.pictureSet = this._pictureSetMarshaller.extract(dbCause['cause_picture_set']);
        cause.deadline = dbCause['cause_deadline'];
        cause.goal = this._currencyAmountMarshaller.extract(dbCause['cause_goal']);
        cause.timeCreated = new Date(dbCause['cause_time_created']);
        cause.timeLastUpdated = new Date(dbCause['cause_time_last_updated']);

        const donationForSession = new DonationForSession();
        donationForSession.id = dbId as number;
        donationForSession.amount = createDonationRequest.amount;
        donationForSession.forCause = cause;
        donationForSession.timeCreated = requestTime;

        return donationForSession;
    }

    async createShare(authInfo: AuthInfo, session: Session, causeId: number, createShareRequest: CreateShareRequest, requestTime: Date): Promise<ShareForSession> {
        // Create share
        let dbCause: any | null = null;
        let dbId: number = -1;

        await this._conn.transaction(async (trx) => {
            const dbCauses = await trx
                .from('core.cause')
                .select(Repository._causePublicFields)
                .where({ id: causeId, state: CauseState.Active })
                .limit(1);

            if (dbCauses.length == 0) {
                throw new CauseNotFoundError('Cause does not exist');
            }

            dbCause = dbCauses[0];

            const dbIds = await trx
                .from('core.share')
                .returning('id')
                .insert({
                    'time_created': requestTime,
                    'cause_id': causeId,
                    'session_id': session.hasUser() ? null : authInfo.sessionId,
                    'user_id': session.hasUser() ? (session.user as User).id : null,
                    'facebook_post_id': createShareRequest.facebookPostId
                });

            dbId = dbIds[0];

            await trx
                .from('core.share_event')
                .returning('id')
                .insert({
                    'type': ShareEventType.Created,
                    'timestamp': requestTime,
                    'data': this._createShareRequestMarshaller.pack(createShareRequest),
                    'share_id': dbId
                });
        });

        const cause = new PublicCause();
        cause.id = dbCause['cause_id'];
        cause.state = dbCause['cause_state'];
        cause.slug = Repository._latestSlug(dbCause['cause_slugs'].slugs);
        cause.title = dbCause['cause_title'];
        cause.description = dbCause['cause_description'];
        cause.pictureSet = this._pictureSetMarshaller.extract(dbCause['cause_picture_set']);
        cause.deadline = dbCause['cause_deadline'];
        cause.goal = this._currencyAmountMarshaller.extract(dbCause['cause_goal']);
        cause.timeCreated = new Date(dbCause['cause_time_created']);
        cause.timeLastUpdated = new Date(dbCause['cause_time_last_updated']);

        const shareForSession = new ShareForSession();
        shareForSession.id = dbId as number;
        shareForSession.forCause = cause;
        shareForSession.facebookPostId = createShareRequest.facebookPostId;
        shareForSession.timeCreated = requestTime;

        return shareForSession;
    }

    async getCauseAnalytics(session: Session): Promise<CauseAnalytics> {
        const dbCauses = await this._conn('core.cause')
            .select(['id', 'goal', 'deadline'])
            .where({ user_id: (session.user as User).id, state: CauseState.Active })
            .limit(1);

        if (dbCauses.length == 0) {
            throw new CauseNotFoundError('Cause does not exist');
        }

        const dbCause = dbCauses[0];

        // Yay, an analytics query.
        const rawDonationsAnalytics = await this._conn.raw(`
                select
                    count(distinct D.user_id) as donors_count,
                    count(D.id) as donations_count,
                    sum(json_extract_path_text(D.amount, 'amount')::numeric) as amount_donated
                from core.cause as C
                join core.donation as D
                on C.id = D.cause_id
                where C.id = ?
            `, [dbCause['id']]);

        const dbDonationsAnalytics = rawDonationsAnalytics.rows[0];

        const rawSharesAnalytics = await this._conn.raw(`
                select
                    count(distinct S.user_id) as sharers_count,
                    count(S.id) as shares_count
                from core.cause as C
                join core.share as S
                on C.id = S.cause_id
                where C.id = ?
            `, [dbCause['id']]);

        const dbSharesAnalytics = rawSharesAnalytics.rows[0];

        const causeAnalytics = new CauseAnalytics();
        causeAnalytics.daysLeft = Math.max(0, moment.utc(dbCause['deadline']).diff(moment.utc(), 'days'));
        causeAnalytics.donorsCount = parseInt(dbDonationsAnalytics['donors_count']);
        causeAnalytics.donationsCount = parseInt(dbDonationsAnalytics['donations_count']);
        causeAnalytics.amountDonated = new CurrencyAmount();
        causeAnalytics.amountDonated.amount = dbDonationsAnalytics['amount_donated'] != null ? parseInt(dbDonationsAnalytics['amount_donated']) : 0;
        causeAnalytics.amountDonated.currency = this._currencyAmountMarshaller.extract(dbCause['goal']).currency;
        causeAnalytics.sharersCount = parseInt(dbSharesAnalytics['sharers_count']);
        causeAnalytics.sharesCount = parseInt(dbSharesAnalytics['shares_count']);
        causeAnalytics.sharesReach = 0;

        return causeAnalytics;
    }

    async getUserActionsOverview(session: Session): Promise<UserActionsOverview> {
        const user = session.user as User;

        const dbDonationsCount = await this._conn('core.donation')
            .where({ 'core.donation.user_id': user.id })
            .count();
        const dbSharesCount = await this._conn('core.share')
            .where({ 'core.share.user_id': user.id })
            .count();
        const dbRawAmountsDonatedByCurrency = await this._conn.raw(`
                select
                    cast(amount->'currency' as text) as currency,
                    sum(cast(amount->>'amount' as int)) as amount
                from core.donation
                where user_id = ?
                group by cast(amount->'currency' as text);`,
            [user.id]);
        const dbLatestDonations = await this._conn('core.donation')
            .join('core.cause', 'core.donation.cause_id', '=', 'core.cause.id')
            .where({ 'core.donation.user_id': user.id })
            .select(Repository._donationFields.concat(Repository._causePublicFields))
            .orderBy('donation_time_created', 'desc')
            .limit(Repository.MAX_NUMBER_OF_DONATIONS) as any[];
        const dbLatestShares = await this._conn('core.share')
            .join('core.cause', 'core.share.cause_id', '=', 'core.cause.id')
            .where({ 'core.share.user_id': user.id })
            .select(Repository._shareFields.concat(Repository._causePublicFields))
            .orderBy('share_time_created', 'desc')
            .limit(Repository.MAX_NUMBER_OF_SHARES) as any[];

        // Return value.
        const latestDonations = dbLatestDonations.map((dbD) => {
            const cause = new PublicCause();
            cause.id = dbD['cause_id'];
            cause.state = dbD['cause_state'];
            cause.timeCreated = new Date(dbD['cause_time_created']);
            cause.timeLastUpdated = new Date(dbD['cause_time_last_updated']);
            cause.slug = Repository._latestSlug(dbD['cause_slugs'].slugs);
            cause.title = dbD['cause_title'];
            cause.description = dbD['cause_description'];
            cause.pictureSet = this._pictureSetMarshaller.extract(dbD['cause_picture_set']);
            cause.deadline = dbD['cause_deadline'];
            cause.goal = this._currencyAmountMarshaller.extract(dbD['cause_goal']);

            const donationForSession = new DonationForSession();
            donationForSession.id = dbD['donation_id'];
            donationForSession.timeCreated = dbD['donation_time_created'];
            donationForSession.forCause = cause;
            donationForSession.amount = this._currencyAmountMarshaller.extract(dbD['donation_amount']);

            return donationForSession;
        });

        const latestShares = dbLatestShares.map((dbD) => {
            const cause = new PublicCause();
            cause.id = dbD['cause_id'];
            cause.state = dbD['cause_state'];
            cause.slug = Repository._latestSlug(dbD['cause_slugs'].slugs);
            cause.title = dbD['cause_title'];
            cause.description = dbD['cause_description'];
            cause.pictureSet = this._pictureSetMarshaller.extract(dbD['cause_picture_set']);
            cause.deadline = dbD['cause_deadline'];
            cause.goal = this._currencyAmountMarshaller.extract(dbD['cause_goal']);
            cause.timeCreated = new Date(dbD['cause_time_created']);
            cause.timeLastUpdated = new Date(dbD['cause_time_last_updated']);

            const shareForSession = new ShareForSession();
            shareForSession.id = dbD['share_id'];
            shareForSession.forCause = cause;
            shareForSession.facebookPostId = dbD['share_facebook_post_id'];
            shareForSession.timeCreated = dbD['share_time_created'];

            return shareForSession;
        });

        const userActionsOverview = new UserActionsOverview();
        userActionsOverview.donationsCount = (Number as any).parseInt(dbDonationsCount[0].count);
        userActionsOverview.amountsDonatedByCurrency =
            dbRawAmountsDonatedByCurrency.rows.map((r: any) => {
                const rawAmount = {
                    amount: JSON.parse(r['amount']),
                    currency: JSON.parse(r['currency'])
                };

                return this._currencyAmountMarshaller.extract(rawAmount)
            });
        userActionsOverview.sharesCount = (Number as any).parseInt(dbSharesCount[0].count);
        userActionsOverview.latestDonations = latestDonations;
        userActionsOverview.latestShares = latestShares;

        return userActionsOverview;
    }

    private static _latestSlug(slugs: any[]): string {
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
}
