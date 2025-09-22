export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createOrReuseSubscriber } from "@/lib/server/subscribers";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = String(body?.email || "").trim();

    if (!emailPattern.test(email)) {
      return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 });
    }

    const token = await createOrReuseSubscriber(email);
    const { origin } = new URL(req.url);
    const icsUrl = `${origin}/api/ics/${token}.ics`;

    return NextResponse.json({ success: true, icsUrl, token }, { status: 201 });
  } catch (err: any) {
    const message = err?.message || "Unable to subscribe right now.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
