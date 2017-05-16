import { Request } from '@neoncity/common-server-js'
import { User } from '@neoncity/identity-sdk-js'


export interface CoreRequest extends Request {
    user: User;
}
