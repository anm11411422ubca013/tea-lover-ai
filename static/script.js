/**
 * =============================================================================
 * Tea Lover – Frontend JavaScript (Fetch API + DOM + Markdown Integration)
 * =============================================================================
 */

// Application State
let currentChatId = null;
let isGeneratingResponse = false;

// DOM Elements Cache
const sidebar = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");
const menuToggleBtn = document.getElementById("menuToggleBtn");
const sidebarCloseBtn = document.getElementById("sidebarCloseBtn");
const newChatBtn = document.getElementById("newChatBtn");
const headerNewBtn = document.getElementById("headerNewBtn");
const historyList = document.getElementById("historyList");
const historyCount = document.getElementById("historyCount");
const activeChatTitle = document.getElementById("activeChatTitle");
const chatViewport = document.getElementById("chatViewport");
const welcomeHero = document.getElementById("welcomeHero");
const messagesStream = document.getElementById("messagesStream");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");

// =============================================================================
// 1. INITIALIZATION & EVENT LISTENERS
// =============================================================================

document.addEventListener("DOMContentLoaded", () => {
    // Load existing conversations from SQLite
    fetchChatHistory();

    // Auto-adjust textarea height on input
    messageInput.addEventListener("input", handleAutoResize);

    // Send on Enter (without Shift)
    messageInput.addEventListener("keydown", handleKeyDown);

    // Send button click
    sendBtn.addEventListener("click", handleSendMessage);

    // New Chat buttons
    newChatBtn.addEventListener("click", () => startNewChatSession());
    headerNewBtn.addEventListener("click", () => startNewChatSession());

    // Mobile Sidebar Toggles
    menuToggleBtn.addEventListener("click", toggleSidebar);
    sidebarCloseBtn.addEventListener("click", closeSidebar);
    sidebarBackdrop.addEventListener("click", closeSidebar);
});

// =============================================================================
// 2. CHAT SESSIONS & SIDEBAR HISTORY
// =============================================================================

async function fetchChatHistory() {
    try {
        const response = await fetch("/api/chats");
        const data = await response.json();
        
        if (data.chats) {
            renderHistoryList(data.chats);
        }
    } catch (err) {
        console.error("Failed to load chat history:", err);
    }
}

function renderHistoryList(chats) {
    historyList.innerHTML = "";
    historyCount.textContent = chats.length;

    if (chats.length === 0) {
        historyList.innerHTML = `
            <li style="padding: 14px 10px; color: var(--cream-dark); font-size: 13px; text-align: center;">
                No conversations yet.<br>Start your first cafe chat!
            </li>
        `;
        return;
    }

    chats.forEach(chat => {
        const li = document.createElement("li");
        li.className = `history-item ${chat.id === currentChatId ? "active" : ""}`;
        li.dataset.id = chat.id;

        li.innerHTML = `
            <div class="history-title-wrap">
                <span class="history-item-icon">🍵</span>
                <span class="history-title-text">${escapeHtml(chat.title)}</span>
            </div>
            <button class="history-delete-btn" title="Delete conversation" aria-label="Delete">🗑</button>
        `;

        // Click on title to load conversation
        li.querySelector(".history-title-wrap").addEventListener("click", () => {
            loadConversation(chat.id);
            closeSidebar();
        });

        // Click on delete button
        li.querySelector(".history-delete-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            deleteConversation(chat.id);
        });

        historyList.appendChild(li);
    });
}

function startNewChatSession() {
    currentChatId = null;
    activeChatTitle.textContent = "New Brew Conversation";
    messagesStream.innerHTML = "";
    welcomeHero.style.display = "block";
    messageInput.value = "";
    messageInput.style.height = "auto";
    messageInput.focus();

    // Remove active highlight from sidebar items
    document.querySelectorAll(".history-item").forEach(el => el.classList.remove("active"));
    closeSidebar();
}

async function loadConversation(chatId) {
    if (isGeneratingResponse) return;

    try {
        const res = await fetch(`/api/chats/${chatId}`);
        const data = await res.json();

        if (res.ok && data.messages) {
            currentChatId = data.chat_id;
            activeChatTitle.textContent = data.title;
            welcomeHero.style.display = "none";
            messagesStream.innerHTML = "";

            // Render all historical messages
            data.messages.forEach(msg => {
                appendMessageToUI(msg.role, msg.content);
            });

            // Mark item as active in sidebar
            document.querySelectorAll(".history-item").forEach(el => {
                el.classList.toggle("active", el.dataset.id === chatId);
            });

            scrollToBottom();
        }
    } catch (err) {
        console.error("Error loading chat:", err);
    }
}

async function deleteConversation(chatId) {
    if (!confirm("Are you sure you want to remove this cafe conversation?")) return;

    try {
        const res = await fetch(`/api/chats/${chatId}`, { method: "DELETE" });
        if (res.ok) {
            if (currentChatId === chatId) {
                startNewChatSession();
            }
            fetchChatHistory();
        }
    } catch (err) {
        console.error("Error deleting conversation:", err);
    }
}

// =============================================================================
// 3. SENDING MESSAGES & AI QUERY
// =============================================================================

async function handleSendMessage() {
    const text = messageInput.value.trim();
    if (!text || isGeneratingResponse) return;

    // Hide welcome hero on first prompt
    welcomeHero.style.display = "none";

    // 1. Display user message on the right
    appendMessageToUI("user", text);

    // 2. Clear and reset input field
    messageInput.value = "";
    messageInput.style.height = "auto";
    setGeneratingState(true);

    // 3. Display loading animation (cafe steam dots) on the left
    const typingIndicatorEl = showTypingIndicator();
    scrollToBottom();

    try {
        const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: currentChatId,
                message: text
            })
        });

        const data = await res.json();

        // Remove loading indicator
        typingIndicatorEl.remove();

        if (res.ok) {
            // Update current chat ID if this was a new conversation
            currentChatId = data.chat_id;
            if (data.title) {
                activeChatTitle.textContent = data.title;
            }

            // Display AI response on the left
            appendMessageToUI("model", data.response, data.is_off_topic);

            // Refresh history sidebar to show new chat title
            fetchChatHistory();
        } else {
            appendMessageToUI("model", `⚠️ Error: ${data.error || "Could not generate response."}`);
        }
    } catch (err) {
        typingIndicatorEl.remove();
        appendMessageToUI("model", "⚠️ Network Error: Unable to reach the Tea Lover server. Please ensure Flask is running.");
        console.error("Fetch error:", err);
    } finally {
        setGeneratingState(false);
        scrollToBottom();
        messageInput.focus();
    }
}

// Suggestion card shortcut handler
function useSuggestedPrompt(promptText) {
    messageInput.value = promptText;
    handleSendMessage();
}

// =============================================================================
// 4. MESSAGE RENDERING (USER ON RIGHT, AI ON LEFT)
// =============================================================================

function appendMessageToUI(role, content, isOffTopic = false) {
    const isUser = role === "user";
    const msgRow = document.createElement("div");
    msgRow.className = `msg-row ${isUser ? "user" : "ai"}`;

    // Format content safely
    let formattedHtml = "";
    if (isUser) {
        // Plain text with linebreaks to prevent injection
        formattedHtml = escapeHtml(content).replace(/\n/g, "<br>");
    } else {
        // AI responses: parse Markdown and sanitize with DOMPurify
        if (typeof marked !== "undefined" && typeof DOMPurify !== "undefined") {
            const rawHtml = marked.parse(content);
            formattedHtml = DOMPurify.sanitize(rawHtml);
        } else {
            formattedHtml = escapeHtml(content).replace(/\n/g, "<br>");
        }

        // Add special visual callout badge if strictly off-topic
        if (isOffTopic) {
            formattedHtml = `
                <div class="off-topic-callout">
                    ${formattedHtml}
                </div>
            `;
        }
    }

    // Avatar configuration
    const avatarBadge = isUser
        ? `<div class="msg-avatar user-avatar-badge">YOU</div>`
        : `<div class="msg-avatar ai-avatar-badge">☕</div>`;

    const senderTag = isUser ? "You" : "Tea Lover AI";

    msgRow.innerHTML = `
        ${!isUser ? avatarBadge : ""}
        <div class="msg-container">
            <span class="msg-sender-tag">${senderTag}</span>
            <div class="msg-bubble">
                <div class="msg-body">${formattedHtml}</div>
            </div>
        </div>
        ${isUser ? avatarBadge : ""}
    `;

    messagesStream.appendChild(msgRow);
    scrollToBottom();
}

// Loading typing indicator with animated Tea & Coffee brewing illustration
function showTypingIndicator() {
    const row = document.createElement("div");
    row.className = "msg-row ai";
    row.id = "activeTypingIndicator";

    row.innerHTML = `
        <div class="msg-avatar ai-avatar-badge">☕</div>
        <div class="msg-container">
            <span class="msg-sender-tag">Tea Lover AI</span>
            <div class="msg-bubble brewing-bubble">
                <div class="brewing-stage">
                    <!-- Illustrated Tea & Coffee Animated SVG Station -->
                    <div class="brewing-visual">
                        <!-- Hot Coffee Mug -->
                        <div class="cup-wrapper coffee-cup">
                            <svg class="steam-svg" viewBox="0 0 40 50">
                                <path class="steam-path s1" d="M12 45 C10 32 18 25 14 10 C12 4 16 0 16 0"/>
                                <path class="steam-path s2" d="M22 45 C26 34 18 24 24 12 C26 6 22 0 22 0"/>
                                <path class="steam-path s3" d="M30 45 C28 35 34 26 30 14 C28 8 32 0 32 0"/>
                            </svg>
                            <div class="cup-body coffee-body">
                                <div class="coffee-liquid">
                                    <span class="latte-art">☕</span>
                                </div>
                                <div class="cup-handle coffee-handle"></div>
                            </div>
                            <div class="cup-saucer coffee-saucer"></div>
                        </div>

                        <!-- Steeping Tea Cup -->
                        <div class="cup-wrapper tea-cup">
                            <svg class="steam-svg" viewBox="0 0 40 50">
                                <path class="steam-path s2" d="M14 45 C12 34 20 22 15 10 C13 5 17 0 17 0"/>
                                <path class="steam-path s1" d="M24 45 C28 32 20 20 25 10 C27 4 23 0 23 0"/>
                            </svg>
                            <div class="cup-body tea-body">
                                <div class="tea-liquid">
                                    <span class="tea-leaf">🍃</span>
                                </div>
                                <div class="tea-tag-string">
                                    <span class="tea-bag-tag">TEA</span>
                                </div>
                                <div class="cup-handle tea-handle"></div>
                            </div>
                            <div class="cup-saucer tea-saucer"></div>
                        </div>
                    </div>

                    <!-- Dynamic Brewing Message & Steam Dots -->
                    <div class="brewing-info">
                        <div class="brewing-title">
                            <span class="brewing-pulse-icon">🫖</span>
                            <span class="brewing-label" id="brewingStatusText">Brewing your recipe...</span>
                        </div>
                        <div class="brewing-status-sub">
                            <span>Freshly steeping tea & grinding coffee beans</span>
                            <div class="typing-box-mini">
                                <span class="typing-dot"></span>
                                <span class="typing-dot"></span>
                                <span class="typing-dot"></span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    messagesStream.appendChild(row);

    // Rotate cheerful cafe status messages during generation
    const statusLabels = [
        "Steeping fresh tea leaves...",
        "Roasting & grinding coffee beans...",
        "Infusing aromatic spices & flavors...",
        "Pairing delicious snack suggestions...",
        "Serving your warm recipe..."
    ];
    let labelIdx = 0;
    const intervalId = setInterval(() => {
        const labelEl = document.getElementById("brewingStatusText");
        if (labelEl) {
            labelIdx = (labelIdx + 1) % statusLabels.length;
            labelEl.textContent = statusLabels[labelIdx];
        } else {
            clearInterval(intervalId);
        }
    }, 2200);

    return row;
}

// =============================================================================
// 5. HELPER UTILITIES
// =============================================================================

function setGeneratingState(generating) {
    isGeneratingResponse = generating;
    sendBtn.disabled = generating;
    messageInput.disabled = generating;
}

function handleAutoResize() {
    messageInput.style.height = "auto";
    messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + "px";
}

function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleSendMessage();
    }
}

function scrollToBottom() {
    chatViewport.scrollTop = chatViewport.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function toggleSidebar() {
    sidebar.classList.toggle("active");
    sidebarBackdrop.classList.toggle("active");
}

function closeSidebar() {
    sidebar.classList.remove("active");
    sidebarBackdrop.classList.remove("active");
}
