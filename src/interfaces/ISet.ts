export interface ISet<T = any> {
  add(key: string, member: T): Promise<boolean>;
  remove(key: string, member: T): Promise<boolean>;
  isMember(key: string, member: T): Promise<boolean>;
  getMembers(key: string): Promise<T[]>;
  count(key: string): Promise<number>;
  intersect(key1: string, key2: string): Promise<T[]>;
  union(key1: string, key2: string): Promise<T[]>;
  difference(key1: string, key2: string): Promise<T[]>;
  getAllKeys(): Promise<string[]>;
}
