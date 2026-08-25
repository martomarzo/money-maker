import { Logo } from "@/components/app-shell";
import { Card } from "@/components/ui";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <Logo className="h-10 w-10" />
          <span className="text-xl font-semibold tracking-tight">Money Maker</span>
          <span className="text-sm text-muted">Household finance</span>
        </div>
        <Card>{children}</Card>
      </div>
    </div>
  );
}
