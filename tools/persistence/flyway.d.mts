export interface FlywayTarget {
  command: string;
  database: string;
  username: string;
  password: string;
  target?: string;
}

export declare function runFlyway(containerId: string, target: FlywayTarget): Promise<string>;
export declare function flywayVersion(): Promise<string>;
