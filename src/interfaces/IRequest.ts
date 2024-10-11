export interface IRequestHeader {
  timestamp: number;
  requestId: string;
  requesterAddress: string;
  recipientAddress?: string;
  requestType?: string;
  authToken?: string;
}

export interface IRequest<T> {
  header: IRequestHeader;
  body: T;
}
