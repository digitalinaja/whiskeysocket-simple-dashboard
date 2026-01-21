// Groups Module - Handles WhatsApp Groups UI and Logic

const Groups = {
  currentCategory: 'all',
  currentSession: null,
  selectedGroup: null,
  groups: [],
  selectedMedia: null,
  currentMessages: [],
  reactionMap: {},

  // Initialize Groups module
  init() {
    console.log('Groups module initialized');
    this.bindEvents();
    this.setupSocketListeners();
    this.loadSessions();
  },

  // Load available sessions
  async loadSessions() {
    try {
      const response = await fetch('/sessions');
      const data = await response.json();

      const sessions = data.sessions || [];
      this.populateSessionSelector(sessions);

      // Set first session as current if available
      if (sessions.length > 0 && !this.currentSession) {
        this.currentSession = sessions[0].id;
        this.loadGroups();
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  },

  // Populate session selector dropdown
  populateSessionSelector(sessions) {
    const selector = document.getElementById('groupsSessionSelect');
    if (!selector) return;

    selector.innerHTML = sessions.map(session => {
      const userName = session.user?.name || session.id;
      return `<option value="${session.id}">${userName}</option>`;
    }).join('');

    // Set current session
    if (this.currentSession) {
      selector.value = this.currentSession;
    }
  },

  // Bind DOM events
  bindEvents() {
    // Session selector
    const groupsSessionSelect = document.getElementById('groupsSessionSelect');
    if (groupsSessionSelect) {
      groupsSessionSelect.addEventListener('change', (e) => {
        this.currentSession = e.target.value;
        this.loadGroups();
      });
    }

    // Search input
    const groupsSearchInput = document.getElementById('groupsSearchInput');
    if (groupsSearchInput) {
      groupsSearchInput.addEventListener('input', (e) => {
        this.filterGroups(e.target.value);
      });
    }

    // Category tabs
    const categoryTabs = document.querySelectorAll('.category-tab');
    categoryTabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        const category = e.currentTarget.dataset.category;
        this.switchCategory(category);
      });
    });

    // Send message button
    const sendGroupMessageBtn = document.getElementById('sendGroupMessageBtn');
    if (sendGroupMessageBtn) {
      sendGroupMessageBtn.addEventListener('click', () => {
        this.sendMessage();
      });
    }

    // Message input - Enter to send
    const groupMessageInput = document.getElementById('groupMessageInput');
    if (groupMessageInput) {
      groupMessageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendMessage();
        }
      });
    }

    // Attach media button
    const attachGroupMediaBtn = document.getElementById('attachGroupMediaBtn');
    if (attachGroupMediaBtn) {
      attachGroupMediaBtn.addEventListener('click', () => {
        document.getElementById('groupMediaInput').click();
      });
    }

    // Media input change
    const groupMediaInput = document.getElementById('groupMediaInput');
    if (groupMediaInput) {
      groupMediaInput.addEventListener('change', (e) => {
        this.handleMediaSelect(e);
      });
    }

    // Clear media button
    const clearGroupMediaBtn = document.getElementById('clearGroupMediaBtn');
    if (clearGroupMediaBtn) {
      clearGroupMediaBtn.addEventListener('click', () => {
        this.clearSelectedMedia();
      });
    }

    // Refresh button
    const refreshGroupChatBtn = document.getElementById('refreshGroupChatBtn');
    if (refreshGroupChatBtn) {
      refreshGroupChatBtn.addEventListener('click', () => {
        if (this.selectedGroup) {
          this.loadGroupMessages(this.selectedGroup.id);
        }
      });
    }

    // View participants button
    const viewParticipantsBtn = document.getElementById('viewParticipantsBtn');
    if (viewParticipantsBtn) {
      viewParticipantsBtn.addEventListener('click', () => {
        this.showParticipants();
      });
    }

    // Category badge buttons - event delegation
    const groupsList = document.getElementById('groupsList');
    if (groupsList) {
      groupsList.addEventListener('click', (e) => {
        if (e.target.classList.contains('category-badge-btn') || e.target.closest('.category-badge-btn')) {
          const btn = e.target.classList.contains('category-badge-btn') ? e.target : e.target.closest('.category-badge-btn');
          const groupId = parseInt(btn.dataset.groupId);
          const currentCategory = btn.dataset.currentCategory;
          this.showCategoryModal(groupId, currentCategory);
        }
      });
    }
  },

  // Setup Socket.io listeners
  setupSocketListeners() {
    if (typeof socket === 'undefined') return;

    // Listen for new group messages
    socket.on('chat.newGroupMessage', (data) => {
      console.log('New group message received:', data);
      this.handleNewMessage(data);
    });

    // Listen for group updates
    socket.on('group.updated', (data) => {
      console.log('Group updated:', data);
      this.updateGroup(data.group);
    });
  },

  // Switch category tab
  switchCategory(category) {
    this.currentCategory = category;

    // Update active state
    document.querySelectorAll('.category-tab').forEach(tab => {
      tab.classList.remove('active');
      if (tab.dataset.category === category) {
        tab.classList.add('active');
      }
    });

    // Reload groups with new filter
    this.loadGroups();
  },

  // Load groups from API
  async loadGroups() {
    if (!this.currentSession) {
      this.showEmptyState();
      return;
    }

    try {
      const response = await fetch(`/api/groups?sessionId=${this.currentSession}&category=${this.currentCategory}`);
      const data = await response.json();

      if (data.groups) {
        this.groups = data.groups;
        this.renderGroupsList();
        this.updateCategoryCounts();
      }
    } catch (error) {
      console.error('Failed to load groups:', error);
      this.showError('Failed to load groups');
    }
  },

  // Render groups list
  renderGroupsList() {
    const groupsList = document.getElementById('groupsList');
    if (!groupsList) return;

    if (this.groups.length === 0) {
      groupsList.innerHTML = `
        <div class="empty-state">
          <div class="text-2xl mb-2">👥</div>
          <p>No groups found</p>
          <p class="text-xs mt-1">Groups will appear here when you receive messages</p>
        </div>
      `;
      return;
    }

    groupsList.innerHTML = this.groups.map(group => this.renderGroupCard(group)).join('');

    // Add click listeners to group cards
    groupsList.querySelectorAll('.contact-item.group-item').forEach(card => {
      card.addEventListener('click', () => {
        const groupId = parseInt(card.dataset.groupId);
        this.selectGroup(groupId);
      });
    });
  },

  // Render single group card
  renderGroupCard(group) {
    const lastMessage = group.lastMessage || {};
    const senderName = lastMessage.senderName || 'Someone';
    const preview = lastMessage.content || 'No messages yet';
    const time = lastMessage.timestamp ? this.formatTime(lastMessage.timestamp) : '';

    // Category badge styles
    const categoryIcons = {
      'business': '💼',
      'internal': '👔',
      'personal': '🏠'
    };
    const categoryIcon = categoryIcons[group.category] || '💼';
    const categoryLabel = group.category ? group.category.charAt(0).toUpperCase() + group.category.slice(1) : 'Business';

    return `
      <div class="contact-item group-item" data-group-id="${group.id}">
        <div class="contact-avatar">👥</div>
        <div class="contact-item-info">
          <div class="contact-item-name">
            ${this.escapeHtml(group.subject)}
            <button class="category-badge-btn" data-group-id="${group.id}" data-current-category="${group.category || 'business'}" title="Click to change category">
              ${categoryIcon} ${categoryLabel}
            </button>
          </div>
          <div class="contact-item-meta">
            <span>👤 ${group.participantCount || 0}</span>
            ${time ? `<span>• ${time}</span>` : ''}
          </div>
          <div class="contact-item-preview">
            <span class="sender-name">${this.escapeHtml(senderName)}:</span>
            <span>${this.escapeHtml(preview)}</span>
          </div>
        </div>
      </div>
    `;
  },

  // Select a group
  async selectGroup(groupId) {
    const group = this.groups.find(g => g.id === groupId);
    if (!group) return;

    this.selectedGroup = group;

    // Update active state
    document.querySelectorAll('.contact-item').forEach(item => {
      item.classList.remove('active');
      if (item.classList.contains('group-item') && parseInt(item.dataset.groupId) === groupId) {
        item.classList.add('active');
      }
    });

    // Show chat conversation
    document.getElementById('groupChatWelcome').style.display = 'none';
    document.getElementById('groupConversation').style.display = 'flex';

    // Fetch fresh group info to get accurate participant count
    try {
      const response = await fetch(`/api/groups/${groupId}?sessionId=${this.currentSession}`);
      if (response.ok) {
        const freshGroupData = await response.json();
        // Update local group data with fresh data
        if (freshGroupData.group) {
          Object.assign(group, freshGroupData.group);
        }
      }
    } catch (error) {
      console.warn('Failed to fetch fresh group info, using cached data:', error);
    }

    // Update group info in header
    document.getElementById('groupChatName').textContent = group.subject;
    document.getElementById('groupChatMeta').textContent = `👤 ${group.participantCount || 0} members • ${this.getCategoryIcon(group.category)} ${this.capitalizeFirst(group.category)}`;

    // Load messages
    this.loadGroupMessages(groupId);
  },

  // Load group messages
  async loadGroupMessages(groupId) {
    const container = document.getElementById('groupMessagesContainer');
    if (!container) return;

    container.innerHTML = '<div class="loading-groups">Loading messages...</div>';

    try {
      const response = await fetch(`/api/groups/${groupId}/messages?sessionId=${this.currentSession}&limit=50`);
      const data = await response.json();

      if (data.messages) {
        this.currentMessages = this.annotateMessagesWithReactions(data.messages);
        this.renderMessages(this.currentMessages);
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
      container.innerHTML = '<div class="empty-state">Failed to load messages</div>';
    }
  },

  // Render group messages
  renderMessages(messages) {
    const container = document.getElementById('groupMessagesContainer');
    if (!container) return;

    if (messages.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No messages in this group yet</p>
        </div>
      `;
      return;
    }

    // Group consecutive messages from same sender
    const groupedMessages = [];
    let lastSender = null;
    let lastDirection = null;

    messages.forEach(msg => {
      const sender = msg.senderName || (msg.direction === 'incoming' ? 'Someone' : 'You');
      const direction = msg.direction;

      if (lastSender === sender && lastDirection === direction) {
        // Same sender, add to last group
        groupedMessages[groupedMessages.length - 1].push(msg);
      } else {
        // New sender or direction, create new group
        groupedMessages.push([msg]);
        lastSender = sender;
        lastDirection = direction;
      }
    });

    container.innerHTML = groupedMessages.map(group => {
      const firstMsg = group[0];
      const isIncoming = firstMsg.direction === 'incoming';

      // If multiple consecutive messages from same sender, show compact view
      if (group.length > 1) {
        return `
          <div class="message-group ${isIncoming ? 'incoming' : 'outgoing'}">
            ${group.map((msg, idx) => this.renderMessage(msg, idx === 0, idx === group.length - 1)).join('')}
          </div>
        `;
      } else {
        return this.renderMessage(firstMsg, true, true);
      }
    }).join('');

    // Scroll to bottom
    this.scrollToBottom();
  },

  // Render single message
  renderMessage(message, showSender = true, showTime = true) {
    const isIncoming = message.direction === 'incoming';
    const senderName = message.senderName || (isIncoming ? 'Someone' : 'You');
    const senderInitial = senderName.charAt(0).toUpperCase();

    // Get avatar color based on sender name
    const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e', '#14b8a6'];
    const colorIndex = senderName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
    const avatarColor = colors[colorIndex];
    const avatarHtml = `
      <div class="message-sender">
        <span class="sender-avatar" style="background: ${avatarColor};">${this.escapeHtml(senderInitial)}</span>
      </div>
    `;
    const time = this.formatTime(message.timestamp);
    const reactionsHtml = (message.reactions || []).length ? `
      <div class="message-reactions">
        ${(message.reactions || []).map(reaction => `
          <span class="reaction-chip">
            <span class="reaction-chip-emoji">${this.escapeHtml(reaction.emoji)}</span>
            ${reaction.count > 1 ? `<span class="reaction-chip-count">${reaction.count}</span>` : ''}
          </span>
        `).join('')}
      </div>
    ` : '';

    let mediaHtml = '';
    if (message.mediaUrl) {
      const isImage = message.type === 'image';
      const isVideo = message.type === 'video';

      // Determine media source - use API proxy if full URL
      const mediaSrc = message.mediaUrl.startsWith('http')
        ? `/api/messages/${message.id}/media?sessionId=${this.currentSession}`
        : `/media/${message.mediaUrl}`;

      if (isImage) {
        mediaHtml = `<div class="message-media">
          <img class="message-media-image" src="${mediaSrc}" alt="${this.escapeHtml(message.content)}"
               onclick="window.open(this.src, '_blank')"
               onerror="this.parentElement.innerHTML='<span class=\\'text-muted\\'>Failed to load image</span>'" />
        </div>`;
      } else if (isVideo) {
        mediaHtml = `<div class="message-media">
          <video class="message-media-video" controls preload="metadata"
                 onerror="this.parentElement.innerHTML='<span class=\\'text-muted\\'>Failed to load video</span>'">
            <source src="${mediaSrc}" type="video/mp4">
            Your browser does not support the video tag.
          </video>
        </div>`;
      }
    }


    // Compact message (no avatar) for consecutive messages
    if (!showSender) {
      return `
        <div class="message ${isIncoming ? 'incoming' : 'outgoing'} group-message compact">
          <div class="message-content-wrapper">
            ${mediaHtml}
            ${message.content ? `
              <div class="message-bubble">
                ${this.escapeHtml(message.content)}
              </div>
            ` : ''}
            ${showTime ? `
              <div class="message-time">
                ${time}
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }

    // Full message with avatar and sender name inside bubble
    const senderNameHtml = isIncoming && showSender ? `
      <div class="bubble-sender-name">${this.escapeHtml(senderName)}</div>
    ` : '';

    return `
      <div class="message ${isIncoming ? 'incoming' : 'outgoing'} group-message">
        ${isIncoming ? `
          <div class="message-sender">
            <span class="sender-avatar" style="background: ${avatarColor};">${this.escapeHtml(senderInitial)}</span>
          </div>
        ` : ''}

        <div class="message-content-wrapper">
          ${mediaHtml}
          ${message.content || senderNameHtml || reactionsHtml ? `
            <div class="message-bubble">
              ${senderNameHtml}
              ${message.content ? `
                <div class="bubble-content">${this.escapeHtml(message.content)}</div>
              ` : ''}
              ${reactionsHtml}
            </div>
          ` : ''}
          ${showTime ? `
            <div class="message-time">
              ${time}
            </div>
          ` : ''}
        </div>

        ${!isIncoming ? `
          <div class="message-sender">
            <span class="sender-avatar" style="background: ${avatarColor};">${this.escapeHtml(senderInitial)}</span>
          </div>
        ` : ''}
      </div>
    `;
  },

  buildReactionSummary(reactions = []) {
    const counts = {};
    reactions.forEach((reaction) => {
      const emoji = reaction.emoji || '❤️';
      counts[emoji] = (counts[emoji] || 0) + 1;
    });
    return Object.entries(counts).map(([emoji, count]) => ({ emoji, count }));
  },

  annotateMessagesWithReactions(messages) {
    const reactionMap = {};
    const visibleMessages = [];

    (messages || []).forEach((msg) => {
      if (msg.type === 'reaction' && msg.reactionTargetMessageId) {
        const targetId = msg.reactionTargetMessageId;
        reactionMap[targetId] = reactionMap[targetId] || [];
        reactionMap[targetId].push({
          emoji: msg.reactionEmoji || msg.content || '❤️',
          senderName: msg.senderName,
          timestamp: msg.timestamp
        });
      } else {
        visibleMessages.push({ ...msg });
      }
    });

    visibleMessages.forEach((msg) => {
      msg.reactions = this.buildReactionSummary(reactionMap[msg.messageId]);
    });

    this.reactionMap = reactionMap;
    return visibleMessages;
  },

  addIncomingReaction(message) {
    if (!message || !message.reactionTargetMessageId) {
      return;
    }

    this.currentMessages = this.currentMessages || [];

    const targetId = message.reactionTargetMessageId;
    const emoji = message.reactionEmoji || message.content || '❤️';
    const entry = {
      emoji,
      senderName: message.senderName,
      timestamp: message.timestamp
    };

    this.reactionMap[targetId] = this.reactionMap[targetId] || [];
    this.reactionMap[targetId].push(entry);

    const targetMessage = this.currentMessages.find(m => m.messageId === targetId);
    if (targetMessage) {
      targetMessage.reactions = this.buildReactionSummary(this.reactionMap[targetId]);
      this.renderMessages(this.currentMessages);
      this.scrollToBottom();
    } else if (this.selectedGroup) {
      this.loadGroupMessages(this.selectedGroup.id);
    }
  },

  // Send message to group
  async sendMessage() {
    const input = document.getElementById('groupMessageInput');
    const content = input.value.trim();

    if (!content && !this.selectedMedia) {
      return;
    }

    if (!this.selectedGroup) {
      this.showError('Please select a group first');
      return;
    }

    try {
      let response;

      if (this.selectedMedia) {
        // Use FormData for media upload
        const formData = new FormData();
        formData.append('sessionId', this.currentSession);
        formData.append('content', content);
        formData.append('type', this.selectedMedia.type.startsWith('video/') ? 'video' : 'image');
        formData.append('media', this.selectedMedia);

        response = await fetch(`/api/groups/${this.selectedGroup.id}/messages`, {
          method: 'POST',
          body: formData
        });
      } else {
        // Send JSON for text-only messages
        response = await fetch(`/api/groups/${this.selectedGroup.id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: this.currentSession,
            content: content,
            type: 'text'
          })
        });
      }

      const data = await response.json();

      if (data.success) {
        // Clear input
        input.value = '';
        this.clearSelectedMedia();

        // Reload messages
        this.loadGroupMessages(this.selectedGroup.id);
      } else {
        this.showError(data.error || 'Failed to send message');
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      this.showError('Failed to send message');
    }
  },

  // Handle media selection
  handleMediaSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Validate size (max 25MB)
    const maxSize = 25 * 1024 * 1024;
    if (file.size > maxSize) {
      this.showError('File size exceeds 25MB limit');
      return;
    }

    // Store file for upload
    this.selectedMedia = file;

    // Update preview
    const preview = document.getElementById('selectedGroupMediaPreview');
    const label = document.getElementById('selectedGroupMediaLabel');

    label.textContent = file.name;
    preview.style.display = 'block';
  },

  // Clear selected media
  clearSelectedMedia() {
    this.selectedMedia = null;

    const preview = document.getElementById('selectedGroupMediaPreview');
    const input = document.getElementById('groupMediaInput');

    preview.style.display = 'none';
    input.value = '';
  },

  // Show participants modal (placeholder)
  async showParticipants() {
    if (!this.selectedGroup) {
      this.showNotification('Please select a group first', 'error');
      return;
    }

    try {
      // Show loading state
      const modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.id = 'participantsModal';
      modal.innerHTML = `
        <div class="modal-content" style="max-width: 500px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2 style="font-size: 18px; font-weight: 600;">👥 Group Participants</h2>
            <button class="btn-close-modal" onclick="document.getElementById('participantsModal').remove()">✕</button>
          </div>
          <div id="participantsLoading" style="text-align: center; padding: 40px; color: #94a3b8;">
            Loading participants...
          </div>
          <div id="participantsContent"></div>
        </div>
      `;
      document.body.appendChild(modal);

      // Close on backdrop click
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.remove();
        }
      });

      // Fetch participants from API
      const response = await fetch(
        `/api/groups/${this.selectedGroup.id}/participants?sessionId=${this.currentSession}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch participants');
      }

      const data = await response.json();

      // Render participants
      this.renderParticipants(data.participants, data.groupName);

    } catch (error) {
      console.error('Failed to load participants:', error);
      this.showNotification('Failed to load participants', 'error');

      // Remove modal on error
      const modal = document.getElementById('participantsModal');
      if (modal) modal.remove();
    }
  },

  renderParticipants(participants, groupName) {
    const contentDiv = document.getElementById('participantsContent');
    const loadingDiv = document.getElementById('participantsLoading');

    if (!contentDiv) return;

    // Remove loading
    if (loadingDiv) loadingDiv.remove();

    if (!participants || participants.length === 0) {
      contentDiv.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #94a3b8;">
          <div style="font-size: 48px; margin-bottom: 10px;">👥</div>
          <p>No participants found</p>
        </div>
      `;
      return;
    }

    // Separate admins and members
    const admins = participants.filter(p => p.isAdmin);
    const members = participants.filter(p => !p.isAdmin);

    // Add search box
    const searchHtml = `
      <div style="margin-bottom: 15px;">
        <input
          type="text"
          id="participantSearch"
          placeholder="🔍 Search participants..."
          style="width: 100%;
                 padding: 10px 12px;
                 border: 1px solid #334155;
                 border-radius: 6px;
                 background: #0f172a;
                 color: #e2e8f0;
                 font-size: 14px;"
        />
      </div>
      <div style="margin-bottom: 15px; font-size: 13px; color: #94a3b8;">
        ${groupName} • ${participants.length} participants
      </div>
    `;

    // Render admin section
    let adminHtml = '';
    if (admins.length > 0) {
      adminHtml = `
        <div style="margin-bottom: 20px;">
          <h3 style="font-size: 13px; font-weight: 600; color: #fbbf24; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
            👑 Admins (${admins.length})
          </h3>
          ${admins.map(admin => this.renderParticipantItem(admin)).join('')}
        </div>
      `;
    }

    // Render members section
    let membersHtml = '';
    if (members.length > 0) {
      membersHtml = `
        <div>
          <h3 style="font-size: 13px; font-weight: 600; color: #94a3b8; margin-bottom: 10px;">
            👥 Members (${members.length})
          </h3>
          <div id="membersList" style="display: flex; flex-direction: column; gap: 8px;">
            ${members.map(member => this.renderParticipantItem(member)).join('')}
          </div>
        </div>
      `;
    }

    contentDiv.innerHTML = searchHtml + adminHtml + membersHtml;

    // Add search functionality
    const searchInput = document.getElementById('participantSearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        this.filterParticipants(query);
      });
    }
  },

  renderParticipantItem(participant) {
    const name = participant.name || 'Unknown';
    const initial = name.charAt(0).toUpperCase();
    const adminBadge = participant.isAdmin ? '<span style="margin-left: auto; font-size: 11px; padding: 2px 8px; background: #fbbf24; color: #000; border-radius: 4px; font-weight: 600;">👑 Admin</span>' : '';

    // Get avatar color based on name
    const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
    const colorIndex = name.charCodeAt(0) % colors.length;
    const avatarColor = colors[colorIndex];

    return `
      <div class="participant-item" data-name="${name.toLowerCase()}" style="
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px;
        border-radius: 8px;
        background: #1e293b;
        border: 1px solid #334155;
      ">
        <div style="
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: ${avatarColor};
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          font-size: 14px;
          color: white;
          flex-shrink: 0;
        ">${initial}</div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 500; font-size: 14px; color: #e2e8f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${this.escapeHtml(name)}
          </div>
          <div style="font-size: 11px; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${this.escapeHtml(participant.jid || '')}
          </div>
        </div>
        ${adminBadge}
      </div>
    `;
  },

  filterParticipants(query) {
    const items = document.querySelectorAll('.participant-item');
    items.forEach(item => {
      const name = item.dataset.name || '';
      if (name.includes(query)) {
        item.style.display = 'flex';
      } else {
        item.style.display = 'none';
      }
    });
  },


  // Update group in list
  updateGroup(group) {
    const index = this.groups.findIndex(g => g.id === group.id);
    if (index !== -1) {
      this.groups[index] = group;
      this.renderGroupsList();
    }
  },

  // Show category selection modal
  showCategoryModal(groupId, currentCategory) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'categoryModal';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 400px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h2 style="font-size: 18px; font-weight: 600;">Change Group Category</h2>
          <button class="btn-close-modal" onclick="this.closest('.modal-overlay').remove()">✕</button>
        </div>

        <div style="display: flex; flex-direction: column; gap: 10px;">
          <button class="category-option ${currentCategory === 'business' ? 'active' : ''}"
                  data-category="business"
                  data-group-id="${groupId}">
            💼 Business
            <small style="display: block; opacity: 0.7;">Customer groups, business communications</small>
          </button>
          <button class="category-option ${currentCategory === 'internal' ? 'active' : ''}"
                  data-category="internal"
                  data-group-id="${groupId}">
            👔 Internal
            <small style="display: block; opacity: 0.7;">Team groups, internal communications</small>
          </button>
          <button class="category-option ${currentCategory === 'personal' ? 'active' : ''}"
                  data-category="personal"
                  data-group-id="${groupId}">
            🏠 Personal
            <small style="display: block; opacity: 0.7;">Family, friends, personal groups</small>
          </button>
        </div>

        <div style="display: flex; gap: 10px; margin-top: 20px; justify-content: flex-end;">
          <button class="btn-secondary" onclick="document.getElementById('categoryModal').remove()">Cancel</button>
        </div>
      </div>
    `;

    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      .category-option {
        padding: 15px;
        border: 2px solid #334155;
        border-radius: 8px;
        background: transparent;
        color: #e2e8f0;
        cursor: pointer;
        text-align: left;
        transition: all 0.2s;
      }
      .category-option:hover {
        border-color: #06b6d4;
        background: #0891b2;
      }
      .category-option.active {
        border-color: #06b6d4;
        background: #0891b2;
        color: white;
      }
      .category-option small {
        font-size: 11px;
        margin-top: 4px;
      }
      .btn-secondary {
        padding: 8px 16px;
        border: 1px solid #475569;
        border-radius: 6px;
        background: transparent;
        color: #e2e8f0;
        cursor: pointer;
      }
      .btn-secondary:hover {
        background: #334155;
      }
    `;
    modal.appendChild(style);

    document.body.appendChild(modal);

    // Add click listeners to category options
    modal.querySelectorAll('.category-option').forEach(btn => {
      btn.addEventListener('click', async () => {
        const newCategory = btn.dataset.category;
        await this.updateGroupCategory(groupId, newCategory);
        modal.remove();
      });
    });

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  },

  // Update group category
  async updateGroupCategory(groupId, newCategory) {
    try {
      const response = await fetch(`/api/groups/${groupId}/category`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.currentSession,
          category: newCategory
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update category');
      }

      // Update local data
      const group = this.groups.find(g => g.id === groupId);
      if (group) {
        group.category = newCategory;
        this.renderGroupsList();
        this.updateCategoryCounts();
      }

      // Show success message
      this.showNotification(`Category changed to ${newCategory.charAt(0).toUpperCase() + newCategory.slice(1)}`, 'success');
    } catch (error) {
      console.error('Failed to update group category:', error);
      this.showNotification(error.message, 'error');
    }
  },

  // Show notification toast
  showNotification(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 12px 20px;
      background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
      color: white;
      border-radius: 8px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
      z-index: 10000;
      animation: slideIn 0.3s ease-out;
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },


  // Handle new message from Socket.io
  handleNewMessage(data) {
    if (data.sessionId !== this.currentSession) return;

    // Update groups list
    this.loadGroups();

    // If viewing this group, add message
    if (this.selectedGroup && data.groupId === this.selectedGroup.id) {
      if (data.message.type === 'reaction') {
        this.addIncomingReaction(data.message);
        return;
      }

      this.currentMessages = this.currentMessages || [];
      this.currentMessages.push({ ...data.message, reactions: [] });
      this.renderMessages(this.currentMessages);
      this.scrollToBottom();
    }
  },

  // Update category counts
  updateCategoryCounts() {
    // Count groups by category
    const counts = {
      all: this.groups.length,
      business: this.groups.filter(g => g.category === 'business').length,
      internal: this.groups.filter(g => g.category === 'internal').length,
      personal: this.groups.filter(g => g.category === 'personal').length
    };

    // Update category badges with null checks
    const categoryCountAll = document.getElementById('categoryCountAll');
    if (categoryCountAll) categoryCountAll.textContent = counts.all;

    const categoryCountBusiness = document.getElementById('categoryCountBusiness');
    if (categoryCountBusiness) categoryCountBusiness.textContent = counts.business;

    const categoryCountInternal = document.getElementById('categoryCountInternal');
    if (categoryCountInternal) categoryCountInternal.textContent = counts.internal;

    const categoryCountPersonal = document.getElementById('categoryCountPersonal');
    if (categoryCountPersonal) categoryCountPersonal.textContent = counts.personal;

    // Update stats with null checks
    const totalGroupsCount = document.getElementById('totalGroupsCount');
    if (totalGroupsCount) totalGroupsCount.textContent = counts.all;

    const businessGroupsCount = document.getElementById('businessGroupsCount');
    if (businessGroupsCount) businessGroupsCount.textContent = counts.business;

    const unreadGroupsCount = document.getElementById('unreadGroupsCount');
    if (unreadGroupsCount) unreadGroupsCount.textContent = this.groups.reduce((sum, g) => sum + (g.unreadCount || 0), 0);
  },

  // Filter groups by search
  filterGroups(query) {
    const lowerQuery = query.toLowerCase();

    const filtered = this.groups.filter(group => {
      return group.subject.toLowerCase().includes(lowerQuery);
    });

    this.renderFilteredGroups(filtered);
  },

  // Render filtered groups
  renderFilteredGroups(groups) {
    const groupsList = document.getElementById('groupsList');
    if (!groupsList) return;

    if (groups.length === 0) {
      groupsList.innerHTML = `
        <div class="empty-state">
          <p>No groups found</p>
        </div>
      `;
      return;
    }

    groupsList.innerHTML = groups.map(group => this.renderGroupCard(group)).join('');

    // Re-add click listeners
    groupsList.querySelectorAll('.contact-item.group-item').forEach(card => {
      card.addEventListener('click', () => {
        const groupId = parseInt(card.dataset.groupId);
        this.selectGroup(groupId);
      });
    });
  },

  // Show empty state
  showEmptyState() {
    const groupsList = document.getElementById('groupsList');
    if (groupsList) {
      groupsList.innerHTML = `
        <div class="empty-state">
          <p>Please select a session first</p>
        </div>
      `;
    }

    document.getElementById('groupChatWelcome').style.display = 'flex';
    document.getElementById('groupConversation').style.display = 'none';
  },

  // Show error
  showError(message) {
    alert('Error: ' + message);
  },

  // Scroll messages to bottom
  scrollToBottom() {
    const container = document.getElementById('groupMessagesContainer');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  },

  // Format timestamp to time
  formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;

    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');

    if (date.toDateString() === now.toDateString()) {
      return `${hours}:${minutes}`;
    }

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === yesterday.toDateString()) {
      return `Yesterday ${hours}:${minutes}`;
    }

    return `${hours}:${minutes}`;
  },

  // Get category icon
  getCategoryIcon(category) {
    const icons = {
      business: '💼',
      internal: '👔',
      personal: '🏠'
    };
    return icons[category] || '📚';
  },

  // Capitalize first letter
  capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  },

  // Escape HTML
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  // Called when navigating to groups view
  onNavigate() {
    console.log('Groups view navigated');
    this.loadSessions();
    if (this.currentSession) {
      this.loadGroups();
    }
  }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  Groups.init();
});
