import type { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Separator } from "@/components/ui/separator";
import { NotificationBell } from "./NotificationBell";

interface AppShellProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function AppShell({ title, description, actions, children }: AppShellProps) {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex flex-1 flex-col min-w-0">
          <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="h-5" />
            <div className="flex min-w-0 flex-1 flex-col">
              <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">
                {title}
              </h1>
              {description && (
                <p className="truncate text-xs text-muted-foreground">{description}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {actions}
              <NotificationBell />
            </div>
          </header>
          <main className="flex-1 overflow-x-hidden px-6 py-6">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
