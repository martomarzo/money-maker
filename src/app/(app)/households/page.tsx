import { requireUserId } from "@/lib/session";
import { listHouseholds } from "@/lib/queries";
import { CreateHouseholdForm } from "@/components/create-household-form";
import { JoinHouseholdForm } from "@/components/join-household-form";
import { Badge, ButtonLink, Card, CardTitle, EmptyState, PageHeader } from "@/components/ui";

export default async function HouseholdsPage() {
  const userId = await requireUserId();
  const households = await listHouseholds(userId);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Households"
        description="Spaces you share expenses into. Your ledger stays private; only what you share is visible here."
      />

      {households.length === 0 ? (
        <EmptyState
          title="You're not in a household yet"
          description="Create one for you and your partner, or join with an invite link."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {households.map((h) => (
            <li key={h.id}>
              <ButtonLink
                href={`/households/${h.id}`}
                variant="secondary"
                className="!h-auto w-full !justify-between !px-4 !py-3"
              >
                <span className="flex items-center gap-2">
                  <span className="font-semibold">{h.name}</span>
                  <Badge>{h.baseCurrency.trim()}</Badge>
                </span>
                <span className="text-xs capitalize text-muted">{h.role}</span>
              </ButtonLink>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="flex flex-col gap-4">
          <CardTitle>Create a household</CardTitle>
          <CreateHouseholdForm />
        </Card>
        <Card className="flex flex-col gap-4">
          <CardTitle>Join with an invite code</CardTitle>
          <JoinHouseholdForm />
        </Card>
      </div>
    </div>
  );
}
