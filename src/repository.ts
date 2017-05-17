import * as knex from 'knex'
import { Marshaller, MarshalFrom, SlugMarshaller } from 'raynor'

import { slugify } from '@neoncity/common-js'
import { BankInfo,
	 BankInfoMarshaller,
	 CauseEvent,
	 CauseEventType,
	 CauseAnalytics,
	 CauseState,
	 CreateCauseRequest,
	 CreateDonationRequest,
	 CreateShareRequest,
	 CurrencyAmount,
	 DonationForUser,
	 DonationEventType,
	 PictureSet,
	 PictureSetMarshaller,
	 PrivateCause,
	 PublicCause,
	 ShareForUser,
	 ShareEventType,
	 UpdateCauseRequest,
	 UserActionsOverview } from '@neoncity/core-sdk-js'
import { User } from '@neoncity/identity-sdk-js'


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


export class Repository {
    private static readonly _causePublicFields = [
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

    private static readonly _causePrivateFields = Repository._causePublicFields.concat('core.cause.bank_info as cause_bank_info');

    private static readonly _causeEventFields = [
    	'core.cause_event.id as cause_event_id',
    	'core.cause_event.type as cause_event_type',
    	'core.cause_event.timestamp as cause_event_timestamp',
    	'core.cause_event.data as cause_event_data'
    ];

    private static readonly _donationFields = [
    	'core.donation.id as donation_id',
    	'core.donation.time_created as donation_time_created',
    	'core.donation.cause_id as donation_cause_id',
    	'core.donation.user_id as donation_user_id',
    	'core.donation.amount as donation_amount'
    ];

    private static readonly _shareFields = [
    	'core.share.id as share_id',
    	'core.share.time_created as share_time_created',
    	'core.share.cause_id as share_cause_id',
    	'core.share.user_id as share_user_id',
        'core.share.facebook_post_id as facebook_post_id'
    ];

    private readonly _conn: knex;
    private readonly _createCauseRequestMarshaller: Marshaller<CreateCauseRequest>;
    private readonly _updateCauseRequestMarshaller: Marshaller<UpdateCauseRequest>;
    private readonly _createDonationRequestMarshaller: Marshaller<CreateDonationRequest>;
    private readonly _createShareRequestMarshaller: Marshaller<CreateShareRequest>;    
    private readonly _pictureSetMarshaller: Marshaller<PictureSet>;
    private readonly _currencyAmountMarshaller: Marshaller<CurrencyAmount>;
    private readonly _bankInfoMarshaller: BankInfoMarshaller;
    private readonly _slugMarshaller: SlugMarshaller;

    constructor(conn: knex) {
	this._conn = conn;
	this._createCauseRequestMarshaller = new (MarshalFrom(CreateCauseRequest))();
	this._updateCauseRequestMarshaller = new (MarshalFrom(UpdateCauseRequest))();
	this._createDonationRequestMarshaller = new (MarshalFrom(CreateDonationRequest))();
	this._createShareRequestMarshaller = new (MarshalFrom(CreateShareRequest))();
	this._pictureSetMarshaller = new PictureSetMarshaller();
	this._currencyAmountMarshaller = new (MarshalFrom(CurrencyAmount))();
	this._bankInfoMarshaller = new BankInfoMarshaller();
	this._slugMarshaller = new SlugMarshaller();
    }

    async getPublicCauses(): Promise<PublicCause[]> {
	const dbCauses = await this._conn('core.cause')
	      .select(Repository._causePublicFields)
	      .where({state: CauseState.Active})
	      .orderBy('time_created', 'desc') as any[];

	return dbCauses.map((dbC: any) => {
	    const cause = new PublicCause();
	    cause.id = dbC['cause_id'];
	    cause.state = dbC['cause_state'];
	    cause.timeCreated = new Date(dbC['cause_time_created']);
	    cause.timeLastUpdated = new Date(dbC['cause_time_last_updated']);
	    cause.slug = Repository._latestSlug(dbC['cause_slugs'].slugs);
	    cause.title = dbC['cause_title'];
	    cause.description = dbC['cause_description'];
	    cause.pictureSet = this._pictureSetMarshaller.extract(dbC['cause_picture_set']);
	    cause.deadline = dbC['cause_deadline'];
	    cause.goal = this._currencyAmountMarshaller.extract(dbC['cause_goal']);

	    return cause;
	});
    }

    async getPublicCause(causeId: number): Promise<PublicCause> {
	const dbCauses = await this._conn('core.cause')
	      .select(Repository._causePublicFields)
	      .where({id: causeId, state: CauseState.Active})
	      .limit(1);

	if (dbCauses.length == 0) {
	    throw new CauseNotFoundError('Cause does not exist');
	}

	const dbCause = dbCauses[0];

	const cause = new PublicCause();
	cause.id = dbCause['cause_id'];
	cause.state = dbCause['cause_state'];
	cause.timeCreated = new Date(dbCause['cause_time_created']);
	cause.timeLastUpdated = new Date(dbCause['cause_time_last_updated']);
	cause.slug = Repository._latestSlug(dbCause['cause_slugs'].slugs);
	cause.title = dbCause['cause_title'];
	cause.description = dbCause['cause_description'];
	cause.pictureSet = this._pictureSetMarshaller.extract(dbCause['cause_picture_set']);
	cause.deadline = dbCause['cause_deadline'];
	cause.goal = this._currencyAmountMarshaller.extract(dbCause['cause_goal']);

	return cause;
    }

    async createCause(user: User, createCauseRequest: CreateCauseRequest, requestTime: Date): Promise<PrivateCause> {
	// Check deadline is appropriate.
	// TODO: do it

	// Create slug.
	const slug = slugify(createCauseRequest.title);

	try {
	    this._slugMarshaller.extract(slug);
	} catch (e) {
	    throw new InvalidCausePropertiesError('Title cannot be slugified');
	}

	const slugs = {slugs: [{slug: slug, timeCreated: requestTime.getTime()}]};
	
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
			  'user_id': user.id,
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
	cause.timeCreated = requestTime;
	cause.timeLastUpdated = requestTime;
	cause.slug = slug;
	cause.title = createCauseRequest.title;
	cause.description = createCauseRequest.description;
	cause.pictureSet = createCauseRequest.pictureSet;
	cause.deadline = createCauseRequest.deadline;
	cause.goal = createCauseRequest.goal;
	cause.bankInfo = createCauseRequest.bankInfo;

	return cause;
    }

    async getCause(user: User): Promise<PrivateCause> {
	const dbCauses = await this._conn('core.cause')
	      .select(Repository._causePrivateFields)
	      .where({user_id: user.id})
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
	cause.timeCreated = new Date(dbCause['cause_time_created']);
	cause.timeLastUpdated = new Date(dbCause['cause_time_last_updated']);
	cause.slug = Repository._latestSlug(dbCause['cause_slugs'].slugs);
	cause.title = dbCause['cause_title'];
	cause.description = dbCause['cause_description'];
	cause.pictureSet = this._pictureSetMarshaller.extract(dbCause['cause_picture_set']);
	cause.deadline = dbCause['cause_deadline'];
	cause.goal = this._currencyAmountMarshaller.extract(dbCause['cause_goal']);
	cause.bankInfo = this._bankInfoMarshaller.extract(dbCause['cause_bank_info']);

	return cause;
    }

    async updateCause(user: User, updateCauseRequest: UpdateCauseRequest, requestTime: Date): Promise<PrivateCause> {
	// TODO: verify deadlline is OK.

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
            updateDict['deadline'] = updateCauseRequest.deadline;
        }

        if (updateCauseRequest.hasOwnProperty('goal')) {
            updateDict['goal'] = this._currencyAmountMarshaller.pack(updateCauseRequest.goal as CurrencyAmount);
        }

        if (updateCauseRequest.hasOwnProperty('bankInfo')) {
            updateDict['bank_info'] = this._bankInfoMarshaller.pack(updateCauseRequest.bankInfo as BankInfo);
        }

	// Update the cause of this user.
	let dbCause: any|null = null;
	await this._conn.transaction(async (trx) => {
	    const dbCauses = await trx
		  .from('core.cause')
		  .where({user_id: user.id})
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
	cause.timeCreated = new Date(dbCause['cause_time_created']);
	cause.timeLastUpdated = new Date(dbCause['cause_time_last_updated']);
	cause.slug = Repository._latestSlug(dbCause['cause_slugs'].slugs);
	cause.title = dbCause['cause_title'];
	cause.description = dbCause['cause_description'];
	cause.pictureSet = this._pictureSetMarshaller.extract(dbCause['cause_picture_set']);
	cause.deadline = dbCause['cause_deadline'];
	cause.goal = this._currencyAmountMarshaller.extract(dbCause['cause_goal']);
	cause.bankInfo = this._bankInfoMarshaller.extract(dbCause['cause_bank_info']);

	return cause;
    }

    async deleteCause(user: User, requestTime: Date): Promise<void> {
	await this._conn.transaction(async (trx) => {
	    const dbIds = await trx
		  .from('core.cause')
		  .where({user_id: user.id, state: CauseState.Active})
		  .update({
		      'state': CauseState.Removed,
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

    async getCauseEvents(user: User): Promise<CauseEvent[]> {
	const dbCauses = await this._conn('core.cause')
	      .select(['id'])
	      .where({user_id: user.id, state: CauseState.Active})
	      .limit(1);

	if (dbCauses.length == 0) {
	    throw new CauseNotFoundError('Cause does not exist');
	}

	const dbCauseId = dbCauses[0]['id'];

        const dbCauseEvents = await this._conn('core.cause_event')
              .select(Repository._causeEventFields)
              .where({cause_id: dbCauseId})
              .orderBy('timestamp', 'asc') as any[];

        if (dbCauseEvents.length == 0) {
	    throw new CauseNotFoundError('Cause does not have any events');
        }

	// Return joined value from auth0 and db

        const causeEvents = dbCauseEvents.map(dbCE => {
            const causeEvent = new CauseEvent();
            causeEvent.id = dbCE['cause_event_id'];
            causeEvent.type = dbCE['cause_event_type'];
            causeEvent.timestamp = dbCE['cause_event_timestamp'];
            causeEvent.data =
		causeEvent.type == CauseEventType.Created ? this._createCauseRequestMarshaller.extract(dbCE['cause_event_data'])
		: causeEvent.type == CauseEventType.Updated ? this._updateCauseRequestMarshaller.extract(dbCE['cause_event_data'])
		: dbCE['cause_event_data'];
            return causeEvent;
        });

	return causeEvents;
    }

    async createDonation(user: User, causeId: number, createDonationRequest: CreateDonationRequest, requestTime: Date): Promise<DonationForUser> {
	let dbCause: any|null = null;
	let dbId: number = -1;
	
	await this._conn.transaction(async (trx) => {
	    const dbCauses = await trx
		  .from('core.cause')
		  .select(Repository._causePublicFields)
		  .where({id: causeId, state: CauseState.Active});

	    if (dbCauses.length == 0) {
		throw new CauseNotFoundError('Cause does not exist');
	    }

	    dbCause = dbCauses[0];

	    const dbIds = await trx
		  .from('core.donation')
		  .returning('id')
		  .insert({
		      'time_created': requestTime,
		      'amount': this._currencyAmountMarshaller.pack(createDonationRequest.amount),
		      'cause_id': causeId,
		      'user_id': user.id
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
	cause.timeCreated = new Date(dbCause['cause_time_created']);
	cause.timeLastUpdated = new Date(dbCause['cause_time_last_updated']);
	cause.slug = Repository._latestSlug(dbCause['cause_slugs'].slugs);
	cause.title = dbCause['cause_title'];
	cause.description = dbCause['cause_description'];
	cause.pictureSet = this._pictureSetMarshaller.extract(dbCause['cause_picture_set']);
	cause.deadline = dbCause['cause_deadline'];
	cause.goal = this._currencyAmountMarshaller.extract(dbCause['cause_goal']);

	const donationForUser = new DonationForUser();
	donationForUser.id = dbId as number;
	donationForUser.timeCreated = requestTime;
	donationForUser.forCause = cause;
	donationForUser.amount = createDonationRequest.amount;

	return donationForUser;
    }

    async createShare(user: User, causeId: number, createShareRequest: CreateShareRequest, requestTime: Date): Promise<ShareForUser> {
	// Create share
	let dbCause: any|null = null;
	let dbId: number = -1;
	
	await this._conn.transaction(async (trx) => {
	    const dbCauses = await trx
		  .from('core.cause')
		  .select(Repository._causePublicFields)
		  .where({id: causeId, state: CauseState.Active});

	    if (dbCauses.length == 0) {
		throw new CauseNotFoundError('Cause does not exist');
	    }

	    dbCause = dbCauses[0];

	    const dbIds = await trx
		  .from('core.share')
		  .returning('id')
		  .insert({
		      'time_created': requestTime,
                      'facebook_post_id': createShareRequest.facebookPostId,
		      'cause_id': causeId,
		      'user_id': user.id
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
	cause.timeCreated = new Date(dbCause['cause_time_created']);
	cause.timeLastUpdated = new Date(dbCause['cause_time_last_updated']);
	cause.slug = Repository._latestSlug(dbCause['cause_slugs'].slugs);
	cause.title = dbCause['cause_title'];
	cause.description = dbCause['cause_description'];
	cause.pictureSet = this._pictureSetMarshaller.extract(dbCause['cause_picture_set']);
	cause.deadline = dbCause['cause_deadline'];
	cause.goal = this._currencyAmountMarshaller.extract(dbCause['cause_goal']);

	const shareForUser = new ShareForUser();
	shareForUser.id = dbId as number;
	shareForUser.timeCreated = requestTime;
	shareForUser.forCause = cause;
        shareForUser.facebookPostId = createShareRequest.facebookPostId;

	return shareForUser;
    }

    async getCauseAnalytics(user: User): Promise<CauseAnalytics> {
	const dbCauses = await this._conn('core.cause')
	      .select(['id', 'goal'])
	      .where({user_id: user.id, state: CauseState.Active})
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
	causeAnalytics.daysLeft = 0;
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

    async getActionsOverview(user: User): Promise<UserActionsOverview> {
	const dbDonations = await this._conn('core.donation')
	      .join('core.cause', 'core.donation.cause_id', '=', 'core.cause.id')
		.where({'core.donation.user_id': user.id})
	      .select(Repository._donationFields.concat(Repository._causePublicFields)) as any[];

	const dbShares = await this._conn('core.share')
	      .join('core.cause', 'core.share.cause_id', '=', 'core.cause.id')
	      .where({'core.share.user_id': user.id})
	      .select(Repository._shareFields.concat(Repository._causePublicFields)) as any[];

	// Return value.
	const donations = dbDonations.map((dbD) => {
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

	    const donationForUser = new DonationForUser();
	    donationForUser.id = dbD['donation_id'];
	    donationForUser.timeCreated = dbD['donation_time_created'];
	    donationForUser.forCause = cause;
	    donationForUser.amount = this._currencyAmountMarshaller.extract(dbD['donation_amount']);

	    return donationForUser;
	});

	const shares = dbShares.map((dbD) => {
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
