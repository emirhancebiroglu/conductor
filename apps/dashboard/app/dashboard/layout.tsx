import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import type { User } from "@supabase/supabase-js";

const FIXTURE_USER = { id: "test-user", email: "test@fixture.local" } as unknown as User;

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // E2E test fixture bypass — never active in production (middleware injects x-fixture header)
  const hdrs = await headers();
  const isFixture =
    process.env.NODE_ENV !== "production" && hdrs.get("x-fixture") !== null;

  let user: User | null = null;

  if (isFixture) {
    user = FIXTURE_USER;
  } else {
    const supabase = await createClient();
    ({ data: { user } } = await supabase.auth.getUser());
  }

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: "var(--surface)" }}>
      <Sidebar />
      <div className="flex flex-col flex-1" style={{ marginLeft: "var(--sidebar-w)" }}>
        <Header user={user} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
