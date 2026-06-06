import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { authApi } from "@/api";
import { useAuth } from "@/context/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { Loader2, Mail } from "lucide-react";

export function ChangeEmailDialog({ open, onOpenChange }) {
  const { user, refreshUser } = useAuth();
  const [email, setEmail] = useState("");

  // Initialize email with current user's email when the dialog opens
  useEffect(() => {
    if (open && user) {
      setEmail(user.email || "");
    }
  }, [open, user]);

  const handleOpenChange = (isOpen) => {
    onOpenChange(isOpen);
  };

  const mutation = useMutation({
    mutationFn: () => {
      const trimmedEmail = email.trim();
      if (!trimmedEmail) {
        throw new Error("Email is required");
      }
      return authApi.changeEmail(trimmedEmail);
    },
    onSuccess: () => {
      toast({ title: "Email changed successfully" });
      refreshUser();
      handleOpenChange(false);
    },
    onError: (err) => {
      toast({
        title: "Failed to change email",
        description: err.response?.data?.error || err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-primary" />
            Change Email Address
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground mt-1">
            Update your registered email address here.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">New Email Address</label>
            <Input
              type="email"
              placeholder="Enter new email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {mutation.isPending ? "Updating..." : "Change Email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
