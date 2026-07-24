type RequestRejection = {
  status: number;
  error: string;
  code: string;
};

export class InvalidJsonRequestError extends Error {
  code: "invalid_json" | "invalid_request";

  constructor(message: string, code: "invalid_json" | "invalid_request") {
    super(message);
    this.name = "InvalidJsonRequestError";
    this.code = code;
  }
}

function isLoopbackHostname(hostname: string) {
  const ipv4Octets = hostname.split(".");
  const isIpv4Loopback =
    ipv4Octets.length === 4 &&
    ipv4Octets[0] === "127" &&
    ipv4Octets.every(
      (octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255,
    );

  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    isIpv4Loopback
  );
}

export function rejectUnsafeJsonRequest(
  request: Request,
): RequestRejection | null {
  const url = new URL(request.url);

  if (!isLoopbackHostname(url.hostname)) {
    return {
      status: 403,
      error:
        "Valuemaxxing Lab API routes are local-only. Add authentication and rate limits before deploying them.",
      code: "local_only",
    };
  }

  const contentType = request.headers.get("content-type") || "";
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return {
      status: 415,
      error: "Requests must use Content-Type: application/json.",
      code: "unsupported_media_type",
    };
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    return {
      status: 403,
      error: "Cross-site requests are not allowed.",
      code: "cross_site_request",
    };
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== url.origin) {
        return {
          status: 403,
          error: "Cross-origin requests are not allowed.",
          code: "cross_origin_request",
        };
      }
    } catch {
      return {
        status: 403,
        error: "The request origin is invalid.",
        code: "invalid_origin",
      };
    }
  }

  return null;
}

export async function readJsonObjectRequest(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    throw new InvalidJsonRequestError(
      "Request body must contain valid JSON.",
      "invalid_json",
    );
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new InvalidJsonRequestError(
      "Request body must be a JSON object.",
      "invalid_request",
    );
  }

  return payload as Record<string, unknown>;
}
