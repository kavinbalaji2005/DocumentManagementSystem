import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5001",
});

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
