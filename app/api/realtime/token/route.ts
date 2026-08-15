import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const apiKey = process.env.GPT_KEY;
  const model = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2.1";
  const voice = process.env.OPENAI_REALTIME_VOICE ?? "marin";

  if (!apiKey) {
    return NextResponse.json(
      { error: "GPT_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model,
          audio: {
            output: { voice },
          },
        },
      }),
      cache: "no-store",
    });

    const payload = (await response.json()) as {
      value?: string;
      client_secret?: { value?: string; expires_at?: number };
      expires_at?: number;
      error?: { message?: string };
    };

    if (!response.ok) {
      return NextResponse.json(
        { error: payload.error?.message ?? "Unable to create a Realtime client secret." },
        { status: response.status },
      );
    }

    const clientSecret = payload.value ?? payload.client_secret?.value;

    if (!clientSecret) {
      return NextResponse.json(
        { error: "OpenAI returned an unexpected client-secret response." },
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        clientSecret,
        expiresAt: payload.expires_at ?? payload.client_secret?.expires_at,
        model,
        voice,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to mint Realtime client secret", error);
    return NextResponse.json(
      { error: "Unable to reach the OpenAI Realtime API." },
      { status: 502 },
    );
  }
}
