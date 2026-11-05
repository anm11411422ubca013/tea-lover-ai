/**
 * =============================================================================
 * Tea Lover – Frontend JavaScript (Fetch API + DOM + Markdown + Voice + Images)
 * =============================================================================
 */

// Application State
let currentChatId = null;
let isGeneratingResponse = false;
const LAST_CHAT_KEY = "tea_lover_last_conversation_id";

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
const micBtn = document.getElementById("micBtn");

// =============================================================================
// 1. INITIALIZATION & EVENT LISTENERS
// =============================================================================

document.addEventListener("DOMContentLoaded", () => {
    // Load existing conversations from SQLite & restore last active chat
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

    // Setup Speech-to-Text Voice Recording
    setupVoiceRecognition();
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

            // Automatically restore the last active conversation if it exists
            const savedChatId = localStorage.getItem(LAST_CHAT_KEY);
            const chatExists = data.chats.some(c => c.id === savedChatId);
            if (savedChatId && chatExists && !currentChatId) {
                loadConversation(savedChatId);
            }
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
    localStorage.removeItem(LAST_CHAT_KEY);
    activeChatTitle.textContent = "New Brew Conversation";
    messagesStream.innerHTML = "";
    welcomeHero.style.display = "block";
    messageInput.value = "";
    messageInput.style.height = "auto";
    messageInput.focus();

    // Cancel any ongoing speech synthesis
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }

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
            localStorage.setItem(LAST_CHAT_KEY, currentChatId);
            activeChatTitle.textContent = data.title;
            welcomeHero.style.display = "none";
            messagesStream.innerHTML = "";

            // Render all historical messages (including food/drink photos)
            data.messages.forEach(msg => {
                const imgObj = msg.image_url ? { url: msg.image_url, title: msg.image_title } : null;
                appendMessageToUI(msg.role, msg.content, false, imgObj);
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

    // Stop speech if speaking
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }

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
            localStorage.setItem(LAST_CHAT_KEY, currentChatId);

            if (data.title) {
                activeChatTitle.textContent = data.title;
            }

            // Display AI response on the left (with food/drink image if matched)
            appendMessageToUI("model", data.response, data.is_off_topic, data.image);

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

function appendMessageToUI(role, content, isOffTopic = false, imageInfo = null) {
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

        // Add Food & Beverage Visual Card if image is available
        if (imageInfo && imageInfo.url) {
            const badgeTag = imageInfo.tag || "Cafe Special";
            const imgTitle = imageInfo.title || "Specialty Recipe";
            const imageCardHtml = `
                <div class="cafe-food-card">
                    <div class="food-card-img-wrap">
                        <img src="${escapeHtml(imageInfo.url)}" alt="${escapeHtml(imgTitle)}" class="food-card-img" loading="lazy" onerror="this.parentElement.parentElement.style.display='none'">
                        <span class="food-card-badge">${escapeHtml(badgeTag)}</span>
                    </div>
                    <div class="food-card-info">
                        <span class="food-card-title">${escapeHtml(imgTitle)}</span>
                        <a href="${escapeHtml(imageInfo.url)}" target="_blank" rel="noopener noreferrer" class="food-card-zoom-btn">🔍 View Full Image</a>
                    </div>
                </div>
            `;
            formattedHtml = imageCardHtml + formattedHtml;
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

    // Build the Action Bar (Text-to-speech speaker button for AI)
    let actionsBarHtml = "";
    if (!isUser && !isOffTopic) {
        actionsBarHtml = `
            <div class="msg-actions-bar">
                <button class="voice-listen-btn" title="Listen to response" data-speaking="false">
                    🔊 Listen
                </button>
            </div>
        `;
    }

    msgRow.innerHTML = `
        ${!isUser ? avatarBadge : ""}
        <div class="msg-container">
            <span class="msg-sender-tag">${senderTag}</span>
            <div class="msg-bubble">
                <div class="msg-body">${formattedHtml}</div>
                ${actionsBarHtml}
            </div>
        </div>
        ${isUser ? avatarBadge : ""}
    `;

    // Attach Text-to-Speech event to speaker button
    if (!isUser && !isOffTopic) {
        const listenBtn = msgRow.querySelector(".voice-listen-btn");
        if (listenBtn) {
            listenBtn.addEventListener("click", () => {
                speakBaristaResponse(content, listenBtn);
            });
        }
    }

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
// 5. VOICE FEATURES (SPEECH-TO-TEXT & TEXT-TO-SPEECH)
// =============================================================================

function setupVoiceRecognition() {
    if (!micBtn) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        micBtn.title = "Voice recognition is not supported in this browser. Please use Chrome or Edge.";
        micBtn.style.opacity = "0.5";
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let isListening = false;

    recognition.onstart = () => {
        isListening = true;
        micBtn.classList.add("listening");
        micBtn.title = "Listening... Click to stop";
        messageInput.placeholder = "🎙️ Listening to your voice... Speak now";
    };

    recognition.onresult = (event) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
        }
        messageInput.value = transcript;
        handleAutoResize();
    };

    recognition.onerror = (event) => {
        console.warn("Speech recognition error:", event.error);
        stopListeningState();
    };

    recognition.onend = () => {
        stopListeningState();
        if (messageInput.value.trim().length > 0) {
            // Auto send recorded message after speaking
            handleSendMessage();
        }
    };

    micBtn.addEventListener("click", () => {
        if (isListening) {
            recognition.stop();
        } else {
            try {
                recognition.start();
            } catch (err) {
                console.error("Failed to start voice recognition:", err);
            }
        }
    });

    function stopListeningState() {
        isListening = false;
        micBtn.classList.remove("listening");
        micBtn.title = "Speak your question";
        messageInput.placeholder = "Ask about teas, coffee roasts, snacks, baking recipes...";
    }
}

// Text-to-Speech (Barista Voice Reader)
function speakBaristaResponse(text, btnElement) {
    if (!('speechSynthesis' in window)) {
        alert("Text-to-speech is not supported in your browser.");
        return;
    }

    // If already speaking, stop and reset buttons
    if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        document.querySelectorAll(".voice-listen-btn").forEach(b => {
            b.classList.remove("speaking");
            b.dataset.speaking = "false";
            b.innerHTML = "🔊 Listen";
        });

        if (btnElement && btnElement.dataset.speaking === "true") {
            btnElement.dataset.speaking = "false";
            return;
        }
    }

    // Clean markdown characters for smooth speech narration
    const cleanText = text
        .replace(/[#*_`~>-]/g, " ")
        .replace(/\[(.*?)\]\(.*?\)/g, "$1")
        .replace(/(\r\n|\n|\r)/gm, ". ")
        .trim();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 0.96; // warm, comfortable barista pace
    utterance.pitch = 1.0;

    btnElement.classList.add("speaking");
    btnElement.dataset.speaking = "true";
    btnElement.innerHTML = "⏹️ Stop";

    utterance.onend = () => {
        btnElement.classList.remove("speaking");
        btnElement.dataset.speaking = "false";
        btnElement.innerHTML = "🔊 Listen";
    };

    utterance.onerror = () => {
        btnElement.classList.remove("speaking");
        btnElement.dataset.speaking = "false";
        btnElement.innerHTML = "🔊 Listen";
    };

    window.speechSynthesis.speak(utterance);
}

// =============================================================================
// 6. HELPER UTILITIES
// =============================================================================

function setGeneratingState(generating) {
    isGeneratingResponse = generating;
    sendBtn.disabled = generating;
    messageInput.disabled = generating;
    if (micBtn) micBtn.disabled = generating;
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
    if (!text) return "";
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
