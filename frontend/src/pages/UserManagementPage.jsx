import { useState, useEffect } from "react";
import { format } from "date-fns";
import { usersApi } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Trash2, UserPlus } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export function UserManagementPage() {
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  
  // New User Form State
  const [newEmpId, setNewEmpId] = useState("");
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
    setIsCreating(true);
    try {
      await usersApi.create({
        employee_id: newEmpId,
        password: newPassword,
        role: newRole,
      });
      toast({ title: "User created successfully" });
      setNewEmpId("");
      setNewPassword("");
      setNewRole("Employee");
      fetchUsers();
    } catch (error) {
      toast({ 
        title: "Failed to create user", 
        description: error.response?.data?.error || "An error occurred",
        variant: "destructive" 
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
        variant: "destructive" 
      });
    }
  };

  return (
    <div className="flex-1 overflow-auto p-8 bg-muted/20">
      <div className="max-w-5xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">User Management</h1>
          <p className="text-muted-foreground mt-2">Manage employee access and roles.</p>
        </div>

        {/* Create User Form */}
        <div className="bg-background border rounded-xl p-6 shadow-sm">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            Add New User
          </h2>
          <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div className="space-y-2">
              <Label htmlFor="empId">Employee ID</Label>
              <Input
                id="empId"
                placeholder="EMP0001"
                value={newEmpId}
                onChange={(e) => setNewEmpId(e.target.value)}
                required
              />
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
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                <option value="Employee">Employee</option>
                <option value="Manager">Manager</option>
                <option value="Admin">Admin</option>
              </select>
            </div>
            <Button type="submit" disabled={isCreating} className="w-full">
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
                <th className="px-6 py-4 font-medium">Role</th>
                <th className="px-6 py-4 font-medium">Created At</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr>
                  <td colSpan="4" className="text-center py-8 text-muted-foreground">Loading users...</td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan="4" className="text-center py-8 text-muted-foreground">No users found.</td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4 font-medium">{u.employee_id}</td>
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
    </div>
  );
}
