import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
