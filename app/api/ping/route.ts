export const runtime = "nodejs";          // ensure Node serverless, not edge
export const dynamic = "force-dynamic";   // ensure it's not statically prerend

export async function GET() {
  return new Response("pong", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
