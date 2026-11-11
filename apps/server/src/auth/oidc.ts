// Вход через Google (SECURITY §4, S1): параметры запроса, обмен code и проверка утверждений ID-токена.
// Подпись ID-токена по JWKS Google проверяет openid-client; утверждения (п.4) — verifyIdTokenClaims, unit-тест (TESTING §7.3).
import * as client from "openid-client";
import type { GoogleIdentity } from "../users/service.ts";

export const GOOGLE_ISSUERS: readonly string[] = ["https://accounts.google.com", "accounts.google.com"];
/** Допуск часов для `iat` (SECURITY §4 п.4). */
export const IAT_SKEW_S = 60;

/** Метаданные Google (OIDC discovery): заданы статически — запуск `app` не ходит в сеть. */
const GOOGLE_METADATA: client.ServerMetadata = {
  issuer: "https://accounts.google.com",
  authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  token_endpoint: "https://oauth2.googleapis.com/token",
  jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
};

export interface OidcChecks {
  state: string;
  nonce: string;
  code_verifier: string;
}

/** Внешняя часть входа: ссылка на Google и обмен code → утверждения ID-токена (подпись уже проверена). */
export interface OidcProvider {
  authorizationUrl(params: { redirect_uri: string; state: string; nonce: string; code_challenge: string }): string;
  exchange(callbackUrl: URL, redirectUri: string, checks: OidcChecks): Promise<Record<string, unknown>>;
}

export function createGoogleProvider(google: { clientId: string; clientSecret: string }): OidcProvider {
  const config = new client.Configuration(GOOGLE_METADATA, google.clientId, google.clientSecret);
  return {
    authorizationUrl(params) {
      return client
        .buildAuthorizationUrl(config, {
          redirect_uri: params.redirect_uri,
          response_type: "code",
          scope: "openid email profile",
          state: params.state,
          nonce: params.nonce,
          code_challenge: params.code_challenge,
          code_challenge_method: "S256",
        })
        .toString();
    },
    async exchange(callbackUrl, redirectUri, checks) {
      const tokens = await client.authorizationCodeGrant(
        config,
        callbackUrl,
        { pkceCodeVerifier: checks.code_verifier, expectedState: checks.state, expectedNonce: checks.nonce, idTokenExpected: true },
        { redirect_uri: redirectUri },
      );
      const claims = tokens.claims();
      if (claims === undefined) throw new Error("no id_token");
      return claims as Record<string, unknown>;
    },
  };
}

export const randomState = (): string => client.randomState();
export const randomNonce = (): string => client.randomNonce();
export const randomCodeVerifier = (): string => client.randomPKCECodeVerifier();
export const codeChallenge = (verifier: string): Promise<string> => client.calculatePKCECodeChallenge(verifier);

export type ClaimsResult = { ok: true; identity: GoogleIdentity } | { ok: false; reason: string };

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/**
 * SECURITY §4 п.4 (MUST все пункты): `iss` ∈ GOOGLE_ISSUERS; `aud` = clientId (строка или массив с ним);
 * `exp` не истёк; `iat` не из будущего (допуск 60 с); `nonce` = из cookie. Причина отказа — в лог, не игроку.
 */
export function verifyIdTokenClaims(claims: Record<string, unknown>, expected: { clientId: string; nonce: string; now: Date }): ClaimsResult {
  const nowS = Math.floor(expected.now.getTime() / 1000);
  const iss = str(claims["iss"]);
  if (iss === null || !GOOGLE_ISSUERS.includes(iss)) return { ok: false, reason: "iss" };
  const aud = claims["aud"];
  const audOk = typeof aud === "string" ? aud === expected.clientId : Array.isArray(aud) && aud.includes(expected.clientId);
  if (!audOk) return { ok: false, reason: "aud" };
  const exp = claims["exp"];
  if (typeof exp !== "number" || exp <= nowS) return { ok: false, reason: "exp" };
  const iat = claims["iat"];
  if (typeof iat !== "number" || iat > nowS + IAT_SKEW_S) return { ok: false, reason: "iat" };
  if (claims["nonce"] !== expected.nonce) return { ok: false, reason: "nonce" };
  const sub = str(claims["sub"]);
  if (sub === null) return { ok: false, reason: "sub" };
  return {
    ok: true,
    identity: {
      sub,
      email: str(claims["email"]),
      email_verified: claims["email_verified"] === true,
      name: str(claims["name"]),
      picture: str(claims["picture"]),
    },
  };
}
