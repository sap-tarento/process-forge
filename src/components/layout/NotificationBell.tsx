import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useAuth";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useEffect } from "react";

export function NotificationBell() {
  const { user } = useSession();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["notifications", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("notifications")
        .select("id, event_type, summary, atom_id, read, created_at")
        .order("created_at", { ascending: false }).limit(20);
      return data ?? [];
    },
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel("notifications-" + user.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `recipient=eq.${user.id}` }, () => {
        qc.invalidateQueries({ queryKey: ["notifications", user.id] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, qc]);

  const unread = (data ?? []).filter((n) => !n.read).length;
  const markRead = async () => {
    if (!unread) return;
    await supabase.from("notifications").update({ read: true }).eq("read", false);
    qc.invalidateQueries({ queryKey: ["notifications", user?.id] });
  };

  if (!user) return null;
  return (
    <Popover onOpenChange={(o) => o && markRead()}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          {unread > 0 && <Badge className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px]">{unread}</Badge>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="border-b p-3 text-sm font-medium">Notifications</div>
        <div className="max-h-96 overflow-y-auto">
          {!data?.length ? (
            <div className="p-4 text-xs text-muted-foreground">No notifications yet.</div>
          ) : data.map((n) => (
            <div key={n.id} className={`border-b p-3 text-xs ${n.read ? "opacity-70" : ""}`}>
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-[10px]">{n.event_type}</Badge>
                <span className="text-muted-foreground text-[10px]">{new Date(n.created_at).toLocaleString()}</span>
              </div>
              <div className="mt-1">{n.summary}</div>
              {n.atom_id && <div className="mt-1 font-mono text-[10px] text-muted-foreground">{n.atom_id}</div>}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
