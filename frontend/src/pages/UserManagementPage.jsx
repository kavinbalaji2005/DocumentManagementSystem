import { useState, useEffect } from "react";
import { format } from "date-fns";
import { usersApi, groupsApi } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Trash2,
  UserPlus,
  Users,
  FolderPlus,
  Pencil,
  ChevronDown,
  ChevronRight,
  UserMinus,
  ArrowRightLeft,
  X,
  Plus,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function getEmailValidationError(email) {
  const normalized = email.trim();
  if (!normalized) return "Email is required";
  if (!EMAIL_RE.test(normalized)) return "Enter a valid email address";
  return "";
}

// ─── Employees Tab ───────────────────────────────────────────────

function EmployeesTab() {
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const { user: currentUser } = useAuth();
  const { toast } = useToast();

  const [newEmpId, setNewEmpId] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newEmailError, setNewEmailError] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("Employee");
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const data = await usersApi.getAll();
      setUsers(data);
    } catch (error) {
      toast({ title: "Failed to load users", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();

    const emailError = getEmailValidationError(newEmail);
    setEmailTouched(true);
    setNewEmailError(emailError);
    if (emailError) {
      toast({
        title: "Invalid email",
        description: emailError,
        variant: "destructive",
      });
      return;
    }

    setIsCreating(true);
    try {
      await usersApi.create({
        employee_id: newEmpId,
        email: newEmail.trim().toLowerCase(),
        password: newPassword,
        role: newRole,
      });
      toast({ title: "User created successfully" });
      setNewEmpId("");
      setNewEmail("");
      setNewEmailError("");
      setEmailTouched(false);
      setNewPassword("");
      setNewRole("Employee");
      fetchUsers();
    } catch (error) {
      toast({
        title: "Failed to create user",
        description: error.response?.data?.error || "An error occurred",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdateRole = async (userId, role) => {
    try {
      await usersApi.update(userId, { role });
      toast({ title: "Role updated" });
      fetchUsers();
    } catch (error) {
      toast({ title: "Failed to update role", variant: "destructive" });
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!confirm("Are you sure you want to delete this user?")) return;
    try {
      await usersApi.delete(userId);
      toast({ title: "User deleted" });
      fetchUsers();
    } catch (error) {
      toast({
        title: "Failed to delete user",
        description: error.response?.data?.error || "An error occurred",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Create User Form */}
      <div className="bg-background border rounded-xl p-6 shadow-sm">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <UserPlus className="h-5 w-5 text-primary" />
          Add New User
        </h2>
        <form
          onSubmit={handleCreateUser}
          className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end"
        >
          <div className="space-y-2">
            <Label htmlFor="empId">Employee ID</Label>
            <Input
              id="empId"
              placeholder="ELV0001"
              value={newEmpId}
              onChange={(e) => setNewEmpId(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="name@company.com"
              value={newEmail}
              onChange={(e) => {
                const value = e.target.value;
                setNewEmail(value);
                setNewEmailError(getEmailValidationError(value));
              }}
              onBlur={() => setEmailTouched(true)}
              required
            />
            {emailTouched && newEmailError && (
              <p className="text-xs text-destructive">{newEmailError}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="pass">Password</Label>
            <Input
              id="pass"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role">Role</Label>
            <select
              id="role"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="Employee">Employee</option>
              <option value="Manager">Manager</option>
              <option value="Admin">Admin</option>
            </select>
          </div>
          <Button
            type="submit"
            disabled={isCreating || Boolean(newEmailError)}
            className="w-full"
          >
            {isCreating ? "Creating..." : "Create User"}
          </Button>
        </form>
      </div>

      {/* User List */}
      <div className="bg-background border rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted/50 text-muted-foreground border-b uppercase text-xs">
            <tr>
              <th className="px-6 py-4 font-medium">Employee ID</th>
              <th className="px-6 py-4 font-medium">Email</th>
              <th className="px-6 py-4 font-medium">Role</th>
              <th className="px-6 py-4 font-medium">Group</th>
              <th className="px-6 py-4 font-medium">Created At</th>
              <th className="px-6 py-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading ? (
              <tr>
                <td
                  colSpan="6"
                  className="text-center py-8 text-muted-foreground"
                >
                  Loading users...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td
                  colSpan="6"
                  className="text-center py-8 text-muted-foreground"
                >
                  No users found.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-6 py-4 font-medium">{u.employee_id}</td>
                  <td className="px-6 py-4 text-muted-foreground">
                    {u.email || "-"}
                  </td>
                  <td className="px-6 py-4">
                    <select
                      value={u.role}
                      onChange={(e) => handleUpdateRole(u.id, e.target.value)}
                      disabled={currentUser?.id === u.id}
                      className="bg-transparent border rounded p-1 text-sm focus:ring-1 focus:ring-primary focus:border-primary disabled:opacity-50"
                    >
                      <option value="Employee">Employee</option>
                      <option value="Manager">Manager</option>
                      <option value="Admin">Admin</option>
                    </select>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">
                    {u.group_name ? (
                      <span className="inline-flex items-center gap-1 bg-primary/10 text-primary px-2 py-0.5 rounded-full text-xs font-medium">
                        <Users className="h-3 w-3" />
                        {u.group_name}
                      </span>
                    ) : u.role === "Employee" ? (
                      <span className="text-xs text-muted-foreground/60 italic">
                        Ungrouped
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/40">
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">
                    {format(new Date(u.created_at), "dd/MM/yyyy")}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => handleDeleteUser(u.id)}
                      disabled={currentUser?.id === u.id}
                      title="Delete User"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Groups Tab ──────────────────────────────────────────────────

function GroupsTab() {
  const [groups, setGroups] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  // Create form state
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Expanded group (to show members)
  const [expandedGroupId, setExpandedGroupId] = useState(null);

  // Edit group state
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    try {
      const data = await groupsApi.getAll();
      setGroups(data);
    } catch (error) {
      toast({ title: "Failed to load groups", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateGroup = async (e) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      await groupsApi.create({ name: newName, description: newDesc });
      toast({ title: "Group created successfully" });
      setNewName("");
      setNewDesc("");
      fetchGroups();
    } catch (error) {
      toast({
        title: "Failed to create group",
        description: error.response?.data?.error || "An error occurred",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteGroup = async (groupId) => {
    if (
      !confirm(
        "Are you sure? Members will be ungrouped and group privileges revoked.",
      )
    )
      return;
    try {
      await groupsApi.delete(groupId);
      toast({ title: "Group deleted" });
      if (expandedGroupId === groupId) setExpandedGroupId(null);
      fetchGroups();
    } catch (error) {
      toast({
        title: "Failed to delete group",
        description: error.response?.data?.error || "An error occurred",
        variant: "destructive",
      });
    }
  };

  const startEdit = (group) => {
    setEditingGroupId(group.id);
    setEditName(group.name);
    setEditDesc(group.description || "");
  };

  const handleUpdateGroup = async () => {
    try {
      await groupsApi.update(editingGroupId, {
        name: editName,
        description: editDesc,
      });
      toast({ title: "Group updated" });
      setEditingGroupId(null);
      fetchGroups();
    } catch (error) {
      toast({
        title: "Failed to update group",
        description: error.response?.data?.error || "An error occurred",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Create Group Form */}
      <div className="bg-background border rounded-xl p-6 shadow-sm">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <FolderPlus className="h-5 w-5 text-primary" />
          Create New Group
        </h2>
        <form
          onSubmit={handleCreateGroup}
          className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end"
        >
          <div className="space-y-2">
            <Label htmlFor="groupName">Group Name</Label>
            <Input
              id="groupName"
              placeholder="eg. HR"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="groupDesc">Description (optional)</Label>
            <Input
              id="groupDesc"
              placeholder="Brief description"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={isCreating} className="w-full">
            {isCreating ? "Creating..." : "Create Group"}
          </Button>
        </form>
      </div>

      {/* Groups List */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading groups...
          </div>
        ) : groups.length === 0 ? (
          <div className="bg-background border rounded-xl p-8 text-center text-muted-foreground">
            No groups created yet. Create your first group above.
          </div>
        ) : (
          groups.map((group) => (
            <div
              key={group.id}
              className="bg-background border rounded-xl shadow-sm overflow-hidden"
            >
              {/* Group Header */}
              <div className="flex items-center justify-between px-6 py-4">
                <div
                  className="flex items-center gap-3 cursor-pointer flex-1 min-w-0"
                  onClick={() =>
                    setExpandedGroupId(
                      expandedGroupId === group.id ? null : group.id,
                    )
                  }
                >
                  {expandedGroupId === group.id ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex items-center gap-2 min-w-0">
                    <Users className="h-4 w-4 text-primary shrink-0" />
                    {editingGroupId === group.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="h-8 w-40"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <Input
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          placeholder="Description"
                          className="h-8 w-48"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUpdateGroup();
                          }}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingGroupId(null);
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <span className="font-medium truncate">
                          {group.name}
                        </span>
                        {group.description && (
                          <span className="text-xs text-muted-foreground truncate hidden md:inline">
                            — {group.description}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">
                    {group.member_count}{" "}
                    {group.member_count === 1 ? "member" : "members"}
                  </span>
                  {editingGroupId !== group.id && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(group);
                        }}
                        title="Edit Group"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteGroup(group.id);
                        }}
                        title="Delete Group"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* Expanded Members Section */}
              {expandedGroupId === group.id && (
                <GroupMembersPanel
                  groupId={group.id}
                  groupName={group.name}
                  groups={groups}
                  onRefreshGroups={fetchGroups}
                />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Group Members Panel ─────────────────────────────────────────

function GroupMembersPanel({ groupId, groupName, groups, onRefreshGroups }) {
  const [members, setMembers] = useState([]);
  const [ungrouped, setUngrouped] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [transferTarget, setTransferTarget] = useState(null); // { userId, employeeId }
  const [targetGroupId, setTargetGroupId] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    fetchData();
  }, [groupId]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [membersData, ungroupedData] = await Promise.all([
        groupsApi.getMembers(groupId),
        groupsApi.getUngrouped(),
      ]);
      setMembers(membersData);
      setUngrouped(ungroupedData);
    } catch (error) {
      toast({ title: "Failed to load members", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddMembers = async () => {
    if (selectedUserIds.length === 0) return;
    try {
      const result = await groupsApi.addMembers(groupId, selectedUserIds);
      toast({
        title: `Added ${result.added?.length || 0} member(s) to ${groupName}`,
      });
      if (result.errors?.length) {
        toast({
          title: "Some additions failed",
          description: result.errors.join(", "),
          variant: "destructive",
        });
      }
      setSelectedUserIds([]);
      setShowAddForm(false);
      fetchData();
      onRefreshGroups();
    } catch (error) {
      toast({
        title: "Failed to add members",
        description: error.response?.data?.error || "An error occurred",
        variant: "destructive",
      });
    }
  };

  const handleRemoveMember = async (userId) => {
    if (
      !confirm(
        "Remove this employee from the group? Group privileges will be revoked.",
      )
    )
      return;
    try {
      await groupsApi.removeMember(groupId, userId);
      toast({ title: "Member removed" });
      fetchData();
      onRefreshGroups();
    } catch (error) {
      toast({
        title: "Failed to remove member",
        description: error.response?.data?.error || "An error occurred",
        variant: "destructive",
      });
    }
  };

  const handleTransfer = async () => {
    if (!transferTarget || !targetGroupId) return;
    try {
      await groupsApi.transfer({
        user_id: transferTarget.userId,
        to_group_id: parseInt(targetGroupId),
      });
      toast({
        title: `${transferTarget.employeeId} transferred`,
      });
      setTransferTarget(null);
      setTargetGroupId("");
      fetchData();
      onRefreshGroups();
    } catch (error) {
      toast({
        title: "Failed to transfer",
        description: error.response?.data?.error || "An error occurred",
        variant: "destructive",
      });
    }
  };

  const toggleUserSelection = (userId) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId],
    );
  };

  const otherGroups = groups.filter((g) => g.id !== groupId);

  return (
    <div className="border-t px-6 py-4 bg-muted/10">
      {isLoading ? (
        <div className="text-center py-4 text-sm text-muted-foreground">
          Loading members...
        </div>
      ) : (
        <div className="space-y-4">
          {/* Members list */}
          {members.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-3">
              No members in this group yet.
            </div>
          ) : (
            <div className="space-y-1">
              {members.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{m.employee_id}</span>
                    <span className="text-xs text-muted-foreground">
                      {m.role}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {/* Transfer */}
                    {transferTarget?.userId === m.id ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={targetGroupId}
                          onChange={(e) => setTargetGroupId(e.target.value)}
                          className="h-8 text-xs border rounded px-2 bg-background"
                        >
                          <option value="">Select group...</option>
                          {otherGroups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={!targetGroupId}
                          onClick={handleTransfer}
                        >
                          Transfer
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => {
                            setTransferTarget(null);
                            setTargetGroupId("");
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        {otherGroups.length > 0 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() =>
                              setTransferTarget({
                                userId: m.id,
                                employeeId: m.employee_id,
                              })
                            }
                            title="Transfer to another group"
                          >
                            <ArrowRightLeft className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => handleRemoveMember(m.id)}
                          title="Remove from group"
                        >
                          <UserMinus className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add Members */}
          {showAddForm ? (
            <div className="border rounded-lg p-4 bg-background space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Add Ungrouped Employees</h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowAddForm(false);
                    setSelectedUserIds([]);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
              {ungrouped.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No ungrouped employees available.
                </p>
              ) : (
                <>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {ungrouped.map((u) => (
                      <label
                        key={u.id}
                        className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/30 cursor-pointer text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={selectedUserIds.includes(u.id)}
                          onChange={() => toggleUserSelection(u.id)}
                          className="rounded border-muted-foreground/30"
                        />
                        <span className="font-medium">{u.employee_id}</span>
                      </label>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    onClick={handleAddMembers}
                    disabled={selectedUserIds.length === 0}
                    className="w-full"
                  >
                    Add {selectedUserIds.length} Selected
                  </Button>
                </>
              )}
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setShowAddForm(true)}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Members
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────

export function UserManagementPage() {
  return (
    <div className="flex-1 overflow-auto p-8 bg-muted/20">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">User Management</h1>
          <p className="text-muted-foreground mt-2">
            Manage employee access, roles, and groups.
          </p>
        </div>

        <Tabs defaultValue="employees" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger
              value="employees"
              className="flex items-center gap-1.5"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Employees
            </TabsTrigger>
            <TabsTrigger value="groups" className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              Groups
            </TabsTrigger>
          </TabsList>

          <TabsContent value="employees">
            <EmployeesTab />
          </TabsContent>

          <TabsContent value="groups">
            <GroupsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
