import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { PROTOCOL } from "../protocol/schema.js";

export type PairingFailure = "invalid_code" | "expired_code" | "rate_limited";

export interface PairedClient {
  clientId: string;
  token: string;
  pairedAt: number;
}

export function authenticationTranscript(
  clientId: string,
  sessionId: string,
  nonce: string
): string {
  return `${PROTOCOL}\nauthenticate\n${clientId}\n${sessionId}\n${nonce}`;
}

export function createAuthenticationChallenge(): string {
  return randomBytes(32).toString("base64url");
}

export function createAuthenticationProof(
  token: string,
  clientId: string,
  sessionId: string,
  nonce: string
): string {
  return createHmac("sha256", Buffer.from(token, "base64url"))
    .update(authenticationTranscript(clientId, sessionId, nonce), "utf8")
    .digest("base64url");
}

interface PairingCode {
  value: string;
  expiresAt: number;
}

export class PairingManager {
  readonly #clients = new Map<string, PairedClient>();
  readonly #attempts = new Map<string, number[]>();
  #globalAttempts: number[] = [];
  #code: PairingCode | undefined;

  constructor(
    clients: PairedClient[] = [],
    private readonly now: () => number = Date.now
  ) {
    for (const client of clients) this.#clients.set(client.clientId, client);
  }

  issueCode(): { code: string; expiresAt: number } {
    const value = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const expiresAt = this.now() + 5 * 60_000;
    this.#code = { value, expiresAt };
    this.#attempts.clear();
    this.#globalAttempts = [];
    return { code: value, expiresAt };
  }

  pair(clientId: string, code: string): { token?: string; error?: PairingFailure } {
    if (this.isRateLimited(clientId) || this.isGloballyRateLimited()) {
      return { error: "rate_limited" };
    }
    this.recordAttempt(clientId);
    if (!this.#code) return { error: "invalid_code" };
    if (this.now() > this.#code.expiresAt) {
      this.#code = undefined;
      return { error: "expired_code" };
    }
    if (!safeEqual(code, this.#code.value)) return { error: "invalid_code" };

    const token = randomBytes(32).toString("base64url");
    this.#clients.set(clientId, { clientId, token, pairedAt: this.now() });
    this.#code = undefined;
    this.#attempts.delete(clientId);
    return { token };
  }

  verifyProof(clientId: string, sessionId: string, nonce: string, proof: string): boolean {
    const token = this.#clients.get(clientId)?.token;
    if (!token) return false;
    const expected = createAuthenticationProof(token, clientId, sessionId, nonce);
    return safeEqual(expected, proof);
  }

  unpair(clientId: string): boolean {
    return this.#clients.delete(clientId);
  }

  list(): PairedClient[] {
    return [...this.#clients.values()].map((client) => ({ ...client }));
  }

  private recordAttempt(clientId: string): void {
    const cutoff = this.now() - 60_000;
    const attempts = (this.#attempts.get(clientId) ?? []).filter((attempt) => attempt >= cutoff);
    attempts.push(this.now());
    this.#attempts.set(clientId, attempts);
    this.#globalAttempts = this.#globalAttempts.filter((attempt) => attempt >= cutoff);
    this.#globalAttempts.push(this.now());
  }

  private isRateLimited(clientId: string): boolean {
    const cutoff = this.now() - 60_000;
    return (this.#attempts.get(clientId) ?? []).filter((attempt) => attempt >= cutoff).length >= 5;
  }

  private isGloballyRateLimited(): boolean {
    const cutoff = this.now() - 60_000;
    this.#globalAttempts = this.#globalAttempts.filter((attempt) => attempt >= cutoff);
    return this.#globalAttempts.length >= 20;
  }
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
