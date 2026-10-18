import { AccessToken } from "livekit-server-sdk";
import { NextRequest, NextResponse } from "next/server";

// Public (no Clerk auth) token endpoint for the self-hosted Starship Sus game at /among-us.
// Grants join/publish/subscribe/data for one "ss-*" room only.
const ROOM_RE = /^ss-[a-z0-9-]{1,40}$/;
const IDENTITY_RE = /^[A-Za-z0-9_-]{4,40}$/;

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const room = req.nextUrl.searchParams.get("room");
  const identity = req.nextUrl.searchParams.get("identity");
  if (!room || !ROOM_RE.test(room)) {
    return NextResponse.json({ error: 'Invalid "room" query parameter' }, { status: 400 });
  } else if (!identity || !IDENTITY_RE.test(identity)) {
    return NextResponse.json({ error: 'Invalid "identity" query parameter' }, { status: 400 });
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const wsUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

  if (!apiKey || !apiSecret || !wsUrl) {
    return NextResponse.json(
      { error: "Server misconfigured: set LIVEKIT_API_KEY, LIVEKIT_API_SECRET and NEXT_PUBLIC_LIVEKIT_URL" },
      { status: 500 }
    );
  }

  const at = new AccessToken(apiKey, apiSecret, { identity, ttl: "6h" });

  at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });

  const token = await at.toJwt();

  return NextResponse.json(
    { token, url: wsUrl },
    { headers: { "Cache-Control": "no-store" } }
  );
}
