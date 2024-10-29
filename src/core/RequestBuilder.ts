import { v4 as uuidv4 } from "uuid";
import { IRequest } from "../interfaces";

export class RequestBuilder<T> {
  private request: IRequest<T>;

  constructor(body: T) {
    this.request = {
      header: {
        timestamp: Date.now(),
        requestId: uuidv4(),
        requesterAddress: "",
        requestType: "",
      },
      body,
    };
  }

  // Basic header setters
  public setRequesterAddress(address: string): this {
    this.request.header.requesterAddress = address;
    return this;
  }

  public setRecipientAddress(address: string): this {
    this.request.header.recipientAddress = address;
    return this;
  }

  public setRequestType(type: string): this {
    this.request.header.requestType = type;
    return this;
  }

  public setSessionId(sessionId: string): this {
    this.request.header.sessionId = sessionId;
    return this;
  }

  public setRequiresResponse(requires: boolean): this {
    this.request.header.requiresResponse = requires;
    return this;
  }

  // Authentication related setters
  public setAuthToken(token: string): this {
    this.request.header.authToken = token;
    return this;
  }

  public setRefreshToken(token: string): this {
    this.request.header.refreshToken = token;
    return this;
  }

  // Auth metadata manipulation
  public initAuthMetadata(): this {
    if (!this.request.header.authMetadata) {
      this.request.header.authMetadata = {};
    }
    return this;
  }

  public setRoles(roles: string[]): this {
    this.initAuthMetadata();
    this.request.header.authMetadata!.roles = roles;
    return this;
  }

  public addRole(role: string): this {
    this.initAuthMetadata();
    const roles = this.request.header.authMetadata!.roles || [];
    if (!roles.includes(role)) {
      roles.push(role);
    }
    this.request.header.authMetadata!.roles = roles;
    return this;
  }

  public setPermissions(permissions: string[]): this {
    this.initAuthMetadata();
    this.request.header.authMetadata!.permissions = permissions;
    return this;
  }

  public addPermission(permission: string): this {
    this.initAuthMetadata();
    const permissions = this.request.header.authMetadata!.permissions || [];
    if (!permissions.includes(permission)) {
      permissions.push(permission);
    }
    this.request.header.authMetadata!.permissions = permissions;
    return this;
  }

  public setScope(scope: string[]): this {
    this.initAuthMetadata();
    this.request.header.authMetadata!.scope = scope;
    return this;
  }

  public setAuthMetadataField(key: string, value: unknown): this {
    this.initAuthMetadata();
    this.request.header.authMetadata![key] = value;
    return this;
  }

  // Timestamp manipulation
  public setTimestamp(timestamp: number): this {
    this.request.header.timestamp = timestamp;
    return this;
  }

  public updateTimestamp(): this {
    this.request.header.timestamp = Date.now();
    return this;
  }

  // Request ID manipulation
  public setRequestId(id: string): this {
    this.request.header.requestId = id;
    return this;
  }

  public regenerateRequestId(): this {
    this.request.header.requestId = uuidv4();
    return this;
  }

  // Body manipulation
  public setBody(body: T): this {
    this.request.body = body;
    return this;
  }

  public updateBody(updater: (body: T) => T): this {
    this.request.body = updater(this.request.body);
    return this;
  }

  // Build methods
  public build(): IRequest<T> {
    return { ...this.request };
  }

  public clone(): RequestBuilder<T> {
    const builder = new RequestBuilder<T>(this.request.body);
    builder.request = JSON.parse(JSON.stringify(this.request));
    return builder;
  }

  // Static creators
  public static from<T>(request: IRequest<T>): RequestBuilder<T> {
    const builder = new RequestBuilder<T>(request.body);
    builder.request = JSON.parse(JSON.stringify(request));
    return builder;
  }

  public static createSimple<T>(
    requesterAddress: string,
    requestType: string,
    body: T,
    recipientAddress?: string
  ): IRequest<T> {
    return new RequestBuilder(body)
      .setRequesterAddress(requesterAddress)
      .setRequestType(requestType)
      .setRecipientAddress(recipientAddress || "")
      .build();
  }
}
