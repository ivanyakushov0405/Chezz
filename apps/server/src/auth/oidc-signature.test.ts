// Подпись ID-токена (SECURITY §4 п.4, MUST): обмен code через openid-client с подменой HTTP — без сети и без Google.
import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { codeChallenge, createGoogleProvider, randomCodeVerifier } from "./oidc.ts";

const CLIENT = { clientId: "client-1.apps.googleusercontent.com", clientSecret: "test-secret" };
const NONCE = "nonce-1";
const STATE = "state-1";
const REDIRECT = "https://chezz.test/auth/google/callback";
const KID = "google-key-1";

const b64 = (v: object): string => Buffer.from(JSON.stringify(v)).toString("base64url");

function signRs256(payload: object, key: KeyObject, kid = KID): string {
  const input = `${b64({ alg: "RS256", typ: "JWT", kid })}.${b64(payload)}`;
  const signature = createSign("RSA-SHA256").update(input).sign(key).toString("base64url");
  return `${input}.${signature}`;
}

const google = generateKeyPairSync("rsa", { modulusLength: 2048 });
const attacker = generateKeyPairSync("rsa", { modulusLength: 2048 });

function claims(): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return { iss: "https://accounts.google.com", aud: CLIENT.clientId, sub: "victim-sub", iat: now, exp: now + 600, nonce: NONCE };
}

/** token endpoint отдаёт `idToken`, jwks_uri — открытый ключ Google. */
function fakeGoogle(idToken: string): (url: string) => Promise<Response> {
  const jwk = { ...google.publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" };
  return async (url) => {
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "at", token_type: "Bearer", expires_in: 3600, id_token: idToken });
    }
    if (url.startsWith("https://www.googleapis.com/oauth2/v3/certs")) {
      return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  };
}

async function exchange(idToken: string): Promise<Record<string, unknown>> {
  const provider = createGoogleProvider(CLIENT, { fetch: fakeGoogle(idToken) });
  const verifier = randomCodeVerifier();
  await codeChallenge(verifier);
  const callback = new URL(`${REDIRECT}?code=c-1&state=${STATE}`);
  return provider.exchange(callback, REDIRECT, { state: STATE, nonce: NONCE, code_verifier: verifier });
}

describe("createGoogleProvider: подпись ID-токена", () => {
  it("К-2, К-3: токен, подписанный ключом из JWKS Google, принимается", async () => {
    const result = await exchange(signRs256(claims(), google.privateKey));
    expect(result["sub"]).toBe("victim-sub");
  });

  it("К-2: подпись чужим ключом с kid Google — обмен отклонён", async () => {
    await expect(exchange(signRs256(claims(), attacker.privateKey))).rejects.toThrow();
  });

  it("К-2: подпись испорчена — обмен отклонён", async () => {
    const token = signRs256(claims(), google.privateKey);
    const broken = `${token.slice(0, -4)}${token.endsWith("AAAA") ? "BBBB" : "AAAA"}`;
    await expect(exchange(broken)).rejects.toThrow();
  });

  it("К-2: alg none — обмен отклонён", async () => {
    const unsigned = `${b64({ alg: "none", typ: "JWT" })}.${b64(claims())}.`;
    await expect(exchange(unsigned)).rejects.toThrow();
  });
});
