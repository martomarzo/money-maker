import Link from "next/link";
import { notFound } from "next/navigation";
import { previewStatement } from "@/lib/actions/import";
import { requireMembership } from "@/lib/session";
import { ImportPreview } from "@/components/import-preview";

export default async function ImportStatementPage({
  params,
}: {
  params: Promise<{ file: string }>;
}) {
  await requireMembership();
  const { file } = await params;
  const preview = await previewStatement(file);
  if (!preview) notFound();

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Link
        href="/import"
        className="self-start text-sm text-black/60 hover:underline dark:text-white/60"
      >
        ← Imports
      </Link>
      <ImportPreview preview={preview} />
    </div>
  );
}
