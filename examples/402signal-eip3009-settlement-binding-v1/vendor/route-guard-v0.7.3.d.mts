export type RouteGuardOptions = {
  routeResponseJson: string;
  routeRequestJson: string;
  trustedLogVkey: string;
  request: { url: string; method: string; body?: Uint8Array };
  challenge: { status: number; bodyText: string };
  now?: number;
};

export type VerifiedRoute = Readonly<{
  model: string;
  request: { url: string; method: string; body_sha256: string };
  accepted: {
    scheme: string;
    network: string;
    asset: string;
    payTo: string;
    amount: string;
    maxTimeoutSeconds: number;
    [key: string]: unknown;
  };
  expires_at: number;
  quote_sha256: string;
}>;

export class RouteGuardError extends Error {
  readonly code: string;
  constructor(code: string);
}

export function verifyRoute(options: RouteGuardOptions): VerifiedRoute;
