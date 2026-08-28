// IM-04 WI-04 (issue #93): replaceable object-storage boundary.
// The Artifact module never treats a caller-provided locator or metadata as
// authoritative; the service validates the provider readback returned here.

export interface ObjectStorageReference {
  readonly storageProvider: string;
  readonly objectLocator: string;
  readonly objectVersionId: string;
}

export interface ObjectStorageReadback extends ObjectStorageReference {
  readonly bytes: Buffer;
  readonly byteSize: number;
  readonly mediaType: string;
}

export interface ObjectStoragePort {
  putStaging(input: {
    readonly objectLocator: string;
    readonly bytes: Buffer;
    readonly mediaType: string;
  }): Promise<ObjectStorageReference>;
  read(reference: ObjectStorageReference): Promise<ObjectStorageReadback>;
  finalize(reference: ObjectStorageReference): Promise<void>;
  delete(reference: ObjectStorageReference): Promise<'DELETED' | 'NOT_FOUND' | 'UNKNOWN'>;
}
