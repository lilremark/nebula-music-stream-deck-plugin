import { describe, expect, it } from "vitest";
import {
  authenticationTranscript,
  createAuthenticationChallenge,
  createAuthenticationProof,
  PairingManager
} from "../src/core/pairing.js";

describe("PairingManager", () => {
  it("issues a single-use six digit code and verifies challenge-response proof", () => {
    let now = 1_000;
    const pairing = new PairingManager([], () => now);
    const issued = pairing.issueCode();
    expect(issued.code).toMatch(/^\d{6}$/u);
    expect(issued.expiresAt).toBe(301_000);

    const result = pairing.pair("client-1", issued.code);
    expect(result.token).toHaveLength(43);
    const nonce = createAuthenticationChallenge();
    const proof = createAuthenticationProof(result.token ?? "", "client-1", "session-1", nonce);
    expect(pairing.verifyProof("client-1", "session-1", nonce, proof)).toBe(true);
    expect(pairing.verifyProof("client-1", "session-2", nonce, proof)).toBe(false);
    expect(
      pairing.verifyProof("client-1", "session-1", createAuthenticationChallenge(), proof)
    ).toBe(false);
    expect(pairing.verifyProof("unknown", "session-1", nonce, proof)).toBe(false);
    expect(authenticationTranscript("c", "s", "n")).toBe(
      "nebula-streamdeck/1\nauthenticate\nc\ns\nn"
    );
    expect(pairing.pair("client-2", issued.code)).toEqual({ error: "invalid_code" });

    now += 1;
    expect(pairing.list()).toEqual([
      expect.objectContaining({ clientId: "client-1", pairedAt: 1_000 })
    ]);
  });

  it("expires codes after five minutes", () => {
    let now = 10;
    const pairing = new PairingManager([], () => now);
    const { code } = pairing.issueCode();
    now += 300_001;
    expect(pairing.pair("client", code)).toEqual({ error: "expired_code" });
  });

  it("rate limits a client after five failures", () => {
    const pairing = new PairingManager();
    pairing.issueCode();
    for (let index = 0; index < 5; index += 1) {
      expect(pairing.pair("client", "999999").error).toBe("invalid_code");
    }
    expect(pairing.pair("client", "999999")).toEqual({ error: "rate_limited" });
  });

  it("globally rate limits rotating client identifiers", () => {
    const pairing = new PairingManager();
    pairing.issueCode();
    for (let index = 0; index < 20; index += 1) {
      expect(pairing.pair(`client-${index}`, "999999").error).toBe("invalid_code");
    }
    expect(pairing.pair("client-21", "999999")).toEqual({ error: "rate_limited" });
  });

  it("supports unpair and seeded clients", () => {
    const token = Buffer.alloc(32, 1).toString("base64url");
    const pairing = new PairingManager([{ clientId: "a", token, pairedAt: 5 }]);
    const proof = createAuthenticationProof(token, "a", "session", "nonce");
    expect(pairing.verifyProof("a", "session", "nonce", proof)).toBe(true);
    expect(pairing.verifyProof("a", "session", "nonce", "wrong")).toBe(false);
    expect(pairing.unpair("a")).toBe(true);
    expect(pairing.unpair("a")).toBe(false);
  });
});
