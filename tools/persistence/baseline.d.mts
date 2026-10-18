export declare const POSTGRES_IMAGE_TAG: string;
export declare const POSTGRES_IMAGE_DIGEST: string;
export declare const POSTGRES_REPOSITORY: string;
export declare const FLYWAY_IMAGE_TAG: string;
export declare const FLYWAY_IMAGE_DIGEST: string;
export declare const FLYWAY_REPOSITORY: string;
export declare const CONTROLLED_KEYCLOAK_IMAGE: string;
export declare const CONTROLLED_KEYCLOAK_VERSION_TAG: string;
export declare const POSTGRESQL_MAJOR: number;
export declare const POSTGRESQL_MINOR: number;
export declare const DATABASE_NAME: string;
export declare const DATABASE_USERNAME: string;
export declare const MIGRATIONS_DIR: string;

export declare function imageReference(repository: string, tag: string, digest: string): string;
export declare function postgresImageReference(): string;
export declare function flywayImageReference(): string;
export declare function assertRepoDigestMatches(
  inspectOutput: { RepoDigests?: string[] } | undefined | null,
  repository: string,
  tag: string,
  digest: string,
): boolean;
export declare function assertTagMatchesDigest(
  tag: string,
  resolvedDigest: string,
  pinnedDigest: string,
): boolean;
export declare function expectedServerVersionNum(): string;
export declare function assertServerVersion(serverVersionNum: string): boolean;
