import { IRequestHeader } from "./IRequest";

export interface IResponseData<T> {
  data: T;
  success: boolean;
  error: Error | null;
}

export interface IResponseHeader {
  responderAddress: string;
  timestamp: number;
}

export interface IResponse<T> {
  requestHeader: IRequestHeader;
  responseHeader: IResponseHeader;
  body: IResponseData<T>;
}
