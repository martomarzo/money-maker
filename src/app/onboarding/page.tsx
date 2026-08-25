import { redirect } from "next/navigation";

/** Legacy route: onboarding no longer requires a household (Phase 1.9). */
export default function OnboardingPage() {
  redirect("/households");
}
