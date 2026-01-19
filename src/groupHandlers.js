// Group Handlers - Manage WhatsApp Groups

import { getPool } from './database.js';

/**
 * Upsert group from WhatsApp metadata
 * Creates or updates group record in database
 */
async function upsertGroup(sessionId, groupMetadata) {
  const connection = getPool();

  try {
    const groupId = groupMetadata.id; // Full JID with @g.us
    const groupIdWithoutSuffix = groupId.replace('@g.us', '');

    // Check if group exists
    const [existing] = await connection.query(
      `SELECT id FROM whatsapp_groups WHERE session_id = ? AND group_id = ?`,
      [sessionId, groupIdWithoutSuffix]
    );

    const groupData = {
      session_id: sessionId,
      group_id: groupIdWithoutSuffix,
      subject: groupMetadata.subject || null,
      description: groupMetadata.desc || null,
      profile_pic_url: groupMetadata.profilePicUrl || null,
      owner_jid: groupMetadata.owner || null,
      participant_count: groupMetadata.participants?.length || 0,
      is_broadcast: groupMetadata.isBroadcast || false,
      category: 'business', // Default, can be updated later
      last_interaction_at: new Date()
    };

    if (existing.length > 0) {
      // Update existing group
      await connection.query(
        `UPDATE whatsapp_groups SET
          subject = ?,
          description = ?,
          profile_pic_url = ?,
          participant_count = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [
          groupData.subject,
          groupData.description,
          groupData.profile_pic_url,
          groupData.participant_count,
          existing[0].id
        ]
      );

      console.log(`✓ Updated group: ${groupData.subject}`);
      return { ...groupData, id: existing[0].id };
    } else {
      // Create new group
      const [result] = await connection.query(
        `INSERT INTO whatsapp_groups (
          session_id, group_id, subject, description, profile_pic_url,
          owner_jid, participant_count, is_broadcast, category, last_interaction_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          groupData.session_id,
          groupData.group_id,
          groupData.subject,
          groupData.description,
          groupData.profile_pic_url,
          groupData.owner_jid,
          groupData.participant_count,
          groupData.is_broadcast,
          groupData.category,
          groupData.last_interaction_at
        ]
      );

      console.log(`✓ Created new group: ${groupData.subject}`);
      return { ...groupData, id: result.insertId };
    }
  } catch (error) {
    console.error('Error upserting group:', error);
    throw error;
  }
}

/**
 * Sync group participants from metadata
 */
async function syncGroupParticipants(groupId, participants) {
  const connection = getPool();

  try {
    // Get group ID from whatsapp_groups table
    const [groupData] = await connection.query(
      `SELECT id FROM whatsapp_groups WHERE group_id = ?`,
      [groupId]
    );

    if (groupData.length === 0) {
      console.warn(`Group ${groupId} not found in database`);
      return { synced: 0, updated: 0 };
    }

    const dbGroupId = groupData[0].id;
    let synced = 0;
    let updated = 0;

    for (const participant of participants) {
      const jid = participant.id;
      const name = participant.name || null;
      const isAdmin = participant.isAdmin || false;

      // Check if participant exists
      const [existing] = await connection.query(
        `SELECT id FROM group_participants WHERE group_id = ? AND participant_jid = ?`,
        [dbGroupId, jid]
      );

      if (existing.length > 0) {
        // Update if name or admin status changed
        await connection.query(
          `UPDATE group_participants SET
            participant_name = ?,
            is_admin = ?
          WHERE id = ?`,
          [name, isAdmin, existing[0].id]
        );
        updated++;
      } else {
        // Insert new participant
        await connection.query(
          `INSERT INTO group_participants (group_id, participant_jid, participant_name, is_admin)
           VALUES (?, ?, ?, ?)`,
          [dbGroupId, jid, name, isAdmin]
        );
        synced++;
      }
    }

    console.log(`✓ Synced participants for group ${groupId}: ${synced} new, ${updated} updated`);
    return { synced, updated, total: synced + updated };
  } catch (error) {
    console.error('Error syncing group participants:', error);
    throw error;
  }
}

/**
 * Get groups by session and category
 */
async function getGroupsByCategory(sessionId, category = 'all') {
  const connection = getPool();

  try {
    let query = `
      SELECT
        wg.id,
        wg.session_id,
        wg.group_id,
        wg.subject,
        wg.participant_count,
        wg.category,
        wg.last_interaction_at,
        wg.created_at,
        (
          SELECT content FROM messages
          WHERE group_id = wg.id
          ORDER BY timestamp DESC
          LIMIT 1
        ) as last_message_content,
        (
          SELECT CONCAT(participant_name, ': ', content)
          FROM messages
          WHERE group_id = wg.id
          ORDER BY timestamp DESC
          LIMIT 1
        ) as last_message_full,
        (
          SELECT participant_name FROM messages
          WHERE group_id = wg.id
          ORDER BY timestamp DESC
          LIMIT 1
        ) as last_sender_name,
        (
          SELECT timestamp FROM messages
          WHERE group_id = wg.id
          ORDER BY timestamp DESC
          LIMIT 1
        ) as last_message_timestamp,
        (
          SELECT COUNT(*) FROM messages
          WHERE group_id = wg.id AND direction = 'incoming'
        ) as unread_count
      FROM whatsapp_groups wg
      WHERE wg.session_id = ?
    `;

    const params = [sessionId];

    if (category !== 'all') {
      query += ` AND wg.category = ?`;
      params.push(category);
    }

    query += ` ORDER BY wg.last_interaction_at DESC`;

    const [groups] = await connection.query(query, params);

    return groups.map(g => ({
      id: g.id,
      sessionId: g.session_id,
      groupId: `${g.group_id}@g.us`,
      subject: g.subject || 'Unknown Group',
      participantCount: g.participant_count || 0,
      category: g.category,
      lastInteraction: g.last_interaction_at,
      lastMessage: g.last_message_content ? {
        content: g.last_message_content,
        senderName: g.last_sender_name || 'Someone',
        timestamp: g.last_message_timestamp
      } : null,
      unreadCount: g.unread_count || 0
    }));
  } catch (error) {
    console.error('Error getting groups:', error);
    throw error;
  }
}

/**
 * Get group details with participants
 */
async function getGroupDetails(sessionId, groupId) {
  const connection = getPool();

  try {
    const groupIdWithoutSuffix = groupId.replace('@g.us', '');

    // Get group info
    const [groups] = await connection.query(
      `SELECT * FROM whatsapp_groups WHERE session_id = ? AND group_id = ?`,
      [sessionId, groupIdWithoutSuffix]
    );

    if (groups.length === 0) {
      return null;
    }

    const group = groups[0];

    // Get participants
    const [participants] = await connection.query(
      `SELECT
        participant_jid,
        participant_name,
        is_admin,
        is_superadmin,
        joined_at
      FROM group_participants
      WHERE group_id = ?
      ORDER BY is_admin DESC, participant_name ASC`,
      [group.id]
    );

    return {
      id: group.id,
      sessionId: group.session_id,
      groupId: `${group.group_id}@g.us`,
      subject: group.subject,
      description: group.description,
      profilePicUrl: group.profile_pic_url,
      ownerJid: group.owner_jid,
      participantCount: group.participant_count,
      isBroadcast: group.is_broadcast,
      category: group.category,
      createdAt: group.created_at,
      lastInteraction: group.last_interaction_at,
      participants: participants.map(p => ({
        jid: p.participant_jid,
        name: p.participant_name,
        isAdmin: p.is_admin,
        isSuperAdmin: p.is_superadmin,
        joinedAt: p.joined_at
      }))
    };
  } catch (error) {
    console.error('Error getting group details:', error);
    throw error;
  }
}

/**
 * Get group details by database ID
 */
async function getGroupById(dbId) {
  const connection = getPool();

  try {
    const [groups] = await connection.query(
      `SELECT * FROM whatsapp_groups WHERE id = ?`,
      [dbId]
    );

    if (groups.length === 0) {
      return null;
    }

    const group = groups[0];

    return {
      id: group.id,
      sessionId: group.session_id,
      groupId: `${group.group_id}@g.us`,
      subject: group.subject,
      description: group.description,
      profilePicUrl: group.profile_pic_url,
      ownerJid: group.owner_jid,
      participantCount: group.participant_count,
      isBroadcast: group.is_broadcast,
      category: group.category,
      createdAt: group.created_at,
      lastInteraction: group.last_interaction_at
    };
  } catch (error) {
    console.error('Error getting group by ID:', error);
    throw error;
  }
}

/**
 * Update group category
 */
async function updateGroupCategory(sessionId, groupId, category) {
  const connection = getPool();

  try {
    const groupIdWithoutSuffix = groupId.replace('@g.us', '');

    await connection.query(
      `UPDATE whatsapp_groups SET category = ? WHERE session_id = ? AND group_id = ?`,
      [category, sessionId, groupIdWithoutSuffix]
    );

    console.log(`✓ Updated group ${groupId} category to ${category}`);
    return { success: true };
  } catch (error) {
    console.error('Error updating group category:', error);
    throw error;
  }
}

/**
 * Get group messages
 */
async function getGroupMessages(sessionId, groupId, limit = 50) {
  const connection = getPool();

  try {
    let dbGroupId;

    // Check if groupId is numeric (database ID) or a JID string
    if (/^\d+$/.test(groupId)) {
      // Numeric database ID - use directly
      console.log(`📂 Getting messages for group by database ID: ${groupId}`);
      dbGroupId = parseInt(groupId);
    } else {
      // JID format - need to lookup database ID
      const groupIdWithoutSuffix = groupId.replace('@g.us', '');
      console.log(`📂 Getting messages for group by JID: ${groupIdWithoutSuffix}`);

      const [groupData] = await connection.query(
        `SELECT id FROM whatsapp_groups WHERE session_id = ? AND group_id = ?`,
        [sessionId, groupIdWithoutSuffix]
      );

      if (groupData.length === 0) {
        console.log(`⚠️ Group not found with JID: ${groupIdWithoutSuffix}`);
        return [];
      }

      dbGroupId = groupData[0].id;
    }

    console.log(`📂 Querying messages with group_id: ${dbGroupId}, session: ${sessionId}`);

    const [messages] = await connection.query(
      `SELECT
        id,
        message_id,
        direction,
        message_type,
        content,
        media_url,
        timestamp,
        status,
        is_deleted,
        participant_jid,
        participant_name
      FROM messages
      WHERE session_id = ? AND group_id = ?
      ORDER BY timestamp ASC
      LIMIT ?`,
      [sessionId, dbGroupId, parseInt(limit)]
    );

    console.log(`📂 Found ${messages.length} messages`);

    return messages.map(m => ({
      id: m.id,
      messageId: m.message_id,
      direction: m.direction,
      type: m.message_type,
      content: m.content,
      mediaUrl: m.media_url,
      timestamp: m.timestamp,
      status: m.status,
      isDeleted: m.is_deleted,
      senderJid: m.participant_jid,
      senderName: m.participant_name || (m.direction === 'outgoing' ? 'You' : 'Someone')
    }));
  } catch (error) {
    console.error('Error getting group messages:', error);
    throw error;
  }
}

export {
  upsertGroup,
  syncGroupParticipants,
  getGroupsByCategory,
  getGroupDetails,
  getGroupById,
  updateGroupCategory,
  getGroupMessages
};
