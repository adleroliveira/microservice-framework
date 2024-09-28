export interface ITable<T = any> {
  get(key: string): Promise<T | null>;
  set(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  update(key: string, field: string, value: any): Promise<void>;
  getAll(): Promise<Map<string, T>>;
  exists(key: string): Promise<boolean>;
}
