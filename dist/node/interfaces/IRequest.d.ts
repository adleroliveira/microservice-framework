import { IAuthenticationMetadata } from "./auth";
export interface IRequestHeader {
    timestamp: number;
    requestId: string;
    requesterAddress: string;
    recipientAddress?: string;
    requestType?: string;
    authToken?: string;
    refreshToken?: string;
    authMetadata?: IAuthenticationMetadata;
    sessionId?: string;
}
export interface IRequest<T> {
    header: IRequestHeader;
    body: T;
}
export interface IAuthenticationRequest extends IRequest<{
    credentials?: unknown;
    token?: string;
    refreshToken?: string;
}> {
    header: IRequestHeader & {
        requestType: "authenticate" | "refresh" | "logout";
    };
}
