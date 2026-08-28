import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("shiftApi", {
  bootstrap: () => ipcRenderer.invoke("app:get-bootstrap"),
  listRoles: (includeDeleted = false) =>
    ipcRenderer.invoke("app:list-roles", includeDeleted),
  listStaff: () => ipcRenderer.invoke("app:list-staff"),
  staffUsage: (id: number) => ipcRenderer.invoke("app:staff-usage", id),
  setStaffDeleted: (id: number, deleted: boolean) => ipcRenderer.invoke("app:set-staff-deleted", id, deleted),
  saveRole: (payload: unknown) => ipcRenderer.invoke("app:save-role", payload),
  setRoleDeleted: (id: number, deleted: boolean) =>
    ipcRenderer.invoke("app:set-role-deleted", id, deleted),
  roleUsage: (id: number) => ipcRenderer.invoke("app:role-usage", id),
  roleRequirementUsage: (id: number) =>
    ipcRenderer.invoke("app:role-requirement-usage", id),
  listShiftTypes: () => ipcRenderer.invoke("app:list-shift-types"),
  shiftTypeUsage: (id: number) => ipcRenderer.invoke("app:shift-type-usage", id),
  setShiftTypeDeleted: (id: number, deleted: boolean) =>
    ipcRenderer.invoke("app:set-shift-type-deleted", id, deleted),
  saveSettings: (payload: unknown) =>
    ipcRenderer.invoke("app:save-settings", payload),
  saveConfiguration: (payload: unknown) =>
    ipcRenderer.invoke("app:save-configuration", payload),
  saveRules: (payload: unknown) =>
    ipcRenderer.invoke("app:save-rules", payload),
  saveUnavailableConditions: (payload: unknown) =>
    ipcRenderer.invoke("app:save-unavailable-conditions", payload),
  saveRoleRequirements: (payload: unknown) =>
    ipcRenderer.invoke("app:save-role-requirements", payload),
  saveConditions: (payload: unknown) => ipcRenderer.invoke("app:save-conditions", payload),
  generateStart: (month: string): Promise<number> =>
    ipcRenderer.invoke("app:generate-start", month),
  generateCancel: (jobId: number) =>
    ipcRenderer.invoke("app:generate-cancel", jobId),
  onGenerateProgress: (cb: (payload: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("generate:progress", handler);
    return () => ipcRenderer.removeListener("generate:progress", handler);
  },
  onGenerateDone: (cb: (payload: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("generate:done", handler);
    return () => ipcRenderer.removeListener("generate:done", handler);
  },
  onGenerateError: (cb: (payload: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("generate:error", handler);
    return () => ipcRenderer.removeListener("generate:error", handler);
  },
  createMonth: (month: string) => ipcRenderer.invoke("app:create-month", month),
  deleteMonth: (month: string) => ipcRenderer.invoke("app:delete-month", month),
  getMonth: (month: string) => ipcRenderer.invoke("app:get-month", month),
  setUnsavedChanges: (hasUnsavedChanges: boolean) =>
    ipcRenderer.invoke("app:set-unsaved-changes", hasUnsavedChanges),
  updateCells: (payload: unknown) =>
    ipcRenderer.invoke("app:update-cell", payload),
  validate: (month: string, cells: unknown) =>
    ipcRenderer.invoke("app:validate", month, cells),
  exportXlsx: (month: string) => ipcRenderer.invoke("app:export-xlsx", month),
  onExportRequested: (listener: () => void) =>
    ipcRenderer.on("menu:export-xlsx", listener),
});
