import { LightningElement, track, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import saveChatTranscript from '@salesforce/apex/MessengerChatController.saveChatTranscript';
import initializeAgentSession from '@salesforce/apex/MessengerChatController.initializeAgentSession';
import getAgentRecommendation from '@salesforce/apex/MessengerChatController.getAgentRecommendation';
import addMessageToConversation from '@salesforce/apex/MessengerChatController.addMessageToConversation';
import endAgentSession from '@salesforce/apex/MessengerChatController.endAgentSession';
import callMurfTTS from '@salesforce/apex/MurfTTSController.callMurfTTS';

export default class MessengerChat extends LightningElement {
    // Design attributes from metadata
    @api agentName = 'Agentforce';
    @api defaultDarkMode = false;
    @api welcomeMessage = 'Hello! How can I assist you today?';
    @api allowVoiceMode = false;
    @api defaultVoiceMode = false; // Automatically start in voice mode after first message
    @api position = 'bottom-right';
    @api agentId = ''; // Replace with your actual Agentforce Agent ID
    @api headerText = 'Agentforce';
    @api murfApiKey = ''; // API key for Murf.ai TTS service
    @api consumerKey = ''; // Consumer Key for Agentforce API auth
    @api consumerSecret = ''; // Consumer Secret for Agentforce API auth
    @api searchMode = false; // Search Mode configuration
    @api searchModeWelcomeText = 'How can Agentforce help?'; // Welcome text for search mode
    @api gradientStartColor = '#F0F7FF'; // DEPRECATED: No longer used, kept for backwards compatibility
    @api gradientEndColor = '#C8DCFF'; // DEPRECATED: No longer used, kept for backwards compatibility
    @api themeColor = '#0076d3'; // Theme color for header and user messages

    // Reactive component state
    @track messages = [];
    @track messageText = '';
    @track isExpanded = false;
    @track isDarkMode = false;
    @track isVoiceMode = false;
    @track isTyping = false;
    @track showChat = true;
    @track isInitializing = true;
    @track showChatBubble = true;
    @track showChatWindow = false;
    @track chatEnded = false;
    @track showEndChatModal = false;
    @track sessionId;
    @track showOptionsMenu = false;
    @track isAgentTyping = false;
    @track welcomeMessageAdded = false;
    @track isTypewriterActive = false;
    @track isListening = false;
    @track isSpeaking = false;
    @track isMicrophoneMuted = false;
    @track voiceStatusText = 'Listening to you...';
    @track isSearchMode = false; // Track if currently in search mode
    @track isFirstUserMessage = true; // Track if this is the first user message
    @track isActivelySpeaking = false; // Track if user is actively speaking (detected by mic)
    @track isVoiceModeTransitioning = false; // Track voice mode transition state
    murfttsEndpoint = 'https://api.murf.ai/v1/speech/generate';

    // Internal flags
    sessionId = null;
    isInitialized = false;
    isSessionEnding = false;
    isDragging = false;
    startX = 0;
    startY = 0;
    lastX = 0;
    lastY = 0;
    isFirstThinkingMessage = true;
    
    // Voice recognition pause timer
    voicePauseTimer = null;
    lastTranscript = '';
    activeSpeakingTimer = null; // Timer to reset active speaking after silence

    // Track if chat was minimized vs. ended
    @track wasMinimized = false;

    connectedCallback() {
        // Apply search mode based on configuration
        this.isSearchMode = this.searchMode;
        
        // In search mode, we always start with light mode
        if (this.isSearchMode) {
            this.isDarkMode = false;
            this.applyLightMode();
        } else {
            // Apply dark mode based on user preference or defaultDarkMode setting
            try {
                const savedTheme = localStorage.getItem('messengerChatDarkMode');
                this.isDarkMode = savedTheme !== null ? savedTheme === 'true' : this.defaultDarkMode;
                
                if (this.isDarkMode) {
                    this.applyDarkMode();
                }
            } catch (e) {
                console.error('Error accessing localStorage', e);
                this.isDarkMode = this.defaultDarkMode;
            }
        }

        // Initial UI state - adjust based on search mode
        if (this.isSearchMode) {
            this.showChatBubble = false;
            this.showChatWindow = true;
            this.isExpanded = false; // Start unexpanded in search mode
        } else {
            this.showChatBubble = true;
            this.showChatWindow = false;
            this.chatEnded = false;
        }
        
        // Generate a temporary session ID before initialization
        this.sessionId = 'session_' + this.generateUUID();

        // Add window event listeners for drag functionality
        window.addEventListener('mousemove', this.handleMouseMove.bind(this));
        window.addEventListener('mouseup', this.handleMouseUp.bind(this));
        window.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
        window.addEventListener('touchend', this.handleTouchEnd.bind(this));

        if (this.isEmbedded) {
            // For Experience Cloud, set default position and enable voice mode
            // Always allow voice mode regardless of search mode
            this.position = 'bottom-right';
            this.headerText = 'Agentforce';
            this.allowVoiceMode = true;
        }
        
        // If in search mode, initialize the agent session immediately
        if (this.isSearchMode) {
            this.initializeAgentforce(true); // Pass true to indicate search mode
        }
    }

    disconnectedCallback() {
        // Remove event listeners
        window.removeEventListener('mousemove', this.handleMouseMove.bind(this));
        window.removeEventListener('mouseup', this.handleMouseUp.bind(this));
        window.removeEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
        window.removeEventListener('touchend', this.handleTouchEnd.bind(this));

        // Clean up any remaining resources
        if (this.audioContext) {
            this.audioContext.close();
        }
    }

    // ------------------------------
    // Agent Session Initialization
    // ------------------------------
    initializeAgentforce(isSearchModeInit = false) {
        if (this.isInitialized) {
            console.log('Skipping initialization – already initialized');
            return;
        }
        
        if (!this.agentId) {
            console.error('Missing Agent ID: Please configure an Agent ID in the Experience Builder component properties');
            this.isTyping = true;
            this.messages = [...this.messages, {
                id: `msg_${Date.now()}`,
                text: 'Error: Agent ID not configured. Please ask your administrator to configure an Agent ID in the component settings.',
                sender: 'agent',
                cssClass: 'message bot-message error-message',
                timestamp: this.getTimestamp()
            }];
            return;
        }
        
        if (!this.consumerKey || !this.consumerSecret) {
            console.error('Missing authentication credentials: Please configure Consumer Key and Consumer Secret in the Experience Builder component properties');
            this.isTyping = true;
            this.messages = [...this.messages, {
                id: `msg_${Date.now()}`,
                text: 'Error: Authentication credentials not configured. Please ask your administrator to configure the Consumer Key and Consumer Secret in the component settings.',
                sender: 'agent',
                cssClass: 'message bot-message error-message',
                timestamp: this.getTimestamp()
            }];
            return;
        }
        
        if (!isSearchModeInit) {
            console.log('Initializing Agentforce session with agent ID:', this.agentId);
            this.isTyping = true;
            this.messages = [...this.messages, {
                id: `msg_${Date.now()}`,
                text: 'Welcome! Initializing Agentforce...',
                sender: 'agent',
                cssClass: 'message bot-message',
                timestamp: this.getTimestamp()
            }];
        }

        const initializationTimeout = setTimeout(() => {
            if (!isSearchModeInit) {
                console.log('Initialization is taking longer than expected...');
                this.updateInitializationMessage('Still working on connecting to Agentforce...');
            }
        }, 5000);

        let retryCount = 0;
        const maxRetries = 2;

        const performInitialization = () => {
            // Log configuration details
            console.log('Configuration details:');
            console.log('- Agent ID:', this.agentId);
            console.log('- URL:', window.location.href);
            
            initializeAgentSession({ 
                agentId: this.agentId,
                consumerKey: this.consumerKey,
                consumerSecret: this.consumerSecret
            })
                .then(result => {
                    clearTimeout(initializationTimeout);
                    console.log('Session initialized successfully:', result);
                    this.isTyping = false;
                    if (!result) {
                        throw new Error('Session initialization failed – no session ID returned');
                    }
                    this.sessionId = result;
                    this.isInitialized = true;
                    
                    if (!isSearchModeInit) {
                        this.updateInitializationMessage('Connected to Agentforce successfully!');
                        
                        // Set a flag to track that we've added the welcome message
                        if (!this.welcomeMessageAdded) {
                            setTimeout(() => {
                                // Remove initialization messages
                                this.messages = this.messages.filter(m => 
                                    !m.text.includes('Connected to Agentforce') && 
                                    !m.text.includes('Initializing Agentforce')
                                );
                                // Let the agent response system handle the first message
                                this.getAgentResponse('Hello');
                                this.welcomeMessageAdded = true;
                            }, 1500);
                        }
                    } else {
                        // In search mode, we don't show any welcome messages
                        // Agent is ready but silent until first user input
                        this.welcomeMessageAdded = true;
                    }
                })
                .catch(error => {
                    clearTimeout(initializationTimeout);
                    
                    // Enhanced error logging
                    console.error('Error initializing Agentforce session:', error);
                    
                    // Log detailed error information
                    if (error.body) {
                        console.error('Error details:', {
                            message: error.body.message,
                            stackTrace: error.body.stackTrace,
                            error: error.body.error,
                            status: error.status,
                            statusText: error.statusText
                        });
                    }
                    
                    const errorMsg = this.getErrorMessage(error);
                    console.error('Formatted error message:', errorMsg);
                    
                    // Show detailed error to the user in debug mode
                    const userErrorMsg = 
                        `Error connecting to Agentforce (${error.status || 'unknown status'}): ${errorMsg}\n\n` +
                        `Additional troubleshooting:\n` +
                        `1. Verify Remote Site Setting for "api.salesforce.com" and "login.salesforce.com"\n` +
                        `2. Check Agent ID is valid: ${this.agentId}\n` +
                        `3. Verify Consumer Key and Consumer Secret are correct\n` +
                        `4. Verify Connected App has proper OAuth scopes`;
                    
                    if (retryCount < maxRetries) {
                        retryCount++;
                        console.log(`Retrying initialization (attempt ${retryCount} of ${maxRetries})...`);
                        this.updateInitializationMessage(`Reconnecting to Agentforce (attempt ${retryCount} of ${maxRetries})...`);
                        setTimeout(performInitialization, 2000);
                    } else {
                        this.isTyping = false;
                        // Show detailed error message after all retries fail
                        this.updateInitializationMessage("Couldn't connect to Agentforce. Please contact your administrator.");
                        
                        // Add a detailed error message
                        this.messages = [...this.messages, {
                            id: `msg_${Date.now()}`,
                            text: userErrorMsg,
                            sender: 'agent',
                            cssClass: 'message bot-message error-message',
                            timestamp: this.getTimestamp()
                        }];
                        
                        this.isInitialized = false;
                        console.error('All initialization attempts failed:', errorMsg);
                    }
                });
        };
        performInitialization();
    }

    updateInitializationMessage(text) {
        const initMsgIndex = this.messages.findIndex(m =>
            m.text.includes('Initializing Agentforce') ||
            m.text.includes('connecting to Agentforce') ||
            m.text.includes('Reconnecting to Agentforce')
        );
        if (initMsgIndex !== -1) {
            const updatedMessages = [...this.messages];
            updatedMessages[initMsgIndex] = { ...updatedMessages[initMsgIndex], text };
            this.messages = updatedMessages;
            this.scrollToBottom();
        }
    }

    // ------------------------------
    // Chat UI Toggle Handlers
    // ------------------------------
    handleChatBubbleClick() {
        if (this.isSearchMode) {
            return; // Chat bubble is not used in search mode
        }
        
        console.log('Chat bubble clicked');
        this.showChatBubble = false;
        this.showChatWindow = true;
        
        // If the chat was minimized (not ended), preserve the conversation
        if (this.wasMinimized) {
            console.log('Restoring minimized chat');
            this.wasMinimized = false;
        } else {
            // Only clear and reinitialize if this wasn't a minimized chat
            console.log('Starting new chat session');
            // Clear previous messages and reset state when reopening chat
            this.messages = [];
            this.isFirstThinkingMessage = true;
            this.welcomeMessageAdded = false;
            
            // Only reinitialize if needed
            if (!this.isInitialized || !this.sessionId) {
                // Reset session ID to ensure a fresh chat
                this.sessionId = null;
                this.isInitialized = false;
                this.initializeAgentforce();
            } else {
                // If already initialized but reopening the chat, send a greeting
                setTimeout(() => {
                    if (!this.welcomeMessageAdded) {
                        this.getAgentResponse('Hello');
                        this.welcomeMessageAdded = true;
                    }
                }, 300);
            }
        }
        
        this.scrollToBottom();
    }

    handleToggleExpand() {
        console.log('Toggling expanded state:', this.isExpanded, '->', !this.isExpanded);
        this.isExpanded = !this.isExpanded;
        
        if (this.isExpanded) {
            // Expanded state styling - full screen
            document.body.style.overflow = 'hidden';
        } else {
            // Regular state styling
            document.body.style.overflow = '';
        }
        
        // Close options menu when toggling
        this.showOptionsMenu = false;
        
        // Scroll to bottom after expanding
        if (this.isExpanded) {
            this.scrollToBottom();
        }
    }

    handleToggleTheme() {
        this.toggleDarkMode();
        this.showOptionsMenu = false;
    }

    toggleDarkMode() {
        this.isDarkMode = !this.isDarkMode;
        console.log('Dark mode toggled to:', this.isDarkMode);
        
        if (this.isDarkMode) {
            this.applyDarkMode();
        } else {
            this.applyLightMode();
        }
        
        try {
            localStorage.setItem('messengerChatDarkMode', this.isDarkMode);
        } catch (e) {
            console.error('Error saving theme preference', e);
        }
        this.showOptionsMenu = false;
    }
    
    applyDarkMode() {
        const chatWindow = this.template.querySelector('.chat-window');
        if (chatWindow) {
            chatWindow.classList.add('dark-mode');
        }
    }
    
    applyLightMode() {
        const chatWindow = this.template.querySelector('.chat-window');
        if (chatWindow) {
            chatWindow.classList.remove('dark-mode');
        }
    }

    toggleVoiceInput() {
        if (!this.allowVoiceMode) return;
        
        // Stop any current audio playback first
        this.stopAudioPlayback();
        
        this.isVoiceMode = !this.isVoiceMode;
        
        if (this.isVoiceMode) {
            this.isListening = true;
            this.isSpeaking = false;
            this.isMicrophoneMuted = false;
            this.voiceStatusText = 'Listening to you...';
            
            // Directly start voice recognition without testing Murf.ai API
            this.startVoiceRecognition();
        } else {
            this.isListening = false;
            this.isSpeaking = false;
            this.isMicrophoneMuted = false;
            
            // Clear any pending voice pause timer when exiting voice mode
            if (this.voicePauseTimer) {
                clearTimeout(this.voicePauseTimer);
                this.voicePauseTimer = null;
            }
            this.lastTranscript = '';
            
            this.stopVoiceRecognition();
        }
        this.showOptionsMenu = false;
    }    

    toggleOptionsMenu() {
        this.showOptionsMenu = !this.showOptionsMenu;
    }

    handleClickOutside(event) {
        const optionsMenu = this.template.querySelector('.options-menu');
        const optionsButton = this.template.querySelector('.options-toggle');
        if (optionsMenu && !optionsMenu.contains(event.target) &&
            optionsButton && !optionsButton.contains(event.target)) {
            this.showOptionsMenu = false;
            window.removeEventListener('click', this.handleClickOutside.bind(this));
        }
    }

    handleMinimizeToBubble() {
        if (this.isSearchMode) {
            // If expanded, return to container size
            if (this.isExpanded) {
                this.isExpanded = false;
                document.body.style.overflow = '';
            } else {
                // Not expanded and in search mode, show chat bubble
                this.showChatWindow = false;
                this.showChatBubble = true;
                this.wasMinimized = true;
            }
            return;
        }
        
        // Regular minimize to bubble behavior
        console.log('Minimizing to bubble');
        this.showChatWindow = false;
        this.showChatBubble = true;
        this.wasMinimized = true;
    }

    // ------------------------------
    // Message Input and Sending
    // ------------------------------
    handleMessageChange(event) {
        this.messageText = event.target.value;
        
        // Auto-expand the textarea only when content actually requires it
        const textarea = event.target;
        if (textarea) {
            // Reset height to calculate scroll height correctly
            textarea.style.height = '40px'; // Start with single line height
            
            // Only expand if text contains a newline or exceeds visible area
            const hasNewLine = textarea.value.includes('\n');
            const exceedsHeight = textarea.scrollHeight > textarea.clientHeight;
            
            if (hasNewLine || exceedsHeight) {
                // Set new height based on content (with a max height)
                const newHeight = Math.min(120, textarea.scrollHeight);
                textarea.style.height = `${newHeight}px`;
                
                // Add expanded class for scrollbar appearance
                if (newHeight > 40) {
                    textarea.classList.add('expanded');
                }
            } else {
                // Keep as single line
                textarea.classList.remove('expanded');
            }
        }
    }

    handleKeyPress(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.sendMessage();
        }
    }

    sendMessage() {
        const text = this.template.querySelector('.message-textarea').value.trim();
        if (text === '') return;
        
        if (this.isSearchMode && this.isFirstUserMessage) {
            // For the first message in search mode, stay in container size
            // Don't expand automatically, keep confined to container
        }
        
        this.addUserMessage(text);
        this.getAgentResponse(text);
        this.template.querySelector('.message-textarea').value = '';
        this.messageText = '';
    }

    addUserMessage(text) {
        if (!text.trim()) return;
        
        // Check if this is the first message and default voice mode is enabled
        // Only activate if not already in voice mode
        const shouldActivateVoiceMode = this.isFirstUserMessage && this.defaultVoiceMode && 
                                       !this.isVoiceMode && (this.allowVoiceMode || this.isEmbedded);
        
        this.addMessage(text, 'user');
        
        // Update first message flag and activate voice mode if configured
        if (this.isFirstUserMessage) {
            this.isFirstUserMessage = false;
            
            // Activate voice mode immediately after the first message if configured
            if (shouldActivateVoiceMode) {
                this.activateVoiceModeWithTransition();
            }
        }
    }

    addBotMessage(text) {
        if (!text) return;
        
        // Extract thinking process from <think> tags if present
        let thinkingProcess = '';
        let displayText = text;
        
        const thinkRegex = /<think>([\s\S]*?)<\/think>/;
        const match = text.match(thinkRegex);
        
        if (match && match[1]) {
            thinkingProcess = match[1].trim();
            // Remove the thinking process from the display text
            displayText = text.replace(thinkRegex, '').trim();
        }
        
        const messageId = `msg_${Date.now()}`;
        // Flag to track if typing is in progress
        this.isTypewriterActive = true;
        
        // Add message with safe HTML rendering
        this.messages = [...this.messages, {
            id: messageId,
            text: '',
            sender: 'agent',
            cssClass: 'message bot-message',
            timestamp: this.getTimestamp(),
            rawHtml: true // Flag to indicate this contains HTML
        }];
        this.scrollToBottom();
        
        // Use a faster typing speed to show text quicker
        const typingSpeed = 3; 
        let displayedText = '';
        let charIndex = 0;
        
        const typeNextChar = () => {
            if (charIndex < displayText.length) {
                displayedText += displayText.charAt(charIndex);
                charIndex++;
                
                // Update the message text
                const updatedMessages = [...this.messages];
                const messageIndex = updatedMessages.findIndex(m => m.id === messageId);
                if (messageIndex !== -1) {
                    updatedMessages[messageIndex].text = this.sanitizeAndRenderHTML(displayedText);
                    this.messages = updatedMessages;
                }
                
                this.scrollToBottom();
                setTimeout(typeNextChar, typingSpeed);
            } else {
                // Done typing, add the thinking process if we have one
                if (thinkingProcess) {
                    const updatedMessages = [...this.messages];
                    const messageIndex = updatedMessages.findIndex(m => m.id === messageId);
                    if (messageIndex !== -1) {
                        updatedMessages[messageIndex].thinkingProcess = thinkingProcess;
                        this.messages = updatedMessages;
                    }
                }
                this.isTypewriterActive = false;
            }
        };
        
        setTimeout(typeNextChar, typingSpeed);
    }

    addMessage(text, sender = 'agent', timestamp = this.getTimestamp()) {
        if (!text || text === 'undefined') {
            console.error('Attempted to add undefined or empty message');
            return;
        }
        const messageObj = {
            id: `msg_${this.messages.length + 1}`,
            sender,
            text,
            timestamp
        };
        this.messages = [...this.messages, messageObj];
        setTimeout(() => { this.scrollToBottom(); }, 50);
        return messageObj;
    }

    getTimestamp() {
        const now = new Date();
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        return `${hours}:${minutes}`;
    }

    // ------------------------------
    // Agent Response Handling
    // ------------------------------
    getAgentResponse(message) {
        if (!message || this.isAgentTyping) return;
        this.isAgentTyping = true;
        
        // Don't add typing indicator in voice mode
        if (!this.isVoiceMode) {
            // Add a typing indicator
            const typingId = `typing_${Date.now()}`;
            
            // Check if this is the first thinking message of the session
            const typingText = this.isFirstThinkingMessage ? "Agentforce incoming..." : "Agentforce is thinking...";
            
            // Set flag to false for subsequent messages
            if (this.isFirstThinkingMessage) {
                this.isFirstThinkingMessage = false;
            }
            
            const typingMsg = {
                id: typingId,
                text: typingText,
                sender: 'agent',
                cssClass: 'message bot-message typing shimmer-text',
                timestamp: this.getTimestamp(),
                isTypingMessage: true // Add explicit flag
            };
            console.log('Adding typing indicator:', typingMsg);
            this.messages = [...this.messages, typingMsg];
            this.scrollToBottom();
        }

        let retryCount = 0;
        const maxRetries = 1;

        const getResponse = () => {
            getAgentRecommendation({ 
                sessionId: this.sessionId, 
                message, 
                consumerKey: this.consumerKey,
                consumerSecret: this.consumerSecret
            })
                .then(response => {
                    console.log('Agent response received, length:', response ? response.length : 0);
                    
                    // Remove typing indicator if not in voice mode
                    if (!this.isVoiceMode) {
                        console.log('Removing typing indicator');
                        this.messages = this.messages.filter(m => 
                            !m.text.includes('Agentforce is thinking') && 
                            !m.text.includes('Agentforce incoming')
                        );
                    }
                    
                    this.isAgentTyping = false;
                    
                    if (response) {
                        if (this.isVoiceMode) {
                            // In voice mode, extract plain text for speech but still use HTML rendering for display
                            
                            // Extract thinking process if present
                            let thinkingProcess = '';
                            let displayText = response;
                            
                            const thinkRegex = /<think>([\s\S]*?)<\/think>/;
                            const match = response.match(thinkRegex);
                            
                            if (match && match[1]) {
                                thinkingProcess = match[1].trim();
                                // Remove the thinking process from the display text
                                displayText = response.replace(thinkRegex, '').trim();
                            }
                            
                            // Add the styled HTML message to the conversation
                            const messageId = `msg_${Date.now()}`;
                            this.messages = [...this.messages, {
                                id: messageId,
                                text: displayText,
                                sender: 'agent',
                                cssClass: 'message bot-message',
                                timestamp: this.getTimestamp(),
                                rawHtml: true, // Flag to indicate this contains HTML
                                thinkingProcess: thinkingProcess // Add thinking process if available
                            }];
                            
                            // Extract clean text for speech
                            const cleanText = this.stripHtmlTags(displayText);
                            this.speakText(cleanText);
                        } else {
                            // In text mode, use the normal addBotMessage
                            this.addBotMessage(response);
                        }
                    } else {
                        const errorMessage = "I'm sorry, I don't have a response for that.";
                        if (this.isVoiceMode) {
                            this.addMessage(errorMessage, 'agent');
                            this.speakText(errorMessage);
                        } else {
                            this.addBotMessage(errorMessage);
                        }
                    }
                })
                .catch(error => {
                    // Handle errors as before
                    console.error('Error getting agent response:', error);
                    const errorMsg = this.getErrorMessage(error);
                    const isSessionError = errorMsg.toLowerCase().includes('session') ||
                        errorMsg.toLowerCase().includes('expired') || error.status === 404;
                    if (isSessionError && retryCount < maxRetries) {
                        retryCount++;
                        console.log(`Session error detected. Retrying initialization (retry ${retryCount} of ${maxRetries})`);
                        const idx = this.messages.findIndex(m => m.id === typingId);
                        if (idx !== -1) {
                            const updated = [...this.messages];
                            updated[idx] = { ...updated[idx], text: 'Reconnecting to Agentforce...' };
                            this.messages = updated;
                            this.scrollToBottom();
                        }
                        this.sessionId = null;
                        this.isInitialized = false;
                        this.initializeAgentforce();
                        setTimeout(() => {
                            this.messages = this.messages.filter(m => m.id !== typingId);
                            if (this.isInitialized) {
                                this.getAgentResponse(message);
                            } else {
                                this.isAgentTyping = false;
                                this.addBotMessage("I'm sorry, I couldn't reconnect to the agent. Please try again later.");
                            }
                        }, 5000);
                    } else {
                        this.messages = this.messages.filter(m => m.id !== typingId);
                        this.isAgentTyping = false;
                        this.addBotMessage("I'm sorry, I encountered an error while processing your request.");
                        this.messages = [...this.messages, {
                            id: `debug_${Date.now()}`,
                            text: 'Error: ' + errorMsg,
                            sender: 'system',
                            cssClass: 'message system-message',
                            timestamp: this.getTimestamp()
                        }];
                        this.scrollToBottom();
                    }
                });
        };
        getResponse();
    }

    // ------------------------------
    // Voice Recognition
    // ------------------------------
    startVoiceRecognition() {
        // Don't start voice recognition if microphone is muted
        if (this.isMicrophoneMuted) {
            return;
        }
        
        try {
            // First make sure any existing recognition is stopped
            if (this.recognition) {
                try {
                    this.recognition.stop();
                } catch (e) {
                    // Ignore errors when stopping existing recognition
                    console.log('Ignoring error when stopping existing recognition');
                }
                // Clear existing recognition
                this.recognition = null;
            }
            
            if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
                const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                this.recognition = new SpeechRecognition();
                this.recognition.continuous = true; // Change to true for continuous listening
                this.recognition.interimResults = true;
                this.recognition.lang = 'en-US';

                this.recognition.onstart = () => {
                    console.log('Voice recognition started');
                    this.isListening = true;
                    this.isActivelySpeaking = false; // Reset active speaking flag
                    this.voiceStatusText = 'Listening to you...';
                    // Start visualizer animation for microphone input
                    this.startVisualizerAnimation();
                };
                
                this.recognition.onresult = (event) => {
                    const resultIndex = event.resultIndex;
                    const transcript = event.results[resultIndex][0].transcript;
                    
                    // Track active speaking for pulse animation
                    this.isActivelySpeaking = true;
                    
                    // Clear any existing active speaking timer and start a new one
                    if (this.activeSpeakingTimer) {
                        clearTimeout(this.activeSpeakingTimer);
                    }
                    this.activeSpeakingTimer = setTimeout(() => {
                        this.isActivelySpeaking = false;
                    }, 1000); // Reset after 1 second of silence
                    
                    // Update visualizer based on voice volume
                    const volume = event.results[resultIndex][0].confidence || 0.5;
                    this.updateVisualizerVolume(volume);
                    
                    // Clear any existing pause timer
                    if (this.voicePauseTimer) {
                        clearTimeout(this.voicePauseTimer);
                        this.voicePauseTimer = null;
                    }
                    
                    // Update the last transcript
                    this.lastTranscript = transcript;
                    
                    // For final results, start a pause timer
                    if (event.results[resultIndex].isFinal && transcript.trim().length > 0) {
                        console.log('Final voice transcript (waiting for pause):', transcript);
                        
                        // Stop active speaking animation since speech ended
                        this.isActivelySpeaking = false;
                        
                        // Start a 2.5 second timer
                        this.voicePauseTimer = setTimeout(() => {
                            console.log('Voice pause detected, sending message:', this.lastTranscript);
                            
                            // Set UI state to "thinking" and auto-mute microphone
                            this.isListening = false;
                            this.isActivelySpeaking = false;
                            this.isMicrophoneMuted = true; // Auto-mute during thinking
                            this.voiceStatusText = 'Agentforce is thinking...';
                            
                            // Add the user message to the conversation
                            this.addUserMessage(this.lastTranscript);
                            
                            // Stop listening while processing
                            try { this.recognition.stop(); } catch (e) { console.error(e); }
                            
                            // Get agent response
                            this.getAgentResponse(this.lastTranscript);
                            
                            // Clear the timer and transcript
                            this.voicePauseTimer = null;
                            this.lastTranscript = '';
                        }, 2500); // 2.5 second delay
                    }
                };
                
                this.recognition.onerror = (event) => {
                    console.error('Speech recognition error:', event.error);
                    // Only show error and exit voice mode for critical errors, not for abort/no-speech
                    if (event.error !== 'aborted' && event.error !== 'no-speech') {
                        this.showToast('Voice Error', 'Voice recognition error: ' + event.error, 'error');
                        this.isVoiceMode = false;
                        this.isListening = false;
                    } else {
                        console.log('Non-critical recognition error:', event.error);
                    }
                };
                
                this.recognition.onend = () => {
                    console.log('Voice recognition ended');
                    // Only restart if we're still in listening mode and not speaking
                    if (this.isVoiceMode && this.isListening && !this.isSpeaking) {
                        try { 
                            setTimeout(() => {
                                this.recognition.start();
                            }, 200);
                        } catch (e) { 
                            console.error('Failed to restart voice recognition', e); 
                        }
                    }
                };
                
                // Start recognition with a small delay to ensure previous instance is cleaned up
                setTimeout(() => {
                    try {
                        this.recognition.start();
                    } catch (e) {
                        console.error('Error starting recognition after delay:', e);
                    }
                }, 100);
            } else {
                console.log('Speech recognition not supported');
                this.showToast('Not Supported', 'Voice mode is not supported in your browser.', 'warning');
                this.isVoiceMode = false;
                this.isListening = false;
            }
        } catch (error) {
            console.error('Error initializing voice recognition:', error);
            this.showToast('Voice Error', 'Voice recognition not available.', 'error');
            this.isVoiceMode = false;
            this.isListening = false;
        }
    }

    // Update visualizer bars based on voice volume
    updateVisualizerVolume(volume) {
        const bars = this.template.querySelectorAll('.visualizer-bar');
        if (bars && bars.length) {
            const maxHeight = 45; // Maximum height in pixels
            
            // Create varying heights based on volume with some randomization
            bars.forEach((bar) => {
                // Add some randomness to volume for more natural effect
                const randomFactor = Math.random() * 0.4 + 0.8; // 0.8 to 1.2
                const barHeight = Math.max(5, Math.floor(volume * maxHeight * randomFactor));
                bar.style.height = `${barHeight}px`;
            });
        }
    }

    // Animate visualizer for agent speaking
    animateAgentSpeaking() {
        const bars = this.template.querySelectorAll('.visualizer-bar');
        if (bars && bars.length) {
            bars.forEach(bar => {
                bar.style.backgroundColor = '#3182ce'; // Blue for agent
                bar.style.animation = 'voice-bar 1s ease-in-out infinite';
                bar.style.animationDelay = Math.random() * 0.5 + 's';
            });
            
            // Add agent speaking indicator
            const speakingMsg = this.messages.find(m => m.text.includes('Agent is speaking'));
            if (!speakingMsg) {
                this.messages = [...this.messages, {
                    id: `agent_voice_${Date.now()}`,
                    text: 'Agent is speaking...',
                    sender: 'system',
                    cssClass: 'message system-message',
                    timestamp: this.getTimestamp()
                }];
                this.scrollToBottom();
            }
        }
    }

    // Start animation for the voice visualizer bars
    startVisualizerAnimation() {
        const bars = this.template.querySelectorAll('.visualizer-bar');
        if (bars && bars.length) {
            bars.forEach(bar => {
                bar.style.backgroundColor = '#ffffff'; // White for user
                bar.style.animation = 'voice-bar 1s ease-in-out infinite';
                bar.style.animationDelay = Math.random() * 0.5 + 's';
            });
        }
    }

    // Stop animation for the voice visualizer bars
    stopVisualizerAnimation() {
        const bars = this.template.querySelectorAll('.visualizer-bar');
        if (bars && bars.length) {
            bars.forEach(bar => {
                bar.style.animation = 'none';
                bar.style.height = '5px';
            });
        }
        
        // Remove any voice-related system messages
        this.messages = this.messages.filter(m => 
            !m.text.includes('Listening to your voice') && 
            !m.text.includes('Agent is speaking')
        );
    }

    // Text-to-speech for agent responses - enhanced with visualization
    speakText(text) {
        if (!text) return;
        
        // Set UI state to speaking and mute microphone
        this.isListening = false;
        this.isSpeaking = true;
        this.stopVoiceRecognition(); // Ensure microphone is stopped
        
        // Use "incoming" for first voice message
        const voiceStatusText = this.isFirstThinkingMessage ? "Agentforce incoming..." : "Agentforce is responding...";
        this.voiceStatusText = voiceStatusText;
        
        // Set flag to false for subsequent messages
        if (this.isFirstThinkingMessage) {
            this.isFirstThinkingMessage = false;
        }
        
        // Extract and remove any thinking process content first
        let processedText = text;
        const thinkRegex = /<think>([\s\S]*?)<\/think>/;
        if (thinkRegex.test(processedText)) {
            processedText = processedText.replace(thinkRegex, '').trim();
            console.log('Removed thinking process from TTS text');
        }
        
        // Strip HTML tags for speech
        const cleanText = this.stripHtmlTags(processedText);
        
        console.log('Starting text-to-speech process for:', cleanText.substring(0, 50) + (cleanText.length > 50 ? '...' : ''));
        
        // First try using Murf.ai API
        this.speakWithMurfApi(cleanText)
            .then(() => {
                console.log('Speech completed using Murf.ai');
            })
            .catch(error => {
                console.error('Error with Murf.ai TTS, falling back to browser TTS:', error);
                
                // Check if Murf API returned a specific error
                if (error && error.message) {
                    console.warn('Murf.ai error message:', error.message);
                }
                
                // Try browser fallback with a slight delay to ensure UI updates
                setTimeout(() => {
                    this.speakWithBrowserTTS(cleanText);
                }, 300);
            });
    }

    // Add this utility function to strip HTML tags from text
    stripHtmlTags(html) {
        if (!html) return '';
        
        try {
            // First remove any <think> tags and their content
            const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
            const textWithoutThinking = html.replace(thinkRegex, '');
            
            // Create a temporary div element
            const tempDiv = document.createElement('div');
            
            // Set the HTML content
            tempDiv.innerHTML = textWithoutThinking;
            
            // Remove any script tags for security
            const scripts = tempDiv.querySelectorAll('script');
            scripts.forEach(script => script.remove());
            
            // Return the text content only (strips all HTML tags)
            return tempDiv.textContent || tempDiv.innerText || '';
        } catch (error) {
            console.error('Error stripping HTML tags:', error);
            // Fallback to basic tag stripping
            return html.replace(/<\/?[^>]+(>|$)/g, '');
        }
    }

    // Update the speakWithMurfApi method with improved error handling and logging
    speakWithMurfApi(cleanText) {
        return callMurfTTS({ text: cleanText, murfApiKey: this.murfApiKey })
            .then(result => {
                console.log('Received audio URL from proxy:', result);
                return new Promise((resolve, reject) => {
                    const audio = new Audio();
                    audio.src = result;
                    audio.load();
                    
                    // Store reference to the current audio for easy cleanup
                    this.currentAudio = audio;
                    
                    // When the audio is ready to play, start playback
                    audio.addEventListener('canplaythrough', () => {
                        console.log('Audio is ready, starting playback.');
                        audio.play().then(() => {
                            console.log('Audio playback started.');
                        }).catch(err => {
                            console.error('Error starting audio playback:', err);
                            reject(err);
                        });
                    });
                    
                    // When audio playback ends, reset state and restart voice recognition if needed
                    audio.addEventListener('ended', () => {
                        console.log('Audio playback ended.');
                        this.isSpeaking = false;
                        this.isListening = true;
                        this.voiceStatusText = 'Listening to you...';
                        this.currentAudio = null;
                        
                        if (this.isVoiceMode) {
                            this.startVoiceRecognition();
                        }
                        resolve();
                    });
                    
                    // Handle any playback errors
                    audio.addEventListener('error', (e) => {
                        console.error('Audio playback error:', e);
                        this.currentAudio = null;
                        reject(e);
                    });
                });
            })
            .catch(error => {
                console.error('Error calling Murf.ai via proxy:', error);
                return Promise.reject(error);
            });
    }    

    // Update the speakWithBrowserTTS method to use cleanText
    speakWithBrowserTTS(cleanText) {
        if ('speechSynthesis' in window) {
            // Cancel any ongoing speech
            window.speechSynthesis.cancel();
            
            // Animate visualizer during speaking
            this.animateSpeakingVisualizer();
            
            // Create utterance
            const utterance = new SpeechSynthesisUtterance(cleanText);
            utterance.lang = 'en-US';
            utterance.rate = 1.0;
            utterance.pitch = 1.0;
            utterance.volume = 1.0;
            
            // Try to get a female voice
            const voices = window.speechSynthesis.getVoices();
            if (voices.length > 0) {
                const femaleVoice = voices.find(voice => 
                    voice.name.includes('female') || 
                    voice.name.includes('Samantha') || 
                    voice.name.includes('Google US English Female'));
                
                if (femaleVoice) {
                    utterance.voice = femaleVoice;
                }
            }
            
            // Set up events
            utterance.onstart = () => {
                console.log('Browser TTS started');
            };
            
            utterance.onend = () => {
                console.log('Browser TTS ended');
                // Reset UI state
                this.isSpeaking = false;
                
                // Only restart listening if microphone is not manually muted
                if (!this.isMicrophoneMuted) {
                    this.isListening = true;
                    this.voiceStatusText = 'Listening to you...';
                    
                    // Restart voice recognition
                    if (this.isVoiceMode) {
                        this.startVoiceRecognition();
                    }
                } else {
                    this.voiceStatusText = 'Microphone muted';
                }
            };
            
            utterance.onerror = (event) => {
                console.error('Browser TTS error:', event);
                this.isSpeaking = false;
                
                // Only restart listening if microphone is not manually muted
                if (!this.isMicrophoneMuted) {
                    this.isListening = true;
                    this.voiceStatusText = 'Listening to you...';
                    
                    if (this.isVoiceMode) {
                        this.startVoiceRecognition();
                    }
                } else {
                    this.voiceStatusText = 'Microphone muted';
                }
            };
            
            // Speak
            window.speechSynthesis.speak(utterance);
        } else {
            console.error('Browser TTS not supported');
            this.isSpeaking = false;
            this.isListening = true;
            this.voiceStatusText = 'Listening to you...';
            
            if (this.isVoiceMode) {
                this.startVoiceRecognition();
            }
        }
    }

    // Add method to animate visualizer during speaking
    animateSpeakingVisualizer() {
        const bars = this.template.querySelectorAll('.visualizer-bar');
        if (bars && bars.length) {
            bars.forEach((bar, index) => {
                bar.style.backgroundColor = '#0076d3'; // Blue for agent
                bar.style.animation = 'voice-bar 1s ease-in-out infinite';
                bar.style.animationDelay = `${index * 0.1}s`; // Staggered animation
            });
        }
    }

    // ------------------------------
    // Chat Transcript, Toast & Utility Methods
    // ------------------------------
    saveChatTranscript() {
        const messagesJson = JSON.stringify(this.messages);
        saveChatTranscript({ messages: messagesJson })
            .then(result => { console.log('Chat transcript saved:', result); })
            .catch(error => { console.error('Error saving chat transcript:', error); });
    }

    showToast(title, message, variant) {
        const evt = new ShowToastEvent({ title, message, variant });
        this.dispatchEvent(evt);
    }

    reduceError(error) {
        if (typeof error === 'string') return error;
        if (Array.isArray(error.body)) return error.body.map(e => e.message).join(', ');
        if (error.body && typeof error.body.message === 'string') return error.body.message;
        if (typeof error.message === 'string') return error.message;
        return 'Unknown error';
    }

    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            let r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    getErrorMessage(error) {
        if (!error) {
            return 'Unknown error';
        }
        
        // Capture as much error information as possible
        console.log('Raw error object:', JSON.stringify(error));
        
        if (typeof error === 'string') {
            return error;
        }
        
        // Handle AuraHandledException and other Salesforce errors
        if (error.body && error.body.message) {
            return error.body.message;
        }
        
        if (error.body && typeof error.body === 'string') {
            try {
                const parsed = JSON.parse(error.body);
                if (parsed.message) {
                    return parsed.message;
                }
            } catch (e) {
                // If body isn't JSON, return it directly
                return error.body;
            }
        }
        
        if (error.message) {
            return error.message;
        }
        
        if (error.status) {
            return `HTTP Error: ${error.status} ${error.statusText || ''}`;
        }
        
        return 'Unknown error occurred';
    }

    endChat() {
        // Prevent multiple end chat calls in progress
        if (this.isSessionEnding) {
            return;
        }

        console.log('Ending chat session:', this.sessionId);
        this.isSessionEnding = true;
        
        if (this.isVoiceMode) {
            this.toggleVoiceInput();
        }
        
        // Add a message indicating the chat has ended - as an agent message instead of system
        this.addMessage('Ending chat session.', 'agent');
        
        // Stop any ongoing speech
        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
        
        // Call the controller to end the session
        if (this.sessionId) {
            endAgentSession({ sessionId: this.sessionId })
                .then(() => {
                    console.log('Session ended successfully');
                })
                .catch(error => {
                    console.error('Error ending session:', this.reduceError(error));
                })
                .finally(() => {
                    this.isSessionEnding = false;
                    // If search mode is enabled, return to initial search state 
                    if (this.isSearchMode) {
                        this.resetChatStateForSearchMode();
                    } else {
                        // Standard end chat behavior - restore original behavior
                        this.showEndChatModal = false;
                        this.chatEnded = true;
                        this.showOptionsMenu = false;
                        this.showChatWindow = false; // Changed back to false to close the window
                        this.showChatBubble = true;  // Changed back to true to show chat bubble
                    }
                });
        } else {
            // If no session ID, just reset the UI state
            this.isSessionEnding = false;
            // If search mode is enabled, return to initial search state
            if (this.isSearchMode) {
                this.resetChatStateForSearchMode();
            } else {
                // Standard end chat behavior - restore original behavior
                this.showEndChatModal = false;
                this.chatEnded = true;
                this.showOptionsMenu = false;
                this.showChatWindow = false; // Changed back to false to close the window
                this.showChatBubble = true;  // Changed back to true to show chat bubble
            }
        }
    }

    // New method to reset chat state for search mode
    resetChatStateForSearchMode() {
        // Clear messages
        this.messages = [];
        this.showEndChatModal = false;
        this.chatEnded = false;
        this.isExpanded = false;
        this.isFirstUserMessage = true;
        this.welcomeMessageAdded = false;
        this.isInitialized = false;
        this.showChatWindow = true;
        this.showChatBubble = false;
        this.showOptionsMenu = false;
        
        // Reset to Light Mode
        if (this.isDarkMode) {
            this.isDarkMode = false;
            const chatWindow = this.template.querySelector('.chat-window');
            if (chatWindow) {
                chatWindow.classList.remove('dark-mode');
            }
        }

        // Generate a new temporary session ID
        this.sessionId = 'session_' + this.generateUUID();
        
        // Initialize a new session
        this.initializeAgentforce(true); // Pass true to indicate search mode
    }

    resetChatState() {
        this.showChatWindow = false;
        this.chatEnded = false;
        this.showChatBubble = true;
        this.sessionId = null;
        this.isInitialized = false;
        this.messages = [];
        this.isFirstThinkingMessage = true;
    }

    startNewChat() {
        console.log('Starting new chat');
        this.showChatWindow = false;
        this.chatEnded = false;
        this.showChatBubble = true;
        this.messages = [];
        this.sessionId = null;
        this.isInitialized = false;
        this.isFirstThinkingMessage = true;
    }

    // ------------------------------
    // Scrolling & Render
    // ------------------------------
    scrollToBottom() {
        setTimeout(() => {
            const chatContainer = this.template.querySelector('.chat-messages');
            if (chatContainer) {
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }
        }, 50);
    }

    // ------------------------------
    // Getters for Template Bindings
    // ------------------------------
    get themeIcon() {
        return 'utility:light_bulb';
    }
    
    get expandIcon() {
        return this.isExpanded ? 'utility:contract' : 'utility:expand';
    }
    
    get voiceIcon() {
        return this.isVoiceMode ? 'utility:chat' : 'utility:unmuted';
    }
    
    get voiceMenuText() {
        return this.isVoiceMode ? 'Switch to Text Mode' : 'Switch to Voice Mode';
    }

    get muteIcon() {
        return this.isMicrophoneMuted ? 'utility:muted' : 'utility:unmuted';
    }

    get muteButtonText() {
        return this.isMicrophoneMuted ? 'Unmute' : 'Mute';
    }

    // Determine when the mute button should be visible
    get showMuteButton() {
        // Hide mute button when agent is speaking or when Agentforce is thinking
        return !this.isSpeaking && !this.voiceStatusText.includes('thinking');
    }
    
    get themeMenuText() {
        return this.isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    }
    
    get expandMenuText() {
        return this.isExpanded ? 'Minimize Chat' : 'Expand Chat';
    }
    
    // Timestamp getter to prevent iframe caching
    get timestamp() {
        return Date.now();
    }
    
    get chatWindowClasses() {
        let classes = 'chat-window';
        
        if (this.isDarkMode) {
            classes += ' dark-mode';
        }
        
        if (this.isExpanded) {
            classes += ' expanded';
        }
        
        if (this.position && !this.isSearchMode) {
            classes += ` position-${this.position}`;
        }
        
        if (this.isSearchMode) {
            classes += ' search-mode';
            
            if (this.isFirstUserMessage) {
                classes += ' first-message';
            }
        }
        
        return classes;
    }
    
    get chatEndedClasses() {
        let classes = 'chat-ended';
        classes += ` position-${this.position}`;
        if (this.isDarkMode) {
            classes += ' dark-mode';
        }
        return classes;
    }
    
    get isInputDisabled() {
        // In search mode, disable input until first Agentforce message comes through
        if (this.isSearchMode && this.isFirstUserMessage && !this.isInitialized) {
            return true;
        }
        return this.isTyping || this.isVoiceMode || this.isTypewriterActive || this.isAgentTyping;
    }
    
    get isSendDisabled() {
        return !this.messageText.trim() || this.isTyping;
    }
    
    get formattedMessages() {
        // In search mode, don't show any messages until first user input
        if (this.isSearchMode && this.isFirstUserMessage) {
            return [];
        }
        
        return this.messages.map(message => {
            const isAgentMessage = message.sender === 'agent';
            // More explicitly check for typing messages
            const isTypingMessage = message.text === 'Agentforce is thinking...' || 
                                  (message.cssClass && message.cssClass.includes('typing')) ||
                                  message.text.includes('thinking');
            
            // Extract thinking process if present (only for non-typing messages)
            if (isAgentMessage && !isTypingMessage && message.text) {
                // Check if content has <think> tags embedded
                const thinkRegex = /<think>([\s\S]*?)<\/think>/;
                const match = message.text.match(thinkRegex);
                
                if (match && match[1]) {
                    // Update thinking process in the actual message array
                    const idx = this.messages.findIndex(m => m.id === message.id);
                    if (idx !== -1 && !this.messages[idx].thinkingProcess) {
                        // Extract thinking process
                        const thinkingProcess = match[1].trim();
                        console.log(`Extracted thinking process for message ${message.id}`);
                        
                        // Remove think tags from display text
                        const displayText = message.text.replace(thinkRegex, '').trim();
                        
                        // Update the actual message in the array
                        this.messages[idx].thinkingProcess = thinkingProcess;
                        
                        // If it's a raw HTML message, keep the sanitized HTML
                        if (this.messages[idx].rawHtml) {
                            this.messages[idx].text = displayText;
                        } else {
                            this.messages[idx].text = displayText;
                        }
                    }
                }
            }
            
            // Debug if message has thinking process
            if (message.thinkingProcess) {
                console.log(`Message ${message.id} has thinking process: ${message.thinkingProcess.substring(0, 50)}...`);
            }
            
            return {
                ...message,
                isAgentMessage,
                isTypingMessage,
                hasThinkingProcess: !!message.thinkingProcess,
                rawHtml: !!message.rawHtml,
                cssClass: message.cssClass || (message.sender === 'user' ? 'message user-message' : 'message bot-message')
            };
        });
    }
    
    // Draggable window functions
    handleHeaderMouseDown(event) {
        if (this.isExpanded) return; // Don't allow dragging when expanded
        
        this.isDragging = true;
        const chatWindow = this.template.querySelector('.chat-window');
        
        // Get current position
        const rect = chatWindow.getBoundingClientRect();
        
        // Record starting points
        this.startX = event.clientX || (event.touches && event.touches[0].clientX);
        this.startY = event.clientY || (event.touches && event.touches[0].clientY);
        
        // Record current window position
        this.lastX = rect.left;
        this.lastY = rect.top;
        
        // Prevent default to avoid text selection during drag
        event.preventDefault();
    }
    
    handleMouseMove(event) {
        if (!this.isDragging) return;
        
        const chatWindow = this.template.querySelector('.chat-window');
        if (!chatWindow) return;
        
        const deltaX = (event.clientX - this.startX);
        const deltaY = (event.clientY - this.startY);
        
        // Calculate new position
        let newX = this.lastX + deltaX;
        let newY = this.lastY + deltaY;
        
        // Apply position with transform for better performance
        chatWindow.style.transform = `translate3d(${newX - this.lastX}px, ${newY - this.lastY}px, 0)`;
        
        event.preventDefault();
    }
    
    handleTouchMove(event) {
        if (!this.isDragging) return;
        
        const touch = event.touches[0];
        if (!touch) return;
        
        const mouseEvent = {
            clientX: touch.clientX,
            clientY: touch.clientY,
            preventDefault: () => event.preventDefault()
        };
        
        this.handleMouseMove(mouseEvent);
        event.preventDefault(); // Prevent scrolling while dragging
    }
    
    handleMouseUp() {
        if (!this.isDragging) return;
        
        this.isDragging = false;
        const chatWindow = this.template.querySelector('.chat-window');
        if (!chatWindow) return;
        
        // Get current transform values
        const transform = chatWindow.style.transform;
        const match = transform.match(/translate3d\((-?\d+(?:\.\d+)?)px, (-?\d+(?:\.\d+)?)px/);
        
        if (match) {
            const deltaX = parseFloat(match[1]);
            const deltaY = parseFloat(match[2]);
            
            // Update fixed position
            chatWindow.style.left = `${this.lastX + deltaX}px`;
            chatWindow.style.top = `${this.lastY + deltaY}px`;
            chatWindow.style.right = 'auto';
            chatWindow.style.bottom = 'auto';
            
            // Reset transform
            chatWindow.style.transform = 'none';
            
            // Remember new position
            this.lastX = this.lastX + deltaX;
            this.lastY = this.lastY + deltaY;
        }
    }
    
    handleTouchEnd() {
        this.handleMouseUp();
    }

    handleToggleVoiceMode() {
        this.toggleVoiceInput();
        this.showOptionsMenu = false;
    }

    // Smooth voice mode activation with transition
    activateVoiceModeWithTransition() {
        // Activate voice mode immediately to prevent flash, but with transition state
        this.stopAudioPlayback(); // Stop any audio first
        this.showOptionsMenu = false;
        this.isVoiceModeTransitioning = true;
        this.isVoiceMode = true; // Show overlay immediately
        this.isListening = false; // Not listening while thinking
        this.isSpeaking = false;
        this.isMicrophoneMuted = true; // Auto-mute during thinking
        this.voiceStatusText = 'Agentforce is thinking...';
        
        // Reset transition state after animation completes
        setTimeout(() => {
            this.isVoiceModeTransitioning = false;
        }, 500); // Match CSS animation duration
    }

    handleToggleMicrophone() {
        this.isMicrophoneMuted = !this.isMicrophoneMuted;
        
        if (this.isMicrophoneMuted) {
            // Mute: stop listening and stop voice recognition
            this.stopVoiceRecognition();
            this.isListening = false;
            this.isActivelySpeaking = false;
            this.voiceStatusText = 'Microphone muted';
        } else {
            // Unmute: restart voice recognition if not speaking
            if (!this.isSpeaking) {
                this.isListening = true;
                this.isActivelySpeaking = false;
                this.voiceStatusText = 'Listening to you...';
                this.startVoiceRecognition();
            }
        }
    }

    showEndChatConfirmation() {
        // Stop any audio playback when showing end chat dialog
        this.stopAudioPlayback();
        
        this.showEndChatModal = true;
        this.showOptionsMenu = false;
    }
    
    cancelEndChat() {
        this.showEndChatModal = false;
    }

    stopVoiceRecognition() {
        // Clear any pending voice pause timer
        if (this.voicePauseTimer) {
            clearTimeout(this.voicePauseTimer);
            this.voicePauseTimer = null;
        }
        
        // Clear active speaking timer
        if (this.activeSpeakingTimer) {
            clearTimeout(this.activeSpeakingTimer);
            this.activeSpeakingTimer = null;
        }
        
        this.lastTranscript = '';
        this.isActivelySpeaking = false; // Reset active speaking flag
        
        if (this.recognition) {
            try { 
                this.recognition.stop(); 
            } catch (e) { 
                console.error('Error stopping voice recognition:', e); 
            }
        }
        this.stopVisualizerAnimation();
    }

    toggleThinkingProcess(event) {
        try {
            const messageId = event.currentTarget.dataset.id;
            console.log('Toggling thinking process for message ID:', messageId);
            
            // Toggle the expanded class on the icon
            const iconElement = event.currentTarget.querySelector('.thinking-toggle-icon');
            if (iconElement) {
                iconElement.classList.toggle('expanded');
            }
            
            // Toggle the display of the thinking process content
            const contentElement = this.template.querySelector(`.thinking-process-content[data-id="${messageId}"]`);
            if (contentElement) {
                contentElement.classList.toggle('expanded');
                console.log('Toggled thinking process visibility');
            } else {
                console.warn('Thinking process content element not found for ID:', messageId);
            }
        } catch (error) {
            console.error('Error toggling thinking process:', error);
        }
    }

    // Add getter for voice status class
    get voiceStatusClass() {
        if (this.voiceStatusText.includes('thinking')) {
            return 'voice-status-text shimmer-text';
        }
        return 'voice-status-text';
    }

    // Add getter for voice pulse circle class with dynamic states
    get voicePulseCircleClass() {
        let baseClass = 'voice-pulse-circle';
        
        if (this.isSpeaking) {
            return baseClass + ' speaking';
        } else if (this.isListening) {
            // Add 'active' class when user is actively speaking into microphone
            if (this.isActivelySpeaking) {
                return baseClass + ' listening active';
            }
            return baseClass + ' listening';
        } else if (this.voiceStatusText.includes('thinking')) {
            return baseClass + ' thinking';
        }
        
        return baseClass;
    }

    // Add getter for voice mode overlay class with transition state
    get voiceModeOverlayClass() {
        let baseClass = 'voice-mode-overlay';
        if (this.isVoiceModeTransitioning) {
            return baseClass + ' transitioning';
        }
        return baseClass;
    }

    // Voice mode should be shown in Experience Cloud or when explicitly enabled
    get showVoiceModeOption() {
        // Allow voice mode in both regular mode and search mode
        return this.allowVoiceMode || this.isEmbedded;
    }

    // Add simulateTyping method that properly preserves message history
    simulateTyping(text) {
        // Don't do anything if we're already typing or no text is provided
        if (this.isTyping || !text) return;
        
        // Set typing state
        this.isTyping = true;
        
        // Add a bot message using the existing method to ensure message history is preserved
        setTimeout(() => {
            this.isTyping = false;
            this.addBotMessage(text);
        }, 1000);
    }

    // Helper method to add a message to the conversation
    addMessageToConversation(text, sender = 'agent', id = null) {
        const messageId = id || `msg_${Date.now()}`;
        
        // Create the message object
        const messageObj = {
            id: messageId,
            text: text || '',
            sender: sender,
            cssClass: sender === 'user' ? 'message user-message' : 
                     sender === 'agent' ? 'message bot-message' : 
                     'message system-message',
            timestamp: this.getTimestamp()
        };
        
        // Add to messages array
        this.messages = [...this.messages, messageObj];
        
        // Scroll to bottom
        setTimeout(() => { this.scrollToBottom(); }, 50);
        
        return messageObj;
    }

    // Set default values for Experience Cloud
    get isEmbedded() {
        // Check if we're in Experience Cloud by looking at the URL
        const url = window.location.href;
        return url.includes('/s/') || url.includes('/community/');
    }

    // Helper to make links in text clickable
    makeLinksClickable(element) {
        try {
            // Find all links that aren't already in <a> tags
            const urlRegex = /(https?:\/\/[^\s<]+)/g;
            const childNodes = [...element.childNodes];
            
            childNodes.forEach(node => {
                if (node.nodeType === 3) { // Text node
                    const text = node.textContent;
                    if (urlRegex.test(text)) {
                        const fragment = document.createDocumentFragment();
                        let lastIndex = 0;
                        let match;
                        
                        // Reset regex
                        urlRegex.lastIndex = 0;
                        
                        while ((match = urlRegex.exec(text)) !== null) {
                            // Add text before the link
                            if (match.index > lastIndex) {
                                fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
                            }
                            
                            // Create link
                            const link = document.createElement('a');
                            link.href = match[0];
                            link.textContent = match[0];
                            link.target = '_blank';
                            link.rel = 'noopener noreferrer';
                            link.style.color = '#0076d3';
                            link.style.textDecoration = 'underline';
                            fragment.appendChild(link);
                            
                            lastIndex = match.index + match[0].length;
                        }
                        
                        // Add text after the last link
                        if (lastIndex < text.length) {
                            fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
                        }
                        
                        // Replace the text node with the fragment
                        node.parentNode.replaceChild(fragment, node);
                    }
                } else if (node.nodeType === 1) { // Element node
                    // Recursively process child elements
                    this.makeLinksClickable(node);
                }
            });
        } catch (e) {
            console.error('Error making links clickable:', e);
        }
    }

    // Update the renderedCallback method to properly handle rendering
    renderedCallback() {
        // Set the theme color CSS variable
        if (this.template.host) {
            this.template.host.style.setProperty('--messengerChatThemeColor', this.themeColor);
        }
        
        // Handle the DOM manipulation for HTML content in agent messages
        this.renderAgentMessages();
        
        // Setup voice visualizer if needed
        this.setupVoiceVisualizerIfNeeded();
        
        // Handle scrolling if needed
        if (this.shouldScrollToBottom) {
            this.scrollToBottom();
            this.shouldScrollToBottom = false;
        }
    }

    // Update method to render agent messages that contain HTML
    renderAgentMessages() {
        this.formattedMessages.forEach(message => {
            if (message.isAgentMessage && !message.isTypingMessage) {
                if (message.rawHtml) {
                    const container = this.template.querySelector(`.message[data-id="${message.id}"] div.lwc-manual-render`);
                    if (container) {
                        // Set the HTML content directly
                        container.innerHTML = message.text || '';
                        
                        // Make links clickable and adjust styling for HTML elements
                        this.enhanceHtmlContent(container);
                        
                        // Force color for better visibility in both light and dark modes
                        const textElements = container.querySelectorAll('p, div, span, h1, h2, h3, h4, h5, h6, li');
                        textElements.forEach(el => {
                            // Set inline styles for immediate effect
                            if (this.isDarkMode) {
                                el.style.color = '#f0f0f0';
                            } else {
                                el.style.color = 'black';
                            }
                        });
                        
                        console.log(`Rendered HTML for message: ${message.id}`);
                    } else {
                        console.warn(`HTML container not found for message: ${message.id}`);
                    }
                } else {
                    // For regular text messages, ensure paragraphs have proper styling
                    const messageContainer = this.template.querySelector(`.message[data-id="${message.id}"] .message-content p`);
                    if (messageContainer) {
                        // Set inline styles for immediate effect
                        if (this.isDarkMode) {
                            messageContainer.style.color = '#f0f0f0';
                        } else {
                            messageContainer.style.color = 'black';
                        }
                    }
                }
            }
        });
    }

    // Method to enhance HTML content with proper styling and functionality
    enhanceHtmlContent(container) {
        // Make links open in new tab and add security attributes
        const links = container.querySelectorAll('a');
        links.forEach(link => {
            link.setAttribute('target', '_blank');
            link.setAttribute('rel', 'noopener noreferrer');
        });
        
        // Add list styling for UL and OL elements
        const lists = container.querySelectorAll('ul, ol');
        lists.forEach(list => {
            list.style.paddingLeft = '20px';
            if (list.tagName === 'UL') {
                list.style.listStyleType = 'disc';
            } else {
                list.style.listStyleType = 'decimal';
            }
        });
        
        // Add proper styling for other HTML elements as needed
        const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
        headings.forEach(heading => {
            heading.style.fontWeight = 'bold';
            heading.style.margin = '10px 0';
        });
    }

    // Add this method to safely render HTML content
    sanitizeAndRenderHTML(htmlContent) {
        // Create a DOMParser to sanitize the HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, 'text/html');
        
        // Return the sanitized HTML as a string
        return doc.body.innerHTML;
    }

    // Add a function to stop any audio playback
    stopAudioPlayback() {
        // Cancel any Web Speech API synthesis
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
        
        // Force stop all audio elements
        try {
            // Find and destroy any playing audio elements
            const audioElements = document.querySelectorAll('audio');
            audioElements.forEach(audio => {
                try {
                    // First try to pause and reset
                    audio.pause();
                    audio.currentTime = 0;
                    
                    // Then clear source and remove all event listeners
                    audio.removeAttribute('src');
                    audio.srcObject = null;
                    audio.load();
                } catch (e) {
                    console.error('Error force-stopping audio:', e);
                }
            });
            
            // Clear any stored audio reference
            if (this.currentAudio) {
                try {
                    this.currentAudio.pause();
                    this.currentAudio = null;
                } catch (e) {
                    console.error('Error clearing audio reference:', e);
                }
            }
        } catch (err) {
            console.error('Error stopping audio:', err);
        }
        
        // Reset voice state if needed
        if (this.isSpeaking) {
            this.isSpeaking = false;
            this.isListening = true;
            if (this.isVoiceMode) {
                this.voiceStatusText = 'Listening to you...';
            }
        }
    }

    // Add handler for the Continue Speaking button
    handleContinueSpeaking() {
        // Immediately stop all audio playback
        
        // 1. Cancel Web Speech API synthesis
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
        
        // 2. Force stop all audio elements by removing them from DOM
        try {
            // Find and destroy any playing audio elements
            const audioElements = document.querySelectorAll('audio');
            audioElements.forEach(audio => {
                try {
                    // First try to pause and reset
                    audio.pause();
                    audio.currentTime = 0;
                    
                    // Then clear source and remove all event listeners
                    audio.removeAttribute('src');
                    audio.srcObject = null;
                    audio.load();
                    
                    // Finally, try to remove from DOM if possible
                    if (audio.parentNode) {
                        audio.parentNode.removeChild(audio);
                    }
                } catch (e) {
                    console.error('Error force-stopping audio:', e);
                }
            });
            
            // 3. Stop any Murf.ai audio specifically
            const audioTags = document.getElementsByTagName('audio');
            for (let i = 0; i < audioTags.length; i++) {
                try {
                    audioTags[i].pause();
                    audioTags[i].remove();
                } catch (err) {
                    console.error('Error removing audio tag:', err);
                }
            }
        } catch (err) {
            console.error('Error stopping audio:', err);
        }
        
        // 4. Reset voice state immediately
        this.isSpeaking = false;
        
        // Only restart listening if microphone is not manually muted
        if (!this.isMicrophoneMuted) {
            this.isListening = true;
            this.voiceStatusText = 'Listening to you...';
        } else {
            this.voiceStatusText = 'Microphone muted';
        }
        
        // 5. Clear any internal audio references
        if (this.currentAudio) {
            try {
                this.currentAudio.pause();
                this.currentAudio = null;
            } catch (e) {
                console.error('Error clearing audio reference:', e);
            }
        }
        
        // 6. Start voice recognition after a short delay (only if not muted)
        if (!this.isMicrophoneMuted) {
            setTimeout(() => {
                if (this.recognition) {
                    try {
                        this.recognition.abort();
                    } catch (e) {
                        console.error('Error aborting recognition:', e);
                    }
                }
                
                // Start fresh recognition
                if (this.isVoiceMode) {
                    setTimeout(() => this.startVoiceRecognition(), 200);
                }
            }, 100);
        }
    }

    get showExpandOption() {
        // In search mode, show expand option after first user message
        if (this.isSearchMode) {
            return !this.isFirstUserMessage;
        }
        
        return true;
    }

    // Add this getter method to display the welcome message in search mode
    get showSearchModeWelcome() {
        return this.isSearchMode && this.isFirstUserMessage;
    }

    // Add this getter method to provide the placeholder text for the search input
    get searchInputPlaceholder() {
        if (this.isSearchMode && this.isFirstUserMessage) {
            // Show "Initializing..." when input is disabled during first load
            if (!this.isInitialized) {
                return "Initializing Agentforce...";
            }
            return "Chat with Agentforce";
        }
        return "Send a Message to Agentforce";
    }



    // Update the chatWindowStyle getter
    get chatWindowStyle() {
        // Don't apply gradient directly to the window
        return '';
    }

    // Add showMinimizeOption getter
    get showMinimizeOption() {
        // Never show minimize to bubble in search mode
        if (this.isSearchMode) {
            return false;
        }
        
        return true;
    }

    // Add minimizeMenuText getter
    get minimizeMenuText() {
        return 'Close Chat Window';
    }

    // Add this getter to apply custom theme color to the header
    get headerStyle() {
        return `background-color: ${this.themeColor} !important;`;
    }

    // Add this getter to apply custom theme color to user messages
    get userMessageStyle() {
        return `background-color: ${this.themeColor} !important;`;
    }

    // Add this getter to apply custom theme color to the chat bubble
    get chatBubbleStyle() {
        return `background-color: ${this.themeColor} !important;`;
    }

    // Add the setupVoiceVisualizerIfNeeded method
    setupVoiceVisualizerIfNeeded() {
        // This method is a placeholder for voice visualizer initialization
        // We're keeping it to maintain the structure of the renderedCallback
    }

    // Add or update the renderHtmlContent method
    renderHtmlContent() {
        // Handle the DOM manipulation for HTML content in agent messages
        const htmlElements = this.template.querySelectorAll('.lwc-manual-render');
        if (htmlElements && htmlElements.length > 0) {
            htmlElements.forEach(element => {
                const messageId = element.dataset.id;
                const message = this.messages.find(m => m.id === messageId);
                if (message && message.rawHtml && !element.hasChildNodes()) {
                    element.innerHTML = message.rawHtml;
                }
            });
        }
        
        // Handle scrolling to bottom if needed
        if (this.shouldScrollToBottom) {
            this.scrollToBottom();
            this.shouldScrollToBottom = false;
        }
    }

}