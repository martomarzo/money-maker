import { requireUser } from "@/lib/session";
import { PersonalSettingsForm } from "@/components/personal-settings-form";
import { ButtonLink, Card, CardTitle, PageHeader } from "@/components/ui";

export default async function SettingsPage() {
  const { displayName, baseCurrency } = await requireUser();

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6">
      <PageHeader title="Settings" description={displayName} />

      <Card className="flex flex-col gap-4">
        <CardTitle>Personal ledger</CardTitle>
        <PersonalSettingsForm baseCurrency={baseCurrency} />
      </Card>

      <Card className="flex flex-col gap-2">
        <CardTitle>More</CardTitle>
        <ul className="flex flex-col divide-y divide-border">
          {[
            { href: "/budgets", label: "Budgets" },
            { href: "/settings/categories", label: "Categories & rules" },
            { href: "/accounts", label: "Accounts" },
            { href: "/import", label: "Import bank statements" },
            { href: "/households", label: "Households" },
            { href: "/settings/devices", label: "Wallet devices (experimental)" },
          ].map((l) => (
            <li key={l.href} className="py-1">
              <ButtonLink href={l.href} variant="ghost" className="w-full !justify-between !px-2">
                {l.label}
                <span aria-hidden="true">›</span>
              </ButtonLink>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
