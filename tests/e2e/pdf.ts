// Builds small PDF files for the tests: plain text lines at given positions, one list per page.
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** [text, y from the bottom of the page, font size] */
export type PdfLine = [text: string, y: number, size?: number];

export function buildPdf(pages: PdfLine[][]): string {
  const literal = (text: string) => text.replace(/[\\()]/g, "\\$&");
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);
  const kids = pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ");
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (const [index, lines] of pages.entries()) {
    const stream = lines
      .map(([text, y, size = 12]) => `BT /F1 ${size} Tf 1 0 0 1 72 ${y} Tm (${literal(text)}) Tj ET`)
      .join("\n");
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + index * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
    );
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, index) => {
    const offset = out.length;
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

/** Writes `content` to a temporary file with this name and returns its path. */
export async function temporaryFile(name: string, content: string | Uint8Array): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), "tiny-reader-pdf-")), name);
  await writeFile(path, content);
  return path;
}
