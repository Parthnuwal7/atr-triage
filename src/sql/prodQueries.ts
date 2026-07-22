// READ-ONLY. Mirrors atr-be getRecentChatMessagesForEvalQuery ordering so pairing holds.
export const getTurnsInWindowQuery = `
  SELECT m.id AS message_id, m.chat_id, m.role, m.parts, m.created_at
  FROM messages m
  INNER JOIN chats c ON c.id = m.chat_id
  WHERE (c.client_fk = $1::uuid OR c.agency_fk = $1::uuid)
    AND m.created_at >= $2::timestamptz
    AND m.created_at < ($3::timestamptz + INTERVAL '1 day')
  ORDER BY m.chat_id ASC, m.created_at ASC
  LIMIT $4
`;

export const getVotesForChatsQuery = `
  SELECT message_id, is_upvoted
  FROM votes
  WHERE chat_id = ANY($1::text[])
`;

export const getWorkspaceMemoryQuery = `
  SELECT key, value FROM workspace_memories WHERE company_fk = $1 ORDER BY updated_at DESC LIMIT 200
`;

export const getUserPreferencesQuery = `
  SELECT key, value FROM user_preferences WHERE user_fk = $1 ORDER BY updated_at DESC LIMIT 200
`;

// Mirrors atr-be's active-memory read: memory_content column, only live (active,
// not expired) rows, most-relevant first.
export const getConversationMemoryQuery = `
  SELECT memory_content AS value
  FROM conversation_memory
  WHERE chat_id = $1
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > NOW())
  ORDER BY relevance_score DESC, created_at DESC
  LIMIT 50
`;
