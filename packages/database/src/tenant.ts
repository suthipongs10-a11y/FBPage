/**
 * ตัวช่วย scope ผู้เช่า (AGENTS.md §57) — ใช้แทนการเขียน where ซ้อนเองทุกที่
 *
 * ตัวอย่าง:
 *   db.facebookPost.findMany({ where: { pageId, ...pageInWorkspace(workspaceId) } })
 */
export const clientInWorkspace = (workspaceId: string) => ({ workspaceId });
export const brandInWorkspace = (workspaceId: string) => ({ client: { workspaceId } });
export const pageInWorkspace = (workspaceId: string) => ({ brand: { client: { workspaceId } } });
export const postInWorkspace = (workspaceId: string) => ({ page: { brand: { client: { workspaceId } } } });
export const contentInWorkspace = (workspaceId: string) => ({ page: { brand: { client: { workspaceId } } } });
