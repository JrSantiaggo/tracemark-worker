export interface ObjectStorage {
  /** Returns null when the object does not exist. */
  get(key: string): Promise<Buffer | null>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
}
