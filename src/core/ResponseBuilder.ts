import { IRequest, IResponse } from "../interfaces";

export class ResponseBuilder<T> {
  private response: IResponse<T>;

  constructor(request: IRequest<any>, data: T) {
    this.response = {
      requestHeader: { ...request.header },
      responseHeader: {
        responderAddress: "",
        timestamp: Date.now(),
      },
      body: {
        data,
        success: true,
        error: null,
      },
    };
  }

  // Basic header setters
  public setResponderAddress(address: string): this {
    this.response.responseHeader.responderAddress = address;
    return this;
  }

  // Authentication token management
  public setNewAuthToken(token: string): this {
    this.response.responseHeader.newAuthToken = token;
    return this;
  }

  public setNewRefreshToken(token: string): this {
    this.response.responseHeader.newRefreshToken = token;
    return this;
  }

  // Auth metadata manipulation
  public initAuthMetadata(): this {
    if (!this.response.responseHeader.authMetadata) {
      this.response.responseHeader.authMetadata = {};
    }
    return this;
  }

  public setRoles(roles: string[]): this {
    this.initAuthMetadata();
    this.response.responseHeader.authMetadata!.roles = roles;
    return this;
  }

  public addRole(role: string): this {
    this.initAuthMetadata();
    const roles = this.response.responseHeader.authMetadata!.roles || [];
    if (!roles.includes(role)) {
      roles.push(role);
    }
    this.response.responseHeader.authMetadata!.roles = roles;
    return this;
  }

  public setPermissions(permissions: string[]): this {
    this.initAuthMetadata();
    this.response.responseHeader.authMetadata!.permissions = permissions;
    return this;
  }

  public addPermission(permission: string): this {
    this.initAuthMetadata();
    const permissions =
      this.response.responseHeader.authMetadata!.permissions || [];
    if (!permissions.includes(permission)) {
      permissions.push(permission);
    }
    this.response.responseHeader.authMetadata!.permissions = permissions;
    return this;
  }

  public setScope(scope: string[]): this {
    this.initAuthMetadata();
    this.response.responseHeader.authMetadata!.scope = scope;
    return this;
  }

  public setAuthMetadataField(key: string, value: unknown): this {
    this.initAuthMetadata();
    this.response.responseHeader.authMetadata![key] = value;
    return this;
  }

  // Response status management
  public setSuccess(success: boolean): this {
    this.response.body.success = success;
    return this;
  }

  public setError(error: Error): this {
    this.response.body.error = error;
    this.response.body.success = false;
    return this;
  }

  public setAuthenticationRequired(required: boolean): this {
    this.response.body.authenticationRequired = required;
    return this;
  }

  public setAuthenticationError(error: string): this {
    this.response.body.authenticationError = error;
    this.response.body.success = false;
    return this;
  }

  public setSessionExpired(expired: boolean): this {
    this.response.body.sessionExpired = expired;
    return this;
  }

  // Timestamp manipulation
  public setTimestamp(timestamp: number): this {
    this.response.responseHeader.timestamp = timestamp;
    return this;
  }

  public updateTimestamp(): this {
    this.response.responseHeader.timestamp = Date.now();
    return this;
  }

  // Data manipulation
  public setData(data: T): this {
    this.response.body.data = data;
    return this;
  }

  public updateData(updater: (data: T) => T): this {
    this.response.body.data = updater(this.response.body.data);
    return this;
  }

  // Build methods
  public build(): IResponse<T> {
    return { ...this.response };
  }

  public clone(): ResponseBuilder<T> {
    const builder = new ResponseBuilder<T>(
      { header: this.response.requestHeader, body: {} },
      this.response.body.data
    );
    builder.response = JSON.parse(JSON.stringify(this.response));
    return builder;
  }

  // Static creators
  public static from<T>(response: IResponse<T>): ResponseBuilder<T> {
    const builder = new ResponseBuilder<T>(
      { header: response.requestHeader, body: {} },
      response.body.data
    );
    builder.response = JSON.parse(JSON.stringify(response));
    return builder;
  }

  // Common response creators
  public static createSuccess<T>(
    request: IRequest<any>,
    responderAddress: string,
    data: T
  ): IResponse<T> {
    return new ResponseBuilder<T>(request, data)
      .setResponderAddress(responderAddress)
      .setSuccess(true)
      .build();
  }

  public static createError<T>(
    request: IRequest<any>,
    responderAddress: string,
    error: Error
  ): IResponse<T> {
    return new ResponseBuilder<T>(request, null as T)
      .setResponderAddress(responderAddress)
      .setError(error)
      .build();
  }

  public static createAuthError<T>(
    request: IRequest<any>,
    responderAddress: string,
    errorMessage: string
  ): IResponse<T> {
    return new ResponseBuilder<T>(request, null as T)
      .setResponderAddress(responderAddress)
      .setAuthenticationRequired(true)
      .setAuthenticationError(errorMessage)
      .build();
  }

  public static createSessionExpired<T>(
    request: IRequest<any>,
    responderAddress: string
  ): IResponse<T> {
    return new ResponseBuilder<T>(request, null as T)
      .setResponderAddress(responderAddress)
      .setSessionExpired(true)
      .setAuthenticationRequired(true)
      .build();
  }
}
