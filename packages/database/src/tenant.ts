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
/** ContentItem อยู่ได้ทั้งใต้เพจ Facebook หรือช่อง YouTube (AGENTS_YOUTUBE.md §24) — ใช้ AND เพื่อไม่ชนกับ OR ของผู้เรียก */
export const contentInWorkspace = (workspaceId: string) => ({ AND: [{ OR: [{ page: { brand: { client: { workspaceId } } } }, { youtubeChannel: { brand: { client: { workspaceId } } } }, { site: { brand: { client: { workspaceId } } } }] }] });
export const siteInWorkspace = (workspaceId: string) => ({ brand: { client: { workspaceId } } });
export const emailListInWorkspace = (workspaceId: string) => ({ brand: { client: { workspaceId } } });
export const channelInWorkspace = (workspaceId: string) => ({ brand: { client: { workspaceId } } });
export const videoInWorkspace = (workspaceId: string) => ({ channel: { brand: { client: { workspaceId } } } });
