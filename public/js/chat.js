// ============================================
// CHAT FUNCTIONALITY
// ============================================

/**
 * Load chat contacts
 */
async function loadChatContacts(sessionId, search = '') {
  if (!sessionId) return;

  try {
    const params = new URLSearchParams({
      sessionId,
      search,
      limit: '50'
    });

    const res = await fetch(`/api/contacts?${params}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error);

    chatState.contacts = {};
    data.contacts.forEach(contact => {
      chatState.contacts[contact.id] = contact;
    });

    renderChatContactsList();
  } catch (err) {
    console.error('Failed to load contacts:', err);
  }
}

/**
 * Render chat contacts list
 */
function renderChatContactsList() {
  const listDiv = document.getElementById('chatContactsList');
  const contacts = Object.values(chatState.contacts).sort((a, b) => {
    const aTime = a.lastInteraction ? new Date(a.lastInteraction).getTime() : 0;
    const bTime = b.lastInteraction ? new Date(b.lastInteraction).getTime() : 0;
    return bTime - aTime;
  });

  if (contacts.length === 0) {
    listDiv.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--muted);">No contacts found</div>';
    return;
  }

  listDiv.innerHTML = contacts.map(contact => {
    const isActive = chatState.currentContact?.id === contact.id;
    const lastMsg = contact.lastMessage;
    const time = lastMsg ? formatMessageTime(lastMsg.timestamp) : '';

    return `
      <div class="contact-item ${isActive ? 'active' : ''}" data-contact-id="${contact.id}">
        <div class="contact-avatar">${contact.name ? contact.name[0] : '?'}</div>
        <div class="contact-item-info">
          <div class="contact-item-name">${contact.name || contact.phone}</div>
          <div class="contact-item-preview">${lastMsg ? lastMsg.content : 'No messages yet'}</div>
        </div>
        <div class="contact-item-meta">
          <div>${time}</div>
        </div>
      </div>
    `;
  }).join('');

  listDiv.querySelectorAll('.contact-item').forEach(item => {
    item.addEventListener('click', () => {
      const contactId = parseInt(item.dataset.contactId);
      openChatContact(contactId);
    });
  });
}

/**
 * Open chat with contact
 */
async function openChatContact(contactId) {
  const contact = chatState.contacts[contactId];
  if (!contact) return;

  chatState.currentContact = contact;

  document.getElementById('chatWelcome').style.display = 'none';
  document.getElementById('chatConversation').style.display = 'flex';

  document.getElementById('chatContactName').textContent = contact.name || contact.phone;
  document.getElementById('chatContactPhone').textContent = contact.phone;
  document.getElementById('chatContactAvatar').textContent = contact.name ? contact.name[0] : '?';

  await loadContactMessages(contact.id);
  renderChatContactsList();
  
  // Scroll to bottom after messages are loaded and DOM is updated
  setTimeout(() => {
    scrollToBottom(document.getElementById('messagesContainer'));
  }, 1000);
  
  // Focus on message input textarea
  clearSelectedMedia();
  document.getElementById('messageInput').focus();
}

/**
 * Load messages for contact
 */
async function loadContactMessages(contactId) {
  try {
    const sessionId = chatState.currentSession;
    const res = await fetch(`/api/contacts/${contactId}/messages?sessionId=${sessionId}&limit=100`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error);

    chatState.messages[contactId] = data.messages;
    renderMessages();
  } catch (err) {
    console.error('Failed to load messages:', err);
  }
}

/**
 * Render messages
 */
function renderMessages() {
  const container = document.getElementById('messagesContainer');
  const messages = chatState.messages[chatState.currentContact.id] || [];

  if (messages.length === 0) {
    container.innerHTML = '<div class="empty-state">No messages yet. Start the conversation!</div>';
    return;
  }

  container.innerHTML = messages.map(msg => {
    const isOutgoing = msg.direction === 'outgoing';
    const isDeleted = msg.isDeleted || msg.content === '[This message was deleted]';
    const time = formatMessageTime(msg.timestamp);

    let mediaContent = '';
    if ((msg.type === 'image' || msg.type === 'video') && msg.mediaUrl) {
      const mediaSrc = msg.mediaUrl.startsWith('http')
        ? `/api/messages/${msg.id}/media?sessionId=${chatState.currentSession}`
        : `/media/${msg.mediaUrl}`;

      if (msg.type === 'image') {
        mediaContent = `
          <div class="message-media">
            <img class="message-media-image" src="${mediaSrc}" alt="${escapeHtml(msg.content)}"
                 onclick="window.open(this.src, '_blank')"
                 onerror="this.parentElement.innerHTML='<span class=\\'text-muted\\'>Failed to load image</span>'" />
          </div>
        `;
      } else if (msg.type === 'video') {
        mediaContent = `
          <div class="message-media">
            <video class="message-media-video" controls preload="metadata"
                   onerror="this.parentElement.innerHTML='<span class=\\'text-muted\\'>Failed to load video</span>'">
              <source src="${mediaSrc}" type="video/mp4">
              Your browser does not support the video tag.
            </video>
          </div>
        `;
      }
    }

    let textContent = '';
    if (isDeleted) {
      textContent = `<span class="text-muted italic">🗑️ ${escapeHtml(msg.content)}</span>`;
    } else if (msg.type === 'text' || (!msg.mediaUrl && !mediaContent)) {
      textContent = escapeHtml(msg.content);
    }

    return `
      <div class="message ${isOutgoing ? 'outgoing' : 'incoming'} ${isDeleted ? 'deleted' : ''}">
        <div class="message-bubble">
          ${!isDeleted ? mediaContent : ''}
          ${textContent}
          <div class="message-time">
            ${time}
            ${isOutgoing && !isDeleted ? `<span class="message-status">${getMessageStatusIcon(msg.status)}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

const MAX_MEDIA_UPLOAD_BYTES = 25 * 1024 * 1024; // Match server-side limit

function formatMediaSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function updateSelectedMediaPreview() {
  const preview = document.getElementById('selectedMediaPreview');
  const labelEl = document.getElementById('selectedMediaLabel');
  const clearBtn = document.getElementById('clearMediaBtn');

  if (!preview || !labelEl) return;

  if (chatState.selectedMedia) {
    const file = chatState.selectedMedia;
    const icon = file.type.startsWith('video/') ? '🎞️' : '🖼️';
    preview.style.display = 'block';
    labelEl.textContent = `${icon} ${file.name} · ${formatMediaSize(file.size)}`;
    clearBtn?.removeAttribute('disabled');
  } else {
    preview.style.display = 'none';
    labelEl.textContent = '';
    clearBtn?.setAttribute('disabled', 'disabled');
  }
}

function clearSelectedMedia() {
  chatState.selectedMedia = null;
  const mediaInput = document.getElementById('mediaInput');
  if (mediaInput) {
    mediaInput.value = '';
  }
  updateSelectedMediaPreview();
}

function handleMediaSelection(file) {
  if (!file) {
    clearSelectedMedia();
    return;
  }

  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
    alert('Only image or video files are supported');
    clearSelectedMedia();
    return;
  }

  if (file.size > MAX_MEDIA_UPLOAD_BYTES) {
    alert('Media file is too large (max 25 MB)');
    clearSelectedMedia();
    return;
  }

  chatState.selectedMedia = file;
  updateSelectedMediaPreview();
}

/**
 * Send message
 */
async function sendMessage() {
  const input = document.getElementById('messageInput');
  const content = input.value.trim();
  const mediaFile = chatState.selectedMedia;
  const hasMedia = Boolean(mediaFile);

  if (!chatState.currentContact || !chatState.currentSession) {
    alert('Please select a session and contact first');
    return;
  }

  if (!content && !hasMedia) {
    alert('Type a message or attach media first');
    return;
  }

  const sendBtn = document.getElementById('sendMessageBtn');
  if (sendBtn) {
    sendBtn.disabled = true;
  }

  try {
    let responseData;

    if (hasMedia) {
      const derivedType = mediaFile.type.startsWith('video/') ? 'video' : 'image';
      const formData = new FormData();
      formData.append('sessionId', chatState.currentSession);
      formData.append('phone', chatState.currentContact.phone);
      formData.append('type', derivedType);
      if (content) {
        formData.append('content', content);
      }
      formData.append('media', mediaFile);

      const res = await fetch('/api/chat/send', {
        method: 'POST',
        body: formData
      });
      responseData = await res.json();
      if (!res.ok) {
        throw new Error(responseData.error || 'Failed to send media');
      }
    } else {
      responseData = await postJson('/api/chat/send', {
        sessionId: chatState.currentSession,
        phone: chatState.currentContact.phone,
        content,
        type: 'text'
      });
    }

    input.value = '';
    input.style.height = 'auto';
    if (hasMedia) {
      clearSelectedMedia();
    }

    const deliveredMessage = responseData?.message || {
      id: Date.now(),
      direction: 'outgoing',
      type: hasMedia ? (mediaFile.type.startsWith('video/') ? 'video' : 'image') : 'text',
      content,
      mediaUrl: null,
      timestamp: new Date().toISOString(),
      status: 'sent'
    };

    if (!chatState.messages[chatState.currentContact.id]) {
      chatState.messages[chatState.currentContact.id] = [];
    }
    chatState.messages[chatState.currentContact.id].push(deliveredMessage);

    renderMessages();
    scrollToBottom(document.getElementById('messagesContainer'));
  } catch (err) {
    console.error('Failed to send message:', err);
    alert('Failed to send message: ' + err.message);
  } finally {
    if (sendBtn) {
      sendBtn.disabled = false;
    }
  }
}

/**
 * Initialize chat functionality
 */
function initChat() {
  let chatSearchTimeout;

  document.getElementById('chatSearchInput')?.addEventListener('input', (e) => {
    clearTimeout(chatSearchTimeout);
    chatSearchTimeout = setTimeout(() => {
      loadChatContacts(chatState.currentSession, e.target.value);
    }, 300);
  });

  document.getElementById('sendMessageBtn')?.addEventListener('click', sendMessage);

  document.getElementById('messageInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  document.getElementById('messageInput')?.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = this.scrollHeight + 'px';
  });

  // View Contact Details
  document.getElementById('viewContactBtn')?.addEventListener('click', () => {
    if (chatState.currentContact) {
      showContactDetailModal(chatState.currentContact.id);
    }
  });

  // Sync Chat History
  document.getElementById('refreshChatBtn')?.addEventListener('click', async () => {
    if (!chatState.currentContact || !chatState.currentSession) {
      alert('Please select a contact first');
      return;
    }

    const btn = document.getElementById('refreshChatBtn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳';

    try {
      const data = await postJson('/api/contacts/' + chatState.currentContact.id + '/sync-history', {
        sessionId: chatState.currentSession
      });

      if (data.success) {
        await loadContactMessages(chatState.currentContact.id);
        alert(`✓ Sync complete!\n\n${data.synced} new messages synced\n${data.skipped} duplicates skipped`);
      }
    } catch (err) {
      alert('Failed to sync chat history: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  // View Contact Details
  document.getElementById('viewContactBtn')?.addEventListener('click', () => {
    if (chatState.currentContact) {
      showContactDetailModal(chatState.currentContact.id, chatState.currentSession);
    }
  });

  // Quick action buttons
  document.getElementById('updateStatusBtn')?.addEventListener('click', () => {
    if (chatState.currentContact) {
      showContactDetailModal(chatState.currentContact.id, chatState.currentSession);
    }
  });

  document.getElementById('addTagBtn')?.addEventListener('click', () => {
    if (chatState.currentContact) {
      showContactDetailModal(chatState.currentContact.id, chatState.currentSession);
    }
  });

  document.getElementById('addNoteBtn')?.addEventListener('click', () => {
    if (chatState.currentContact) {
      showContactDetailModal(chatState.currentContact.id);
    }
  });

  const attachBtn = document.getElementById('attachMediaBtn');
  const mediaInput = document.getElementById('mediaInput');
  const clearMediaBtn = document.getElementById('clearMediaBtn');

  attachBtn?.addEventListener('click', () => {
    mediaInput?.click();
  });

  mediaInput?.addEventListener('change', (e) => {
    const file = e.target.files ? e.target.files[0] : null;
    handleMediaSelection(file);
  });

  clearMediaBtn?.addEventListener('click', () => {
    clearSelectedMedia();
  });

  clearSelectedMedia();
}
