// src/analyticsRoutes.js
// Analytics and reporting endpoints for CRM Boarding School

import express from 'express';
const router = express.Router();
import { getPool } from './database.js';

/**
 * GET /api/analytics/funnel
 * Funnel conversion report
 */
router.get('/analytics/funnel', async (req, res) => {
  try {
    const { sessionId, category } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connection = getPool();

    let categoryFilter = '';
    const params = [sessionId];

    if (category) {
      categoryFilter = 'AND category = ?';
      params.push(category);
    }

    // Get all lead statuses ordered by order_index
    const [statuses] = await connection.query(
      `SELECT * FROM lead_statuses WHERE session_id = ? ${categoryFilter} ORDER BY order_index`,
      params
    );

    // Get contact counts per status
    const funnel = await Promise.all(
      statuses.map(async (status) => {
        const [counts] = await connection.query(
          `SELECT COUNT(*) as count FROM contacts WHERE session_id = ? AND lead_status_id = ?`,
          [sessionId, status.id]
        );

        return {
          id: status.id,
          name: status.name,
          order: status.order_index,
          color: status.color,
          category: status.category,
          count: counts[0].count
        };
      })
    );

    // Calculate conversion rates between stages
    const total = funnel.reduce((sum, stage) => sum + stage.count, 0);
    let cumulativeCount = 0;

    const funnelWithConversion = funnel.map((stage) => {
      const conversionRate = cumulativeCount > 0
        ? ((stage.count / cumulativeCount) * 100).toFixed(1)
        : null;
      const percentageOfTotal = total > 0
        ? ((stage.count / total) * 100).toFixed(1)
        : 0;

      cumulativeCount += stage.count;

      return {
        ...stage,
        percentageOfTotal: parseFloat(percentageOfTotal),
        conversionRate: conversionRate ? parseFloat(conversionRate) : null
      };
    });

    res.json({
      funnel: funnelWithConversion,
      total,
      category: category || 'all'
    });
  } catch (error) {
    console.error('Error generating funnel report:', error);
    res.status(500).json({ error: 'Failed to generate funnel report' });
  }
});

/**
 * GET /api/analytics/funnel/stages
 * Funnel stage breakdown
 */
router.get('/analytics/funnel/stages', async (req, res) => {
  try {
    const { sessionId, category } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connection = getPool();

    let categoryFilter = '';
    const params = [sessionId];

    if (category) {
      categoryFilter = 'AND ls.category = ?';
      params.push(category);
    }

    const [stages] = await connection.query(
      `SELECT
        ls.id,
        ls.name,
        ls.order_index,
        ls.color,
        ls.category,
        COUNT(c.id) as contact_count,
        COUNT(DISTINCT c.phone) as unique_contacts
      FROM lead_statuses ls
      LEFT JOIN contacts c ON ls.id = c.lead_status_id AND c.session_id = ls.session_id
      WHERE ls.session_id = ? ${categoryFilter}
      GROUP BY ls.id
      ORDER BY ls.order_index`,
      params
    );

    // Get contacts for each stage (first 20 for preview)
    const stagesWithContacts = await Promise.all(
      stages.map(async (stage) => {
        const [contacts] = await connection.query(
          `SELECT id, name, phone, contact_type, created_at
           FROM contacts
           WHERE session_id = ? AND lead_status_id = ?
           ORDER BY updated_at DESC
           LIMIT 20`,
          [sessionId, stage.id]
        );

        return {
          ...stage,
          contacts: contacts.map(c => ({
            id: c.id,
            name: c.name,
            phone: c.phone,
            contactType: c.contact_type,
            createdAt: c.created_at
          }))
        };
      })
    );

    res.json({ stages: stagesWithContacts });
  } catch (error) {
    console.error('Error fetching funnel stages:', error);
    res.status(500).json({ error: 'Failed to fetch funnel stages' });
  }
});

/**
 * GET /api/analytics/sources
 * Lead source attribution
 */
router.get('/analytics/sources', async (req, res) => {
  try {
    const { sessionId } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connection = getPool();

    const [sources] = await connection.query(
      `SELECT
        source,
        COUNT(*) as count,
        COUNT(DISTINCT phone) as unique_contacts
      FROM contacts
      WHERE session_id = ?
      GROUP BY source
      ORDER BY count DESC`,
      [sessionId]
    );

    const total = sources.reduce((sum, s) => sum + s.count, 0);

    const sourcesWithPercentage = sources.map(s => ({
      ...s,
      percentage: total > 0 ? ((s.count / total) * 100).toFixed(1) : 0
    }));

    res.json({
      sources: sourcesWithPercentage,
      total
    });
  } catch (error) {
    console.error('Error fetching sources:', error);
    res.status(500).json({ error: 'Failed to fetch sources' });
  }
});

/**
 * GET /api/analytics/activities/summary
 * Activity statistics summary
 */
router.get('/analytics/activities/summary', async (req, res) => {
  try {
    const { sessionId, startDate, endDate } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connection = getPool();

    let dateFilter = '';
    const params = [sessionId];

    if (startDate) {
      dateFilter = 'AND activity_date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      dateFilter += ' AND activity_date <= ?';
      params.push(endDate);
    }

    // Get activity counts by type
    const [byType] = await connection.query(
      `SELECT
        at.name as type_name,
        at.icon as type_icon,
        at.color as type_color,
        COUNT(a.id) as count
      FROM activity_types at
      LEFT JOIN activities a ON at.id = a.activity_type_id AND a.session_id = at.session_id ${dateFilter.replace(/a\./g, 'a.')}
      WHERE at.session_id = ?
      GROUP BY at.id
      ORDER BY count DESC`,
      params
    );

    // Get activities over time (last 30 days by default)
    const [timeline] = await connection.query(
      `SELECT
        DATE(activity_date) as date,
        COUNT(*) as count
      FROM activities
      WHERE session_id = ? ${dateFilter}
      GROUP BY DATE(activity_date)
      ORDER BY date DESC
      LIMIT 30`,
      params
    );

    // Get top contacts by activity count
    const [topContacts] = await connection.query(
      `SELECT
        c.id,
        c.name,
        c.phone,
        COUNT(a.id) as activity_count
      FROM contacts c
      JOIN activities a ON c.id = a.contact_id
      WHERE c.session_id = ? ${dateFilter}
      GROUP BY c.id
      ORDER BY activity_count DESC
      LIMIT 10`,
      params
    );

    // Get next actions due
    const [nextActionsDue] = await connection.query(
      `SELECT
        a.id,
        a.title,
        a.next_action,
        a.next_action_date,
        c.name as contact_name,
        c.phone as contact_phone
      FROM activities a
      JOIN contacts c ON a.contact_id = c.id
      WHERE a.session_id = ? AND a.next_action_date IS NOT NULL ${dateFilter}
      ORDER BY a.next_action_date ASC
      LIMIT 20`,
      params
    );

    const totalActivities = byType.reduce((sum, t) => sum + t.count, 0);

    res.json({
      summary: {
        totalActivities,
        byType: byType.map(t => ({
          name: t.type_name,
          icon: t.type_icon,
          color: t.type_color,
          count: t.count,
          percentage: totalActivities > 0 ? ((t.count / totalActivities) * 100).toFixed(1) : 0
        })),
        timeline: timeline.map(t => ({
          date: t.date,
          count: t.count
        })),
        topContacts: topContacts.map(c => ({
          id: c.id,
          name: c.name,
          phone: c.phone,
          activityCount: c.activity_count
        })),
        nextActionsDue: nextActionsDue.map(a => ({
          id: a.id,
          title: a.title,
          nextAction: a.next_action,
          nextActionDate: a.next_action_date,
          contactName: a.contact_name,
          contactPhone: a.contact_phone
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching activity summary:', error);
    res.status(500).json({ error: 'Failed to fetch activity summary' });
  }
});

/**
 * GET /api/analytics/conversion
 * Conversion metrics over time
 */
router.get('/analytics/conversion', async (req, res) => {
  try {
    const { sessionId, period = '30' } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connection = getPool();

    // Get contacts converted by day
    const [dailyConversions] = await connection.query(
      `SELECT
        DATE(c.created_at) as date,
        COUNT(*) as new_contacts,
        SUM(CASE WHEN c.lead_status_id IN (
          SELECT id FROM lead_statuses WHERE name IN ('Closed Won', 'Enrolled', 'Accepted')
        ) THEN 1 ELSE 0 END) as converted
      FROM contacts c
      WHERE c.session_id = ?
        AND c.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      GROUP BY DATE(c.created_at)
      ORDER BY date DESC`,
      [sessionId, parseInt(period)]
    );

    // Get conversion by contact type
    const [byType] = await connection.query(
      `SELECT
        c.contact_type,
        COUNT(*) as total,
        SUM(CASE WHEN ls.name IN ('Closed Won', 'Enrolled', 'Accepted') THEN 1 ELSE 0 END) as converted
      FROM contacts c
      LEFT JOIN lead_statuses ls ON c.lead_status_id = ls.id
      WHERE c.session_id = ?
      GROUP BY c.contact_type`,
      [sessionId]
    );

    // Calculate overall conversion rate
    const [totalStats] = await connection.query(
      `SELECT
        COUNT(*) as total_contacts,
        SUM(CASE WHEN ls.name IN ('Closed Won', 'Enrolled', 'Accepted') THEN 1 ELSE 0 END) as total_converted
      FROM contacts c
      LEFT JOIN lead_statuses ls ON c.lead_status_id = ls.id
      WHERE c.session_id = ?`,
      [sessionId]
    );

    const overallConversionRate = totalStats[0].total_contacts > 0
      ? ((totalStats[0].total_converted / totalStats[0].total_contacts) * 100).toFixed(2)
      : 0;

    res.json({
      overall: {
        totalContacts: totalStats[0].total_contacts,
        totalConverted: totalStats[0].total_converted,
        conversionRate: parseFloat(overallConversionRate)
      },
      byType: byType.map(t => ({
        contactType: t.contact_type,
        total: t.total,
        converted: t.converted,
        conversionRate: t.total > 0 ? ((t.converted / t.total) * 100).toFixed(2) : 0
      })),
      timeline: dailyConversions.map(d => ({
        date: d.date,
        newContacts: d.new_contacts,
        converted: d.converted,
        conversionRate: d.new_contacts > 0 ? ((d.converted / d.new_contacts) * 100).toFixed(2) : 0
      }))
    });
  } catch (error) {
    console.error('Error fetching conversion metrics:', error);
    res.status(500).json({ error: 'Failed to fetch conversion metrics' });
  }
});

/**
 * GET /api/analytics/dashboard
 * Dashboard overview with key metrics
 */
router.get('/analytics/dashboard', async (req, res) => {
  try {
    const { sessionId } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connection = getPool();

    // Get contact counts by type
    const [byType] = await connection.query(
      `SELECT contact_type, COUNT(*) as count
       FROM contacts
       WHERE session_id = ? AND is_group = FALSE
       GROUP BY contact_type`,
      [sessionId]
    );

    const contactTypes = {
      student_parent: 0,
      prospect_parent: 0,
      alumni_parent: 0,
      external: 0
    };

    byType.forEach(row => {
      contactTypes[row.contact_type] = row.count;
    });

    // Get lead status breakdown
    const [byStatus] = await connection.query(
      `SELECT ls.name, ls.color, COUNT(c.id) as count
       FROM lead_statuses ls
       LEFT JOIN contacts c ON ls.id = c.lead_status_id AND c.session_id = ls.session_id
       WHERE ls.session_id = ?
       GROUP BY ls.id
       ORDER BY ls.order_index`,
      [sessionId]
    );

    // Get recent activities
    const [recentActivities] = await connection.query(
      `SELECT
        a.id,
        a.title,
        a.activity_date,
        at.name as type_name,
        at.icon as type_icon,
        c.name as contact_name
      FROM activities a
      JOIN activity_types at ON a.activity_type_id = at.id
      JOIN contacts c ON a.contact_id = c.id
      WHERE a.session_id = ?
      ORDER BY a.activity_date DESC
      LIMIT 10`,
      [sessionId]
    );

    // Get message stats
    const [messageStats] = await connection.query(
      `SELECT
        COUNT(*) as total_messages,
        SUM(CASE WHEN direction = 'incoming' THEN 1 ELSE 0 END) as incoming,
        SUM(CASE WHEN direction = 'outgoing' THEN 1 ELSE 0 END) as outgoing
      FROM messages
      WHERE session_id = ?`,
      [sessionId]
    );

    // Get next actions due this week
    const [upcomingActions] = await connection.query(
      `SELECT
        a.id,
        a.title,
        a.next_action,
        a.next_action_date,
        c.name as contact_name,
        c.phone as contact_phone
      FROM activities a
      JOIN contacts c ON a.contact_id = c.id
      WHERE a.session_id = ?
        AND a.next_action_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
      ORDER BY a.next_action_date ASC
      LIMIT 10`,
      [sessionId]
    );

    res.json({
      contactTypes,
      leadStatuses: byStatus.map(s => ({
        name: s.name,
        color: s.color,
        count: s.count
      })),
      recentActivities: recentActivities.map(a => ({
        id: a.id,
        title: a.title,
        activityDate: a.activity_date,
        typeName: a.type_name,
        typeIcon: a.type_icon,
        contactName: a.contact_name
      })),
      messageStats: {
        total: messageStats[0].total_messages || 0,
        incoming: messageStats[0].incoming || 0,
        outgoing: messageStats[0].outgoing || 0
      },
      upcomingActions: upcomingActions.map(a => ({
        id: a.id,
        title: a.title,
        nextAction: a.next_action,
        nextActionDate: a.next_action_date,
        contactName: a.contact_name,
        contactPhone: a.contact_phone
      }))
    });
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

/**
 * GET /api/analytics/cs/response-time
 * CS Performance - Average response time calculation
 */
router.get('/analytics/cs/response-time', async (req, res) => {
  try {
    const { sessionId, period = '7d' } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connection = getPool();

    // Calculate date range based on period
    const startDate = new Date();
    if (period === 'today') {
      startDate.setHours(0, 0, 0, 0);
    } else if (period === '7d') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === '30d') {
      startDate.setDate(startDate.getDate() - 30);
    }

    const endDate = new Date();

    // Method 1: Quoted Message Pairing (most accurate for direct replies)
    const [quotedResponseTimes] = await connection.query(
      `SELECT
        AVG(TIMESTAMPDIFF(SECOND, q.timestamp, a.timestamp)) as avg_response_seconds,
        MIN(TIMESTAMPDIFF(SECOND, q.timestamp, a.timestamp)) as min_response_seconds,
        MAX(TIMESTAMPDIFF(SECOND, q.timestamp, a.timestamp)) as max_response_seconds,
        COUNT(*) as conversation_count
      FROM messages q
      JOIN messages a ON q.quoted_message_id = a.message_id
      WHERE q.session_id = ?
        AND q.direction = 'incoming'
        AND a.direction = 'outgoing'
        AND q.timestamp BETWEEN ? AND ?`,
      [sessionId, startDate, endDate]
    );

    // Calculate response distribution
    const [responseDistribution] = await connection.query(
      `SELECT
        COUNT(CASE WHEN TIMESTAMPDIFF(SECOND, q.timestamp, a.timestamp) <= 60 THEN 1 END) as under_1min,
        COUNT(CASE WHEN TIMESTAMPDIFF(SECOND, q.timestamp, a.timestamp) <= 300 THEN 1 END) as under_5min,
        COUNT(CASE WHEN TIMESTAMPDIFF(SECOND, q.timestamp, a.timestamp) <= 900 THEN 1 END) as under_15min,
        COUNT(CASE WHEN TIMESTAMPDIFF(SECOND, q.timestamp, a.timestamp) > 900 THEN 1 END) as over_15min
      FROM messages q
      JOIN messages a ON q.quoted_message_id = a.message_id
      WHERE q.session_id = ?
        AND q.direction = 'incoming'
        AND a.direction = 'outgoing'
        AND q.timestamp BETWEEN ? AND ?`,
      [sessionId, startDate, endDate]
    );

    const avgSeconds = quotedResponseTimes[0].avg_response_seconds || 0;
    const totalConversations = quotedResponseTimes[0].conversation_count || 0;

    // Format response time
    const formatTime = (seconds) => {
      if (!seconds || seconds === 0) return '-';
      const minutes = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
    };

    const distribution = responseDistribution[0];
    const totalResponses = distribution.under_1min + distribution.over_15min ||
                          distribution.under_1min + distribution.under_5min + distribution.under_15min + distribution.over_15min;

    res.json({
      period,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      averageResponseTime: {
        seconds: Math.round(avgSeconds),
        formatted: formatTime(avgSeconds),
        trend: '+0% vs prev period' // TODO: Implement trend calculation
      },
      responseDistribution: {
        under1Min: totalResponses > 0 ? Math.round((distribution.under_1min / totalResponses) * 100) : 0,
        under5Min: totalResponses > 0 ? Math.round((distribution.under_5min / totalResponses) * 100) : 0,
        under15Min: totalResponses > 0 ? Math.round((distribution.under_15min / totalResponses) * 100) : 0,
        over15Min: totalResponses > 0 ? Math.round((distribution.over_15min / totalResponses) * 100) : 0
      },
      totalConversations,
      fastestResponse: formatTime(quotedResponseTimes[0].min_response_seconds),
      slowestResponse: formatTime(quotedResponseTimes[0].max_response_seconds)
    });
  } catch (error) {
    console.error('Error calculating response time:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to calculate response time', details: error.message });
  }
});

/**
 * GET /api/analytics/cs/message-volume
 * CS Performance - Daily message volume analytics
 */
router.get('/analytics/cs/message-volume', async (req, res) => {
  try {
    const { sessionId, period = '7d' } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connection = getPool();

    // Calculate date range based on period
    const startDate = new Date();
    if (period === 'today') {
      startDate.setHours(0, 0, 0, 0);
    } else if (period === '7d') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === '30d') {
      startDate.setDate(startDate.getDate() - 30);
    }

    const endDate = new Date();

    // Get daily message volumes
    const [dailyVolumes] = await connection.query(
      `SELECT
        DATE(timestamp) as date,
        SUM(CASE WHEN direction = 'incoming' THEN 1 ELSE 0 END) as incoming_count,
        SUM(CASE WHEN direction = 'outgoing' THEN 1 ELSE 0 END) as outgoing_count,
        COUNT(*) as total_count
      FROM messages
      WHERE session_id = ?
        AND timestamp BETWEEN ? AND ?
      GROUP BY DATE(timestamp)
      ORDER BY date ASC`,
      [sessionId, startDate, endDate]
    );

    // Calculate summary statistics
    const totalIncoming = dailyVolumes.reduce((sum, d) => sum + (d.incoming_count || 0), 0);
    const totalOutgoing = dailyVolumes.reduce((sum, d) => sum + (d.outgoing_count || 0), 0);
    const totalMessages = totalIncoming + totalOutgoing;
    const avgPerDay = dailyVolumes.length > 0 ? Math.round(totalMessages / dailyVolumes.length) : 0;

    // Find peak day
    const peakDay = dailyVolumes.length > 0
      ? dailyVolumes.reduce((max, d) => d.total_count > max.total_count ? d : max, dailyVolumes[0])
      : null;

    res.json({
      period,
      dailyVolumes: dailyVolumes.map(d => ({
        date: d.date,
        incoming: d.incoming_count || 0,
        outgoing: d.outgoing_count || 0,
        total: d.total_count || 0
      })),
      summary: {
        totalIncoming,
        totalOutgoing,
        avgPerDay,
        peakDay: peakDay ? peakDay.date : null,
        peakVolume: peakDay ? peakDay.total_count : 0
      }
    });
  } catch (error) {
    console.error('Error fetching message volume:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to fetch message volume', details: error.message });
  }
});

/**
 * GET /api/analytics/cs/hourly-performance
 * CS Performance - Hourly performance analysis (peak hours)
 */
router.get('/analytics/cs/hourly-performance', async (req, res) => {
  try {
    const { sessionId, period = '7d' } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connection = getPool();

    // Calculate date range based on period
    const startDate = new Date();
    if (period === 'today') {
      startDate.setHours(0, 0, 0, 0);
    } else if (period === '7d') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === '30d') {
      startDate.setDate(startDate.getDate() - 30);
    }

    const endDate = new Date();

    // Get hourly message distribution and response times
    const [hourlyData] = await connection.query(
      `SELECT
        HOUR(timestamp) as hour,
        COUNT(*) as total_messages,
        SUM(CASE WHEN direction = 'incoming' THEN 1 ELSE 0 END) as incoming_count,
        SUM(CASE WHEN direction = 'outgoing' THEN 1 ELSE 0 END) as outgoing_count
      FROM messages
      WHERE session_id = ?
        AND timestamp BETWEEN ? AND ?
      GROUP BY HOUR(timestamp)
      ORDER BY hour ASC`,
      [sessionId, startDate, endDate]
    );

    // Calculate average response time per hour
    const [responseTimeByHour] = await connection.query(
      `SELECT
        HOUR(a.timestamp) as hour,
        AVG(TIMESTAMPDIFF(SECOND, q.timestamp, a.timestamp)) as avg_response_seconds
      FROM messages a
      JOIN messages q ON a.quoted_message_id = q.message_id
      WHERE a.session_id = ?
        AND a.direction = 'outgoing'
        AND q.direction = 'incoming'
        AND a.timestamp BETWEEN ? AND ?
      GROUP BY HOUR(a.timestamp)`,
      [sessionId, startDate, endDate]
    );

    // Merge response times into hourly data
    const responseTimeMap = new Map(
      responseTimeByHour.map(r => [r.hour, r.avg_response_seconds])
    );

    const enrichedHourlyData = hourlyData.map(h => ({
      hour: h.hour,
      totalMessages: h.total_messages || 0,
      incoming: h.incoming_count || 0,
      outgoing: h.outgoing_count || 0,
      avgResponseTime: responseTimeMap.get(h.hour) || null
    }));

    // Find peak and quiet hours
    const peakHour = hourlyData.length > 0
      ? hourlyData.reduce((max, h) => h.total_messages > max.total_messages ? h : max, hourlyData[0])
      : null;

    const quietHour = hourlyData.length > 0
      ? hourlyData.reduce((min, h) => h.total_messages < min.total_messages ? h : min, hourlyData[0])
      : null;

    res.json({
      period,
      hourlyData: enrichedHourlyData,
      peakHour: peakHour ? {
        hour: peakHour.hour,
        volume: peakHour.total_messages,
        avgResponseTime: responseTimeMap.get(peakHour.hour) || null
      } : null,
      quietHour: quietHour ? {
        hour: quietHour.hour,
        volume: quietHour.total_messages
      } : null
    });
  } catch (error) {
    console.error('Error calculating hourly performance:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to calculate hourly performance', details: error.message });
  }
});

/**
 * GET /api/analytics/cs/top-contacts
 * CS Performance - Top active contacts
 */
router.get('/analytics/cs/top-contacts', async (req, res) => {
  try {
    const { sessionId, period = '7d', limit = 10 } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connection = getPool();

    // Calculate date range based on period
    const startDate = new Date();
    if (period === 'today') {
      startDate.setHours(0, 0, 0, 0);
    } else if (period === '7d') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === '30d') {
      startDate.setDate(startDate.getDate() - 30);
    }

    const endDate = new Date();

    // Get top contacts by message count
    const [topContacts] = await connection.query(
      `SELECT
        c.id,
        c.name,
        c.phone,
        COUNT(m.id) as message_count,
        MAX(m.timestamp) as last_message_at,
        SUM(CASE WHEN m.direction = 'incoming' THEN 1 ELSE 0 END) as incoming_count,
        SUM(CASE WHEN m.direction = 'outgoing' THEN 1 ELSE 0 END) as outgoing_count
      FROM contacts c
      JOIN messages m ON c.id = m.contact_id
      WHERE c.session_id = ?
        AND m.timestamp BETWEEN ? AND ?
      GROUP BY c.id
      ORDER BY message_count DESC
      LIMIT ?`,
      [sessionId, startDate, endDate, parseInt(limit)]
    );

    // Format last message time
    const formatLastMessage = (timestamp) => {
      if (!timestamp) return null;
      const now = new Date();
      const diff = now - new Date(timestamp);
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);

      if (minutes < 60) return `${minutes}m lalu`;
      if (hours < 24) return `${hours}j lalu`;
      return `${days}h lalu`;
    };

    res.json({
      period,
      contacts: topContacts.map(c => ({
        id: c.id,
        name: c.name || 'Unknown',
        phone: c.phone,
        messageCount: c.message_count || 0,
        incomingCount: c.incoming_count || 0,
        outgoingCount: c.outgoing_count || 0,
        lastMessageAt: c.last_message_at,
        lastMessageFormatted: formatLastMessage(c.last_message_at)
      })),
      totalAnalyzed: topContacts.length
    });
  } catch (error) {
    console.error('Error fetching top contacts:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to fetch top contacts', details: error.message });
  }
});

export default router;
