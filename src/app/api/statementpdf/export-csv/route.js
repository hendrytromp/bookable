import { buildTransactionExportRows, extractPdfStatementPayload, toCsv } from "@/lib/pdf-statement";

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
      return Response.json({ error: "No PDF file uploaded." }, { status: 400 });
    }

    const payload = await extractPdfStatementPayload(Buffer.from(await file.arrayBuffer()), { removeAuthNoise });
    const rows = buildTransactionExportRows(payload, { removeAuthNoise: false });
    const csv = toCsv(rows, ["Date", "ValueDate", "Description", "OriginalDescription", "Type", "Reference", "Amount", "Currency"]);
    const baseName = (file.name || "statement.pdf").replace(/\.pdf$/i, "");

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${baseName}.csv"`,
      },
    });
  } catch (error) {
    return Response.json(
      { error: error.message || "Failed to export PDF statement CSV." },
      { status: 500 }
    );
  }
}