import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { sha256Hex } from "@/lib/sha256";
import { recordAudit } from "@/lib/audit";
import {
  SOURCE_TYPES,
  suggestAuthority,
  type AuthorityClass,
  type SourceType,
} from "@/lib/source-types";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function RegisterSourceDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"file" | "text">("file");
  const [file, setFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("POLICY");
  const [authorityClass, setAuthorityClass] = useState<AuthorityClass>("NORMATIVE");
  const [authorityTouched, setAuthorityTouched] = useState(false);
  const [version, setVersion] = useState("1.0");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [owner, setOwner] = useState("");
  const [approvalStatus, setApprovalStatus] = useState("");
  const [supersededSourceId, setSupersededSourceId] = useState<string>("");

  useEffect(() => {
    if (!authorityTouched) setAuthorityClass(suggestAuthority(sourceType));
  }, [sourceType, authorityTouched]);

  const reset = () => {
    setFile(null); setPastedText(""); setSourceId(""); setTitle("");
    setSourceType("POLICY"); setAuthorityClass("NORMATIVE"); setAuthorityTouched(false);
    setVersion("1.0"); setEffectiveDate(""); setOwner(""); setApprovalStatus(""); setSupersededSourceId("");
    setMode("file");
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!sourceId.trim() || !title.trim()) throw new Error("Source ID and title are required.");
      let file_sha256: string; let file_path: string | null = null; let raw_text: string | null = null;
      if (mode === "file") {
        if (!file) throw new Error("Choose a file to upload.");
        const buf = await file.arrayBuffer();
        file_sha256 = await sha256Hex(buf);
        const path = `${sourceId.trim()}/${file_sha256}-${file.name}`;
        const { error: upErr } = await supabase.storage.from("source-files").upload(path, file, { upsert: false });
        if (upErr && !upErr.message.includes("already exists")) throw upErr;
        file_path = path;
      } else {
        if (!pastedText.trim()) throw new Error("Paste some text to register.");
        raw_text = pastedText;
        file_sha256 = await sha256Hex(pastedText);
      }

      const { data: user } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("sources")
        .insert({
          source_id: sourceId.trim(),
          title: title.trim(),
          source_type: sourceType,
          authority_class: authorityClass,
          version: version.trim() || "1.0",
          effective_date: effectiveDate || null,
          owner: owner.trim() || null,
          approval_status: approvalStatus.trim() || null,
          superseded_source_id: supersededSourceId || null,
          file_path,
          file_sha256,
          raw_text,
          status: "registered",
          created_by: user.user?.id ?? null,
        })
        .select()
        .single();
      if (error) throw error;

      await recordAudit({
        event_type: "source.registered",
        entity_type: "source",
        entity_id: data.id,
        payload: {
          source_id: data.source_id,
          authority_class: data.authority_class,
          file_sha256: data.file_sha256,
        },
      });
      return data;
    },
    onSuccess: () => {
      toast.success("Source registered");
      qc.invalidateQueries({ queryKey: ["sources"] });
      qc.invalidateQueries({ queryKey: ["recent-sources"] });
      reset();
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Register source</DialogTitle>
          <DialogDescription>
            Stage 1 of the pipeline: registration and fingerprinting. A SHA-256 fingerprint is computed and stored with the source for provenance.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}
          className="grid gap-4"
        >
          <Tabs value={mode} onValueChange={(v) => setMode(v as "file" | "text")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="file">Upload file</TabsTrigger>
              <TabsTrigger value="text">Paste text</TabsTrigger>
            </TabsList>
            <TabsContent value="file" className="mt-3">
              <Label htmlFor="src-file" className="text-xs">Document (PDF, TXT, MD)</Label>
              <Input
                id="src-file"
                type="file"
                accept=".pdf,.txt,.md,text/plain,text/markdown,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="mt-1"
              />
            </TabsContent>
            <TabsContent value="text" className="mt-3">
              <Label htmlFor="src-text" className="text-xs">Source text</Label>
              <Textarea
                id="src-text"
                rows={6}
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="Paste the policy, SOP, or regulation text…"
                className="mt-1 font-mono text-xs"
              />
            </TabsContent>
          </Tabs>

          <div className="grid grid-cols-2 gap-3">
            <FieldStack label="Source ID" hint="e.g. FIN-CONTROL-2026-03">
              <Input value={sourceId} onChange={(e) => setSourceId(e.target.value)} required />
            </FieldStack>
            <FieldStack label="Version">
              <Input value={version} onChange={(e) => setVersion(e.target.value)} required />
            </FieldStack>
            <FieldStack label="Title" className="col-span-2">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </FieldStack>
            <FieldStack label="Source type">
              <Select value={sourceType} onValueChange={(v) => setSourceType(v as SourceType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOURCE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldStack>
            <FieldStack label="Authority class" hint={authorityTouched ? "Overridden manually" : "Suggested from source type"}>
              <Select
                value={authorityClass}
                onValueChange={(v) => { setAuthorityClass(v as AuthorityClass); setAuthorityTouched(true); }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NORMATIVE">NORMATIVE</SelectItem>
                  <SelectItem value="DESCRIPTIVE">DESCRIPTIVE</SelectItem>
                </SelectContent>
              </Select>
            </FieldStack>
            <FieldStack label="Effective date">
              <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
            </FieldStack>
            <FieldStack label="Approval status" hint="e.g. approved, draft">
              <Input value={approvalStatus} onChange={(e) => setApprovalStatus(e.target.value)} />
            </FieldStack>
            <FieldStack label="Owner" className="col-span-2">
              <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Team or individual accountable for the source" />
            </FieldStack>
            <FieldStack label="Supersedes (source UUID, optional)" className="col-span-2">
              <Input value={supersededSourceId} onChange={(e) => setSupersededSourceId(e.target.value)} placeholder="Leave blank if this is a new source" />
            </FieldStack>
          </div>

          {authorityClass === "DESCRIPTIVE" && (
            <Alert variant="default" className="border-amber-500/50 bg-amber-500/5">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-sm">Descriptive source</AlertTitle>
              <AlertDescription className="text-xs">
                Descriptive sources (event logs, ERP config, agent traces, BPMN models) can only ever yield
                <span className="mx-1 font-medium text-foreground">candidate observed practice</span>
                atoms — never binding, active atoms. Promoting them to policy requires a separate normative source.
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Registering…" : "Register source"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldStack({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
