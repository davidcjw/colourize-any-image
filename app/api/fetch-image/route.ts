import { NextRequest, NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const runtime = "nodejs";

const MAX_BYTES = 15 * 1024 * 1024; // 15MB
const FETCH_TIMEOUT_MS = 10_000;

function isPrivateOrReservedIP(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 0) return true; // "this" network
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    return false;
  }
  if (version === 6) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1") return true; // loopback
    if (normalized.startsWith("fe80:") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true; // link-local fe80::/10
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local fc00::/7
    // IPv4-mapped IPv6, e.g. ::ffff:10.0.0.1
    const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateOrReservedIP(mapped[1]);
    return false;
  }
  return true; // unknown format -> reject
}

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return NextResponse.json({ error: "Only http/https URLs are allowed" }, { status: 400 });
  }

  const hostname = target.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost") {
    return NextResponse.json({ error: "That host is not allowed" }, { status: 400 });
  }

  try {
    const directIpVersion = isIP(hostname);
    const addresses = directIpVersion
      ? [hostname]
      : (await lookup(hostname, { all: true })).map((entry) => entry.address);

    if (addresses.length === 0 || addresses.some(isPrivateOrReservedIP)) {
      return NextResponse.json({ error: "That host is not allowed" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Could not resolve host" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(target, {
      signal: controller.signal,
      redirect: "manual",
      headers: { "User-Agent": "colourize-any-image/1.0" },
    });
  } catch {
    clearTimeout(timeout);
    return NextResponse.json({ error: "Failed to fetch the image" }, { status: 502 });
  }
  clearTimeout(timeout);

  if (response.status >= 300 && response.status < 400) {
    return NextResponse.json(
      { error: "That URL redirects elsewhere; please use a direct image link" },
      { status: 400 }
    );
  }

  if (!response.ok) {
    return NextResponse.json({ error: "Failed to fetch the image" }, { status: 502 });
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    return NextResponse.json({ error: "That URL is not an image" }, { status: 400 });
  }

  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BYTES) {
    return NextResponse.json({ error: "Image is too large (max 15MB)" }, { status: 400 });
  }

  if (!response.body) {
    return NextResponse.json({ error: "Empty response" }, { status: 502 });
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      return NextResponse.json({ error: "Image is too large (max 15MB)" }, { status: 400 });
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    },
  });
}
