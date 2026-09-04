import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getMyPasswordFlag, clearMyPasswordFlag } from "@/lib/password.functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export function MandatoryPasswordReset() {
  const qc = useQueryClient();
  const fetchFlag = useServerFn(getMyPasswordFlag);
  const clearFlag = useServerFn(clearMyPasswordFlag);
  const { data } = useQuery({
    queryKey: ["me", "password-flag"],
    queryFn: () => fetchFlag(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const open = Boolean(data?.requiresChange);

  // Prevent accidental close during forced reset.
  useEffect(() => {
    if (!open) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [open]);

  const submit = async () => {
    if (pw.length < 8) {
      toast.error("A senha deve ter ao menos 8 caracteres");
      return;
    }
    if (pw !== confirm) {
      toast.error("As senhas não coincidem");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      await clearFlag();
      toast.success("Senha atualizada com sucesso");
      qc.invalidateQueries({ queryKey: ["me", "password-flag"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-md [&>button]:hidden"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <DialogTitle className="text-center">Defina sua nova senha</DialogTitle>
          <DialogDescription className="text-center">
            Por segurança, você precisa criar uma senha pessoal antes de continuar.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="new-pw">
              Nova senha
            </Label>
            <Input
              id="new-pw"
              type="password"
              autoFocus
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="confirm-pw">
              Confirmar senha
            </Label>
            <Input
              id="confirm-pw"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar e continuar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
