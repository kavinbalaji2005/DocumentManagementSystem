import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usersApi, foldersApi, documentsApi, groupsApi } from "@/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { Loader2, Shield, Check, Users, User } from "lucide-react";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

const FOLDER_PRIVILEGES = [
  { key: "document:view", label: "View", group: "Document" },
  { key: "document:download", label: "Download", group: "Document" },
  {
    key: "version:create",
    label: "Upload/Restore Versions",
    group: "Document",
  },
  { key: "ai:diff_summary", label: "AI Diff Summary", group: "AI Tools" },
];

const DOCUMENT_PRIVILEGES = [
  { key: "document:view", label: "View Document", group: "Document" },
  { key: "document:download", label: "Download", group: "Document" },
  { key: "version:create", label: "Upload/Restore Versions", group: "Version" },
  { key: "ai:diff_summary", label: "AI Diff Summary", group: "AI Tools" },
];

const EMPTY_ARRAY = [];

// ─── Privilege Checkbox Grid (shared) ────────────────────────────

function PrivilegeCheckbox({ checked, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-colors ${
        disabled
          ? "border-muted-foreground/20 bg-muted/50 cursor-not-allowed opacity-50"
          : checked
            ? "bg-primary border-primary text-primary-foreground"
            : "border-muted-foreground/30 hover:border-primary/50"
      }`}
    >
      {checked && <Check className="w-3 h-3" />}
    </button>
  );
}

function PrivilegeTableHeader({ privileges, grouped }) {
  return (
    <thead className="sticky top-0 z-10">
      <tr className="bg-muted/80 backdrop-blur-sm">
        <th className="text-left px-3 py-2.5 font-medium text-muted-foreground border-b whitespace-nowrap sticky left-0 bg-muted/80 z-20">
          Name
        </th>
        <th className="px-2 py-2.5 font-medium text-muted-foreground border-b text-center whitespace-nowrap">
          All
        </th>
        {Object.entries(grouped).map(([group, privs]) =>
          privs.map((p) => (
            <th
              key={p.key}
              className="px-2 py-2.5 font-medium text-muted-foreground border-b text-center"
            >
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60">
                  {p.group}
                </span>
                <span className="text-[11px] whitespace-nowrap">
                  {p.label
                    .replace(p.group + " ", "")
                    .replace("View Folder", "View")
                    .replace("View Document", "View")}
                </span>
              </div>
            </th>
          )),
        )}
      </tr>
    </thead>
  );
}

// ─── Individual Privileges Tab ───────────────────────────────────

function IndividualPrivilegesTab({
  resourceType,
  resourceId,
  privileges,
  grouped,
}) {
  const queryClient = useQueryClient();

  const { data: allUsers, isLoading: loadingUsers } = useQuery({
    queryKey: ["auth", "users"],
    queryFn: usersApi.getAll,
  });

  const employees = useMemo(
    () =>
      (allUsers || EMPTY_ARRAY)
        .filter((u) => u.role === "Employee" && !u.group_id)
        .sort((a, b) => a.employee_id.localeCompare(b.employee_id)),
    [allUsers],
  );

  const { data: currentPerms, isLoading: loadingPerms } = useQuery({
    queryKey: [resourceType, resourceId, "permissions"],
    queryFn: () =>
      resourceType === "folder"
        ? foldersApi.getPermissions(resourceId)
        : documentsApi.getPermissions(resourceId),
    enabled: !!resourceId,
  });

  const [permMap, setPermMap] = useState({});

  useEffect(() => {
    if (!loadingPerms && currentPerms) {
      const map = {};
      for (const perm of currentPerms) {
        map[perm.user_id] = new Set(perm.privileges || []);
      }
      setPermMap(map);
    }
  }, [currentPerms, loadingPerms]);

  const togglePrivilege = (userId, privilege) => {
    setPermMap((prev) => {
      const next = { ...prev };
      const current = new Set(next[userId] || []);
      if (current.has(privilege)) {
        current.delete(privilege);
        if (privilege === "document:view") {
          current.clear();
        }
      } else {
        if (privilege !== "document:view") {
          current.add("document:view");
        }
        current.add(privilege);
      }
      next[userId] = current;
      return next;
    });
  };

  const toggleAllForUser = (userId) => {
    setPermMap((prev) => {
      const next = { ...prev };
      const current = new Set(next[userId] || []);
      const allChecked = privileges.every((p) => current.has(p.key));
      if (allChecked) {
        next[userId] = new Set();
      } else {
        next[userId] = new Set(privileges.map((p) => p.key));
      }
      return next;
    });
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const permissions = employees.map((emp) => ({
        user_id: emp.id,
        privileges: Array.from(permMap[emp.id] || []),
      }));
      return resourceType === "folder"
        ? foldersApi.setPermissions(resourceId, permissions)
        : documentsApi.setPermissions(resourceId, permissions);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [resourceType, resourceId, "permissions"],
      });
      toast({ title: "Individual permissions saved" });
    },
    onError: (err) =>
      toast({
        title: "Failed to save permissions",
        description: err.message,
        variant: "destructive",
      }),
  });

  const isLoading = loadingUsers || loadingPerms;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (employees.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[200px] text-muted-foreground">
        No ungrouped employees found. Grouped employees can only have group
        privileges.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ScrollArea className="max-h-[50vh]">
        <div className="w-full min-w-max">
          <table className="w-full text-sm border-separate border-spacing-0">
            <PrivilegeTableHeader privileges={privileges} grouped={grouped} />
            <tbody>
              {employees.map((emp, idx) => {
                const userPrivs = permMap[emp.id] || new Set();
                const allChecked = privileges.every((p) =>
                  userPrivs.has(p.key),
                );
                return (
                  <tr
                    key={emp.id}
                    className={`${
                      idx % 2 === 0 ? "bg-background" : "bg-muted/20"
                    }`}
                  >
                    <td className="px-3 py-2.5 font-medium border-b whitespace-nowrap sticky left-0 bg-inherit z-10">
                      <div className="flex flex-col">
                        <span>{emp.employee_id}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {emp.group_name || "Ungrouped"}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 border-b text-center">
                      <PrivilegeCheckbox
                        checked={allChecked}
                        onClick={() => toggleAllForUser(emp.id)}
                      />
                    </td>
                    {Object.entries(grouped).map(([group, privs]) =>
                      privs.map((p) => {
                        const isDisabled =
                          p.key !== "document:view" &&
                          !userPrivs.has("document:view");
                        return (
                          <td
                            key={p.key}
                            className="px-2 py-2.5 border-b text-center"
                          >
                            <PrivilegeCheckbox
                              checked={userPrivs.has(p.key)}
                              disabled={isDisabled}
                              onClick={() => togglePrivilege(emp.id, p.key)}
                            />
                          </td>
                        );
                      }),
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      <div className="flex justify-end">
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          {saveMutation.isPending ? "Saving..." : "Save Individual Permissions"}
        </Button>
      </div>
    </div>
  );
}

// ─── Group Privileges Tab ────────────────────────────────────────

function GroupPrivilegesTab({ resourceType, resourceId, privileges, grouped }) {
  const queryClient = useQueryClient();

  const { data: groupPerms, isLoading } = useQuery({
    queryKey: [resourceType, resourceId, "group-permissions"],
    queryFn: () =>
      resourceType === "folder"
        ? foldersApi.getGroupPermissions(resourceId)
        : documentsApi.getGroupPermissions(resourceId),
    enabled: !!resourceId,
  });

  const [permMap, setPermMap] = useState({});

  useEffect(() => {
    if (!isLoading && groupPerms) {
      const map = {};
      for (const gp of groupPerms) {
        map[gp.group_id] = new Set(gp.privileges || []);
      }
      setPermMap(map);
    }
  }, [groupPerms, isLoading]);

  const groups = useMemo(() => groupPerms || EMPTY_ARRAY, [groupPerms]);

  const togglePrivilege = (groupId, privilege) => {
    setPermMap((prev) => {
      const next = { ...prev };
      const current = new Set(next[groupId] || []);
      if (current.has(privilege)) {
        current.delete(privilege);
        if (privilege === "document:view") {
          current.clear();
        }
      } else {
        if (privilege !== "document:view") {
          current.add("document:view");
        }
        current.add(privilege);
      }
      next[groupId] = current;
      return next;
    });
  };

  const toggleAllForGroup = (groupId) => {
    setPermMap((prev) => {
      const next = { ...prev };
      const current = new Set(next[groupId] || []);
      const allChecked = privileges.every((p) => current.has(p.key));
      if (allChecked) {
        next[groupId] = new Set();
      } else {
        next[groupId] = new Set(privileges.map((p) => p.key));
      }
      return next;
    });
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const permissions = groups.map((g) => ({
        group_id: g.group_id,
        privileges: Array.from(permMap[g.group_id] || []),
      }));
      return resourceType === "folder"
        ? foldersApi.setGroupPermissions(resourceId, permissions)
        : documentsApi.setGroupPermissions(resourceId, permissions);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [resourceType, resourceId, "group-permissions"],
      });
      // Also invalidate individual permissions since cascade may have changed them
      queryClient.invalidateQueries({
        queryKey: [resourceType, resourceId, "permissions"],
      });
      toast({ title: "Group permissions saved" });
    },
    onError: (err) =>
      toast({
        title: "Failed to save group permissions",
        description: err.message,
        variant: "destructive",
      }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[200px] text-muted-foreground">
        No groups created yet. Create groups in User Management first.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ScrollArea className="max-h-[50vh]">
        <div className="w-full min-w-max">
          <table className="w-full text-sm border-separate border-spacing-0">
            <PrivilegeTableHeader privileges={privileges} grouped={grouped} />
            <tbody>
              {groups.map((g, idx) => {
                const groupPrivs = permMap[g.group_id] || new Set();
                const allChecked = privileges.every((p) =>
                  groupPrivs.has(p.key),
                );
                return (
                  <tr
                    key={g.group_id}
                    className={`${
                      idx % 2 === 0 ? "bg-background" : "bg-muted/20"
                    }`}
                  >
                    <td className="px-3 py-2.5 font-medium border-b whitespace-nowrap sticky left-0 bg-inherit z-10">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5 text-primary" />
                          <span>{g.group_name}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {g.member_count}{" "}
                          {g.member_count === 1 ? "member" : "members"}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 border-b text-center">
                      <PrivilegeCheckbox
                        checked={allChecked}
                        onClick={() => toggleAllForGroup(g.group_id)}
                      />
                    </td>
                    {Object.entries(grouped).map(([group, privs]) =>
                      privs.map((p) => {
                        const isDisabled =
                          p.key !== "document:view" &&
                          !groupPrivs.has("document:view");
                        return (
                          <td
                            key={p.key}
                            className="px-2 py-2.5 border-b text-center"
                          >
                            <PrivilegeCheckbox
                              checked={groupPrivs.has(p.key)}
                              disabled={isDisabled}
                              onClick={() => togglePrivilege(g.group_id, p.key)}
                            />
                          </td>
                        );
                      }),
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      <div className="flex justify-end">
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          {saveMutation.isPending ? "Saving..." : "Save Group Permissions"}
        </Button>
      </div>
    </div>
  );
}

// ─── Main Dialog ─────────────────────────────────────────────────

export function AccessListDialog({ open, onOpenChange, item }) {
  const resourceType = item?.type === "folder" ? "folder" : "document";
  const resourceId = item?.uuid;
  const privileges =
    resourceType === "folder" ? FOLDER_PRIVILEGES : DOCUMENT_PRIVILEGES;

  const grouped = useMemo(() => {
    const groups = {};
    for (const p of privileges) {
      if (!groups[p.group]) groups[p.group] = [];
      groups[p.group].push(p);
    }
    return groups;
  }, [privileges]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Access List - {item?.name}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground mt-1">
            Manage permissions for this {resourceType}. Group privileges apply
            to all members. Removing a group privilege also removes it from
            individual permissions.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="group" className="flex-1 flex flex-col min-h-0">
          <TabsList className="mb-3 shrink-0">
            <TabsTrigger value="group" className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              Group Privileges
            </TabsTrigger>
            <TabsTrigger
              value="individual"
              className="flex items-center gap-1.5"
            >
              <User className="h-3.5 w-3.5" />
              Individual Privileges
            </TabsTrigger>
          </TabsList>

          <TabsContent value="group" className="flex-1 min-h-0">
            {open && resourceId && (
              <GroupPrivilegesTab
                resourceType={resourceType}
                resourceId={resourceId}
                privileges={privileges}
                grouped={grouped}
              />
            )}
          </TabsContent>

          <TabsContent value="individual" className="flex-1 min-h-0">
            {open && resourceId && (
              <IndividualPrivilegesTab
                resourceType={resourceType}
                resourceId={resourceId}
                privileges={privileges}
                grouped={grouped}
              />
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
