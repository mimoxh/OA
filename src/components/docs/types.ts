export type CommentAuthor = { id: string; name: string; avatarColor: string };
export type CommentReply = { id: string; content: string; createdAt: string; author: CommentAuthor };
export type CommentThread = CommentReply & { quote: string | null; resolved: boolean; replies: CommentReply[] };
export type Member = { id: string; name: string; avatarColor: string; title: string | null };
