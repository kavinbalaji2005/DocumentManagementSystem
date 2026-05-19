import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

export const api = axios.create({
  baseURL: API_URL,
});

// Interceptor to add the JWT token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Interceptor to handle 401s globally (e.g., redirect to login or clear token)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem("token");
      // Optionally trigger a custom event or let AuthContext handle it
      window.dispatchEvent(new Event("auth-unauthorized"));
    }
    return Promise.reject(error);
  }
);

export const FILE_BASE_URL = `${API_URL}/files`;

export const authApi = {
  login: (employee_id, password) =>
    api.post("/auth/login", { employee_id, password }).then((res) => res.data),
  getMe: () => api.get("/auth/me").then((res) => res.data),
};

export const usersApi = {
  getAll: () => api.get("/auth/users").then((res) => res.data),
  create: (data) => api.post("/auth/users", data).then((res) => res.data),
  update: (id, data) => api.patch(`/auth/users/${id}`, data).then((res) => res.data),
  delete: (id) => api.delete(`/auth/users/${id}`).then((res) => res.data),
};

export const foldersApi = {
  getRootChildren: () =>
    api.get("/folders/root/children").then((res) => res.data),
  getChildren: (id) =>
    api.get(`/folders/${id}/children`).then((res) => res.data),
  getPath: (id) => api.get(`/folders/${id}/path`).then((res) => res.data),
  getDeletePreview: (id) =>
    api.get(`/folders/${id}/delete-preview`).then((res) => res.data),
  create: (name, parent_id) =>
    api.post("/folders", { name, parent_id }).then((res) => res.data),
  update: (id, name, parent_id) =>
    api.patch(`/folders/${id}`, { name, parent_id }).then((res) => res.data),
  delete: (id) => api.delete(`/folders/${id}`).then((res) => res.data),
  getPermissions: (id) =>
    api.get(`/folders/${id}/permissions`).then((res) => res.data),
  setPermissions: (id, permissions) =>
    api.put(`/folders/${id}/permissions`, { permissions }).then((res) => res.data),
};

export const documentsApi = {
  upload: (file, folder_id, document_id) => {
    const formData = new FormData();
    formData.append("file", file);
    if (folder_id) formData.append("folder_id", folder_id);
    if (document_id) formData.append("document_id", document_id);
    return api
      .post("/documents/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then((res) => res.data);
  },
  get: (id) => api.get(`/documents/${id}`).then((res) => res.data),
  update: (id, name, folder_id) =>
    api.patch(`/documents/${id}`, { name, folder_id }).then((res) => res.data),
  delete: (id) => api.delete(`/documents/${id}`).then((res) => res.data),
  getVersions: (id) =>
    api.get(`/documents/${id}/versions`).then((res) => res.data),
  getAuditLog: (id) =>
    api.get(`/documents/${id}/audit`).then((res) => res.data),
  logAuditExport: (id) =>
    api.post(`/documents/${id}/audit/export`).then((res) => res.data),
  getPermissions: (id) =>
    api.get(`/documents/${id}/permissions`).then((res) => res.data),
  setPermissions: (id, permissions) =>
    api.put(`/documents/${id}/permissions`, { permissions }).then((res) => res.data),
};

export const versionsApi = {
  view: (id) => api.get(`/versions/${id}/view`).then((res) => res.data),
  diff: (from_id, to_id) =>
    api
      .get(`/versions/diff`, { params: { from: from_id, to: to_id } })
      .then((res) => res.data),
  update: (id, data) =>
    api.patch(`/versions/${id}`, data).then((res) => res.data),
  restore: (id) => api.post(`/versions/${id}/restore`).then((res) => res.data),
};

export const aiApi = {
  summarizeDiff: (version_id) =>
    api.post("/ai/summarize-diff", { version_id }).then((res) => res.data),
};

export const filesApi = {
  getBlob: (url, params = {}) => api.get(url, { responseType: "blob", params }).then((res) => res.data),
  downloadFile: async (url, filename) => {
    const blob = await filesApi.getBlob(url, { download: "true" });
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    link.parentNode.removeChild(link);
    window.URL.revokeObjectURL(objectUrl);
  }
};
