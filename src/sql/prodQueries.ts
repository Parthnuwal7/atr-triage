// READ-ONLY. Mirrors atr-be getRecentChatMessagesForEvalQuery ordering so pairing holds.
export const getTurnsInWindowQuery = `
  WITH scoped_assistants AS (
    SELECT m.id, m.chat_id, m.role, m.parts, m.created_at
    FROM messages m
    INNER JOIN chats c ON c.id = m.chat_id
    WHERE (c.client_fk = $1::uuid OR c.agency_fk = $1::uuid)
      AND m.role = 'assistant'
      AND m.created_at >= $2::timestamptz
      AND m.created_at < ($3::timestamptz + INTERVAL '1 day')
    ORDER BY m.created_at ASC, m.id ASC
    LIMIT $4
  ),
  complete_turns AS (
    SELECT a.id AS assistant_id, a.id AS message_id, a.chat_id, a.role, a.parts, a.created_at
    FROM scoped_assistants a
    UNION ALL
    SELECT a.id AS assistant_id, u.id AS message_id, u.chat_id, u.role, u.parts, u.created_at
    FROM scoped_assistants a
    CROSS JOIN LATERAL (
      SELECT m.id, m.chat_id, m.role, m.parts, m.created_at
      FROM messages m
      WHERE m.chat_id = a.chat_id AND m.role = 'user' AND m.created_at <= a.created_at
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    ) u
  )
  SELECT message_id, chat_id, role, parts, created_at
  FROM complete_turns
  ORDER BY assistant_id, created_at, message_id
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
