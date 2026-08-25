import Link from "next/link";
import { notFound } from "next/navigation";
import { previewStatement } from "@/lib/actions/import";
import { requireUser } from "@/lib/session";
import { ImportPreview } from "@/components/import-preview";

export default async function ImportStatementPage({
  params,
}: {
  params: Promise<{ file: string }>;
}) {
  await requireUser();
  const { file } = await params;
  const preview = await previewStatement(file);
  if (!preview) notFound();

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Link href="/import" className="self-start text-sm text-muted hover:text-foreground hover:underline">
        ← Imports
      </Link>
      <ImportPreview preview={preview} />
    </div>
  );
}
