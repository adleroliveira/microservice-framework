export interface InMemoryUser {
  userId: string;
  username: string;
  passwordHash: string;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}
