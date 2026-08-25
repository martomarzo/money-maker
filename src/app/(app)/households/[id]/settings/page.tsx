import { requireHouseholdMember } from "@/lib/session";
import { listMembers } from "@/lib/queries";
import { HouseholdSettingsForm } from "@/components/household-settings-form";
import { InvitePartner } from "@/components/invite-partner";
import { Badge, ButtonLink, Card, CardTitle, PageHeader } from "@/components/ui";

export default async function HouseholdSettingsPage({ params }: PageProps<"/households/[id]/settings">) {
  const { id } = await params;
  const { userId, role, household } = await requireHouseholdMember(id);
  const members = await listMembers(id);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6">
      <PageHeader
        title={household.name}
        description="Household settings"
        actions={
          <ButtonLink href={`/households/${id}`} variant="ghost" size="sm">
            Back
          </ButtonLink>
        }
      />

      <Card className="flex flex-col gap-4">
        <CardTitle>Details</CardTitle>
        <HouseholdSettingsForm
          householdId={id}
          name={household.name}
          baseCurrency={household.baseCurrency}
          canEdit={role === "owner"}
        />
      </Card>

      <Card className="flex flex-col gap-4">
        <CardTitle>Members</CardTitle>
        <ul className="flex flex-col gap-2">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between text-sm">
              <span>{m.id === userId ? `${m.displayName} (you)` : m.displayName}</span>
              <Badge className="capitalize">{m.role}</Badge>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm text-muted">
            Invite someone. New shares are split evenly among everyone in the household at the
            time of sharing.
          </p>
          <InvitePartner householdId={id} />
        </div>
      </Card>
    </div>
  );
}
