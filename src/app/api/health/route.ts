export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok", service: "open-agent-bridge", stage: process.env.NODE_ENV === "production" ? "production" : "development", build: process.env.BRIDGE_BUILD_ID ?? "working-tree" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
