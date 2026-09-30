/** ชนิดข้อมูลของพอร์ทัลลูกค้า + LINE (API: apps/api/src/portal, apps/api/src/line) */
export interface PortalClient { id: string; name: string; canReply: boolean; canApprove: boolean }
export interface PortalOverview {
  client: { id: string; name: string }; agencyName: string; canReply: boolean; canApprove: boolean; preview: boolean;
  pages: { id: string; name: string; pictureUrl: string | null; fanCount: number | null; tokenStatus: string }[];
  counts: { pendingComments: number; needsAttention: number; newLeads: number; approvals: number; commentsWeek: number; leadsWeek: number };
}
export interface PortalComment { id: string; pageId: string; fromName: string | null; message: string | null; createdTime: string; permalink: string | null; classification: string | null; riskFlag: boolean; draftReply: string | null; replyStatus: string; repliedAt: string | null; resolvedAt: string | null; parentCommentId: string | null; page: { name: string }; post: { message: string | null; permalink: string | null } | null; lead: { id: string; leadScore: number; status: string } | null }
export interface PortalConversation { id: string; pageId: string; mode: string; needsAttention: boolean; lastCustomerAt: string | null; updatedAt: string; page: { name: string }; last: { direction: string; text: string; status: string; occurredAt: string } | null }
export interface PortalMessage { id: string; direction: string; text: string; status: string; replyText: string | null; occurredAt: string; sentAt: string | null }
export interface PortalThread { id: string; pageId: string; pageName: string; mode: string; needsAttention: boolean; lastCustomerAt: string | null; messages: PortalMessage[] }
export interface PortalLead { id: string; name: string | null; intent: string | null; product: string | null; service: string | null; quantity: string | null; requestedDate: string | null; location: string | null; budget: string | null; phone: string | null; urgency: string | null; leadScore: number; status: string; notes: string | null; createdAt: string; page: { name: string } | null; comment: { message: string | null; fromName: string | null; permalink: string | null } | null }
export interface PortalApproval { id: string; title: string | null; caption: string | null; hashtags: string[]; cta: string | null; contentType: string; scheduledLocal: string | null; updatedAt: string; page: { name: string } | null; media: { id: string; mimeType: string }[] }
export interface PortalReport { id: string; periodStart: string; periodEnd: string; createdAt: string; page: { name: string } }
export interface LineRecipientRow { id: string; displayName: string | null; types: string[]; active: boolean; createdAt: string }
export interface LineLinkCode { code: string; expiresAt: string; botBasicId: string | null; addFriendUrl: string | null }
export interface LineStatus {
  configured: boolean; botBasicId: string | null; botName: string | null; addFriendUrl: string | null; webhookUrl: string | null;
  sentThisMonth: number; failedThisMonth: number; maxPerRecipientPerDay: number;
  types: { team: string[]; client: string[]; clientDefault: string[] };
  recipients: (LineRecipientRow & { userId: string | null; clientId: string | null; user: { id: string; name: string; email: string } | null; clientName: string | null })[];
}
export interface PortalTeamView {
  members: { id: string; canReply: boolean; canApprove: boolean; createdAt: string; lineLinked: boolean; user: { id: string; name: string; email: string } }[];
  invites: { id: string; email: string | null; canReply: boolean; canApprove: boolean; expiresAt: string; createdAt: string }[];
  portalUrl: string;
}
/** ส่งข้อความ Messenger ได้ภายใน 24 ชม. หลังลูกค้าทักล่าสุด */
export const inMessengerWindow = (lastCustomerAt: string | null, now = Date.now()) => !!lastCustomerAt && now - new Date(lastCustomerAt).getTime() < 24 * 3_600_000;
