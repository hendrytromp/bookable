import { NextResponse } from "next/server";
import { extractPdfStatementPayload } from "@/lib/pdf-statement";

export const runtime = "nodejs";

function parseRemoveAuthNoise(formData) {
  const rawValue = formData.get("removeAuthNoise");
  return rawValue !== "false" && rawValue !== false;
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const removeAuthNoise = parseRemoveAuthNoise(formData);

    if (!file || typeof file.arrayBuffer !== "function") {
      return NextResponse.json({ error: "No PDF file uploaded." }, { status: 400 });
    }

    const payload = await extractPdfStatementPayload(Buffer.from(await file.arrayBuffer()), { removeAuthNoise });

    return NextResponse.json({
      ...payload,
      filename: file.name || "statement.pdf",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Failed to parse PDF statement." },
      { status: 500 }
    );
  }
}