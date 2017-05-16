import { wrap } from 'async-middleware'
import * as express from 'express'
import * as HttpStatus from 'http-status-codes'

import { isLocal, Env } from '@neoncity/common-js'
import { IdentityClient } from '@neoncity/identity-sdk-js'

import { CoreRequest } from './core-request'


export function newIdentityMiddleware(env: Env, identityClient: IdentityClient): express.RequestHandler {
    return wrap(async (req: CoreRequest, res: express.Response, next: express.NextFunction) => {
	if (req.authInfo == null) {
	    console.log('No authInfo');
	    res.status(HttpStatus.BAD_REQUEST);
	    res.end();
	    return;
	}

	try {
	    req.user = await identityClient.getUser(req.authInfo.auth0AccessToken);
	} catch (e) {
	    // In lieu of instanceof working
	    if (e.name == 'UnauthorizedIdentityError') {
		console.log('User is unauthorized');
		res.status(HttpStatus.UNAUTHORIZED);
	    } else {
		console.log(`Call to identity service failed - ${e.toString()}`);
		if (isLocal(env)) {
                    console.log(e);
		}
		
		res.status(HttpStatus.INTERNAL_SERVER_ERROR);
	    }
	    
	    res.end();
	    return;
	}

	// Fire away.
        next();
    });
}
