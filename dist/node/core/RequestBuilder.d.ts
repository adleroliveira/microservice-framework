import { IRequest } from "../interfaces";
export declare class RequestBuilder<T> {
    private request;
    constructor(body: T);
    setRequesterAddress(address: string): this;
    setRecipientAddress(address: string): this;
    setRequestType(type: string): this;
    setSessionId(sessionId: string): this;
    setRequiresResponse(requires: boolean): this;
    setAuthToken(token: string): this;
    setRefreshToken(token: string): this;
    initAuthMetadata(): this;
    setRoles(roles: string[]): this;
    addRole(role: string): this;
    setPermissions(permissions: string[]): this;
    addPermission(permission: string): this;
    setScope(scope: string[]): this;
    setAuthMetadataField(key: string, value: unknown): this;
    setTimestamp(timestamp: number): this;
    updateTimestamp(): this;
    setRequestId(id: string): this;
    regenerateRequestId(): this;
    setBody(body: T): this;
    updateBody(updater: (body: T) => T): this;
    build(): IRequest<T>;
    clone(): RequestBuilder<T>;
    static from<T>(request: IRequest<T>): RequestBuilder<T>;
    static createSimple<T>(requesterAddress: string, requestType: string, body: T, recipientAddress?: string): IRequest<T>;
}
