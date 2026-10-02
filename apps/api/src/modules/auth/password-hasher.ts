import { hash, verify } from '@node-rs/argon2';

/** @node-rs/argon2 `Algorithm.Argon2id` (a const enum, which cannot be imported under isolatedModules). */
export const ARGON2ID = 2;

/** Password hashing boundary. Implementations must use a vetted algorithm; never roll our own. */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /** False for a wrong password or an unreadable hash; never throws for bad input. */
  verify(passwordHash: string, password: string): Promise<boolean>;
}

/**
 * Argon2id with the OWASP-recommended baseline (19 MiB memory, 2 iterations, 1 lane).
 * The output is a self-describing PHC string, so parameters can be raised later and old hashes
 * still verify.
 */
export const ARGON2_OPTIONS = Object.freeze({
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
});

export class Argon2PasswordHasher implements PasswordHasher {
  constructor(private readonly options: typeof ARGON2_OPTIONS = ARGON2_OPTIONS) {}

  hash(password: string): Promise<string> {
    return hash(password, this.options);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }
}
