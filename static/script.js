let authToken = null;
let currentUser = null;
let currentChannelId = null;
let currentThreadParentId = null;
let baseUrl = window.location.origin;


let messagePollInterval = null;
let unreadPollInterval = null;


const loginContainer = document.getElementById('login-container');
const registerContainer = document.getElementById('register-container');
const mainContainer = document.getElementById('main-container');

const loginUsernameInput = document.getElementById('login-username');
const loginPasswordInput = document.getElementById('login-password');
const loginButton = document.getElementById('login-button');
const registerLink = document.getElementById('register-link');
const registerButton = document.getElementById('register-button');
const registerUsernameInput = document.getElementById('reg-username');
const registerPasswordInput = document.getElementById('reg-password');
const loginLink = document.getElementById('login-link');

const channelsList = document.getElementById('channels');
const createChannelButton = document.getElementById('create-channel');
const channelNameHeader = document.getElementById('channel-name');
const messagesView = document.getElementById('messages');
const newMessageInput = document.getElementById('new-message');
const sendMessageButton = document.getElementById('send-message');

const threadView = document.getElementById('thread-view');
const threadParentMessage = document.getElementById('thread-parent-message');
const threadMessages = document.getElementById('thread-messages');
const newReplyInput = document.getElementById('new-reply');
const sendReplyButton = document.getElementById('send-reply');
const closeThreadButton = document.getElementById('close-thread');

const profileActions = document.getElementById('profile-actions');
const updateUsernameButton = document.getElementById('update-username-button');
const updatePasswordButton = document.getElementById('update-password-button');
const logoutButton = document.getElementById('logout-button');
const newUsernameInput = document.getElementById('new-username');
const newPasswordInput = document.getElementById('new-password');

const topNav = document.getElementById('top-nav');
const showChannelsButton = document.getElementById('show-channels');
const showProfileMenuButton = document.getElementById('show-profile-menu');
const currentChannelNameEl = document.getElementById('current-channel-name');

const STORAGE_AUTH_KEY = 'karine_belay_auth_key';

// Restore session if exists
authToken = window.localStorage.getItem(STORAGE_AUTH_KEY);
if (authToken) {
    showMainApp();
} else {
    showLogin();
}


loginButton.addEventListener('click', doLogin);
registerButton.addEventListener('click', doRegister);
registerLink.addEventListener('click', (e) => {
    e.preventDefault();
    showRegister();
});
loginLink.addEventListener('click', (e) => {
    e.preventDefault();
    showLogin();
});
createChannelButton.addEventListener('click', createChannelPrompt);
sendMessageButton.addEventListener('click', sendMessage);
sendReplyButton.addEventListener('click', sendReply);
closeThreadButton.addEventListener('click', closeThread);

updateUsernameButton.addEventListener('click', updateUsername);
updatePasswordButton.addEventListener('click', updatePassword);
logoutButton.addEventListener('click', logout);


showChannelsButton.addEventListener('click', showChannelsPanel);
showProfileMenuButton.addEventListener('click', toggleProfileMenu);


window.addEventListener('popstate', handlePopState);



function showLogin() {
    loginContainer.classList.remove('hidden');
    registerContainer.classList.add('hidden');
    mainContainer.classList.add('hidden');
    stopPolling();
    currentChannelId = null;
    currentThreadParentId = null;
}

function showRegister() {
    loginContainer.classList.add('hidden');
    registerContainer.classList.remove('hidden');
    mainContainer.classList.add('hidden');
    stopPolling();
}

function showMainApp() {
    loginContainer.classList.add('hidden');
    registerContainer.classList.add('hidden');
    mainContainer.classList.remove('hidden');
    fetchChannels();
    startUnreadPolling();
    handleInitialRoute();
}

function handleInitialRoute() {
    // If URL contains /channel/:id or /thread/:parent_id
    const path = window.location.pathname;
    if (path.startsWith('/thread/')) {
        const parentId = path.split('/thread/')[1];
        openThread(parentId);
    } else if (path.startsWith('/channel/')) {
        const channelId = path.split('/channel/')[1];
        openChannel(channelId);
    } else {
        // Show default UI (channel list)
        // On wide screen: show channel list and empty state
        // On narrow: just channel list
        renderMessages([]);
    }
}

function doLogin() {
    const username = loginUsernameInput.value.trim();
    const password = loginPasswordInput.value;
    if (!username || !password) {
        alert("Please enter username and password");
        return;
    }
    fetchJSON('/api/auth/login', 'POST', {username, password})
    .then(res => {
        if (res.error) {
            alert(res.error);
            return;
        }
        authToken = res.token;
        window.localStorage.setItem(STORAGE_AUTH_KEY, authToken);
        showMainApp();
    })
    .catch(err => {
        console.error(err);
        alert("Login failed");
    });
}

function doRegister() {
    const username = registerUsernameInput.value.trim();
    const password = registerPasswordInput.value;
    if (!username || !password) {
        alert("Please enter username and password");
        return;
    }
    fetchJSON('/api/auth/register', 'POST', {username, password})
    .then(res => {
        if (res.error) {
            alert(res.error);
            return;
        }
        // Successfully registered, go to login
        alert("Registration successful! Please login.");
        showLogin();
    })
    .catch(err => {
        console.error(err);
        alert("Registration failed");
    });
}

function logout() {
    fetchJSON('/api/auth/logout', 'POST', {})
    .then(res => {
        authToken = null;
        window.localStorage.removeItem(STORAGE_AUTH_KEY);
        showLogin();
    })
    .catch(err => {
        console.error(err);
        authToken = null;
        window.localStorage.removeItem(STORAGE_AUTH_KEY);
        showLogin();
    });
}

function fetchChannels() {
    fetchJSON('/api/channels', 'GET')
    .then(channels => {
        renderChannels(channels);
    })
    .catch(err => console.error(err));
}

function renderChannels(channels) {
    channelsList.innerHTML = '';
    channels.forEach(ch => {
        const li = document.createElement('li');
        li.textContent = `${ch.name} ${ch.unread_count > 0 ? '(' + ch.unread_count + ')' : ''}`;
        li.addEventListener('click', () => {
            openChannel(ch.id);
        });
        if (currentChannelId == ch.id) {
            li.classList.add('selected');
        }
        channelsList.appendChild(li);
    });
}

function createChannelPrompt() {
    const name = prompt("Enter channel name:");
    if (!name) return;
    fetchJSON('/api/channels', 'POST', {name})
    .then(res => {
        if (res.error) {
            alert(res.error);
            return;
        }
        fetchChannels();
    })
    .catch(err => console.error(err));
}

function openChannel(channelId) {
    currentChannelId = channelId;
    currentThreadParentId = null;
    stopMessagePolling();
    fetchJSON('/api/messages?channel_id=' + encodeURIComponent(channelId), 'GET')
    .then(messages => {
        renderMessages(messages);
        // Update URL & History
        const url = '/channel/' + channelId;
        window.history.pushState({view: 'channel', channel_id: channelId}, '', url);
        channelNameHeader.textContent = getChannelNameFromList(channelId);
        currentChannelNameEl.textContent = getChannelNameFromList(channelId);
        startMessagePolling(channelId);
    })
    .catch(err => console.error(err));
}

function getChannelNameFromList(channelId) {
    const lis = channelsList.querySelectorAll('li');
    for (let li of lis) {
        if (li.classList.contains('selected')) li.classList.remove('selected');
    }
    for (let li of lis) {
        if (li.textContent.startsWith(getChannelNameFromLi(li))) {
            // attempt to parse channel name from the li text
        }
    }
    return channelNameHeader.textContent; // fallback if not found
}

let lastChannelsFetched = [];
function renderChannels(channels) {
    lastChannelsFetched = channels;
    channelsList.innerHTML = '';
    channels.forEach(ch => {
        const li = document.createElement('li');
        li.textContent = ch.name + (ch.unread_count > 0 ? ' (' + ch.unread_count + ')' : '');
        li.addEventListener('click', () => {
            openChannel(ch.id);
        });
        if (currentChannelId == ch.id) {
            li.classList.add('selected');
        }
        channelsList.appendChild(li);
    });
}

function getChannelNameFromList(channelId) {
    const ch = lastChannelsFetched.find(c => c.id == channelId);
    return ch ? ch.name : "Select a Channel";
}

function renderMessages(messages) {
    messagesView.innerHTML = '';
    messages.forEach(m => {
        const msgDiv = renderSingleMessage(m);
        messagesView.appendChild(msgDiv);
    });
}

function renderSingleMessage(m) {
    const div = document.createElement('div');
    div.classList.add('message');
    const header = document.createElement('div');
    const userSpan = document.createElement('span');
    userSpan.classList.add('username');
    userSpan.textContent = m.username;

    const timeSpan = document.createElement('span');
    timeSpan.classList.add('timestamp');
    timeSpan.textContent = ' ' + new Date(m.timestamp).toLocaleTimeString();

    header.appendChild(userSpan);
    header.appendChild(timeSpan);

    const contentDiv = document.createElement('div');
    contentDiv.classList.add('content');
    contentDiv.innerHTML = parseMessageContent(m.content);

    div.appendChild(header);
    div.appendChild(contentDiv);

    if (m.reply_count && m.reply_count > 0) {
        const replyCountDiv = document.createElement('div');
        replyCountDiv.classList.add('reply-count');
        replyCountDiv.textContent = `${m.reply_count} repl${m.reply_count > 1 ? 'ies' : 'y'}`;
        replyCountDiv.addEventListener('click', () => {
            openThread(m.id);
        });
        div.appendChild(replyCountDiv);
    } else {
        // Even if no replies, add a "reply" button
        const replyButton = document.createElement('div');
        replyButton.classList.add('reply-count');
        replyButton.textContent = 'Reply';
        replyButton.addEventListener('click', () => {
            openThread(m.id);
        });
        div.appendChild(replyButton);
    }


    if (m.reactions && Object.keys(m.reactions).length > 0) {
        const reactionsDiv = document.createElement('div');
        reactionsDiv.classList.add('reactions');
        for (let emoji in m.reactions) {
            const reactionDiv = document.createElement('span');
            reactionDiv.classList.add('reaction');
            reactionDiv.textContent = emoji + ' ' + m.reactions[emoji].length;
            // Tooltip with users
            const tooltip = document.createElement('div');
            tooltip.classList.add('reaction-tooltip');
            tooltip.textContent = "Reacted by: " + m.reactions[emoji].join(', ');
            reactionDiv.appendChild(tooltip);
            reactionDiv.addEventListener('click', () => {
                addReaction(m.id, emoji);
            });
            reactionsDiv.appendChild(reactionDiv);
        }
        div.appendChild(reactionsDiv);
    }


    const addReactionDiv = document.createElement('div');
    addReactionDiv.classList.add('reactions');
    const addReactionBtn = document.createElement('button');
    addReactionBtn.textContent = 'Add Reaction';
    addReactionBtn.addEventListener('click', () => {
        const emoji = prompt("Enter an emoji:");
        if (emoji) {
            addReaction(m.id, emoji);
        }
    });
    addReactionDiv.appendChild(addReactionBtn);
    div.appendChild(addReactionDiv);

    return div;
}

function parseMessageContent(content) {
    // Parse image URLs: if content contains a URL ending in .png, .jpg, .jpeg, .gif, etc. show image
    const urlPattern = /(https?:\/\/[^\s]+(\.png|\.jpg|\.jpeg|\.gif))/gi;
    let replaced = content.replace(urlPattern, (url) => {
        return `<a href="${url}" target="_blank">${url}</a><br><img src="${url}" alt="Image" style="max-width:200px; display:block; margin-top:5px;">`;
    });
    return replaced;
}

function sendMessage() {
    const content = newMessageInput.value.trim();
    if (!content) return;
    if (!currentChannelId) {
        alert("Select a channel first");
        return;
    }
    fetchJSON('/api/messages', 'POST', {channel_id: currentChannelId, content})
    .then(res => {
        if (res.error) {
            alert(res.error);
            return;
        }
        newMessageInput.value = '';
        // Refresh messages immediately
        fetchChannelMessages(currentChannelId);
    })
    .catch(err => console.error(err));
}

function fetchChannelMessages(channelId) {
    fetchJSON('/api/messages?channel_id=' + encodeURIComponent(channelId), 'GET')
    .then(messages => {
        renderMessages(messages);
    })
    .catch(err => console.error(err));
}

function openThread(parentId) {
    currentThreadParentId = parentId;
    stopMessagePolling();
    fetchJSON('/api/messages/thread?parent_id=' + encodeURIComponent(parentId), 'GET')
    .then(res => {
        renderThread(res);
        const url = '/thread/' + parentId;
        window.history.pushState({view:'thread', parent_id: parentId}, '', url);

        showThreadPanel();
    })
    .catch(err => console.error(err));
}

function renderThread(data) {
    // data: {parent: {...}, replies: [...]}
    threadParentMessage.innerHTML = '';
    threadMessages.innerHTML = '';

    const parentDiv = renderSingleThreadMessage(data.parent);
    threadParentMessage.appendChild(parentDiv);

    data.replies.forEach(r => {
        const replyDiv = renderSingleThreadMessage(r);
        threadMessages.appendChild(replyDiv);
    });
}

function renderSingleThreadMessage(m) {
    const div = document.createElement('div');
    div.classList.add('message');
    const header = document.createElement('div');
    const userSpan = document.createElement('span');
    userSpan.classList.add('username');
    userSpan.textContent = m.username;

    const timeSpan = document.createElement('span');
    timeSpan.classList.add('timestamp');
    timeSpan.textContent = ' ' + new Date(m.timestamp).toLocaleTimeString();

    header.appendChild(userSpan);
    header.appendChild(timeSpan);

    const contentDiv = document.createElement('div');
    contentDiv.classList.add('content');
    contentDiv.innerHTML = parseMessageContent(m.content);

    div.appendChild(header);
    div.appendChild(contentDiv);


    if (m.reactions && Object.keys(m.reactions).length > 0) {
        const reactionsDiv = document.createElement('div');
        reactionsDiv.classList.add('reactions');
        for (let emoji in m.reactions) {
            const reactionDiv = document.createElement('span');
            reactionDiv.classList.add('reaction');
            reactionDiv.textContent = emoji + ' ' + m.reactions[emoji].length;
            const tooltip = document.createElement('div');
            tooltip.classList.add('reaction-tooltip');
            tooltip.textContent = "Reacted by: " + m.reactions[emoji].join(', ');
            reactionDiv.appendChild(tooltip);
            reactionDiv.addEventListener('click', () => {
                addReaction(m.id, emoji);
            });
            reactionsDiv.appendChild(reactionDiv);
        }
        div.appendChild(reactionsDiv);
    }


    const addReactionDiv = document.createElement('div');
    addReactionDiv.classList.add('reactions');
    const addReactionBtn = document.createElement('button');
    addReactionBtn.textContent = 'Add Reaction';
    addReactionBtn.addEventListener('click', () => {
        const emoji = prompt("Enter an emoji:");
        if (emoji) {
            addReaction(m.id, emoji, true);
        }
    });
    addReactionDiv.appendChild(addReactionBtn);
    div.appendChild(addReactionDiv);

    return div;
}

function sendReply() {
    const content = newReplyInput.value.trim();
    if (!content) return;
    if (!currentThreadParentId) {
        alert("No thread open");
        return;
    }
    // Need channel_id from parent message fetch from before
    // Store parent message's channel_id in data.parent
    fetchJSON('/api/messages/thread?parent_id=' + encodeURIComponent(currentThreadParentId), 'GET')
    .then(res => {
        const channelId = res.parent.channel_id;
        return fetchJSON('/api/messages', 'POST', {channel_id: channelId, content, replies_to: currentThreadParentId});
    })
    .then(res => {
        if (res.error) {
            alert(res.error);
            return;
        }
        newReplyInput.value = '';
        // Refresh thread
        openThread(currentThreadParentId);
    })
    .catch(err => console.error(err));
}

function closeThread() {
    threadView.classList.add('hidden');
    currentThreadParentId = null;
    // Go back to channel view
    if (currentChannelId) {
        const url = '/channel/' + currentChannelId;
        window.history.pushState({view: 'channel', channel_id: currentChannelId}, '', url);
        startMessagePolling(currentChannelId);
    } else {
        const url = '/';
        window.history.pushState({}, '', url);
    }
}

// Reactions
function addReaction(messageId, emoji, isThread = false) {
    fetchJSON('/api/reactions', 'POST', {message_id: messageId, emoji})
    .then(res => {
        if (res.error) {
            alert(res.error);
            return;
        }
        if (isThread) {
            openThread(currentThreadParentId);
        } else {
            fetchChannelMessages(currentChannelId);
        }
    })
    .catch(err => console.error(err));
}

// Profile updates
function updateUsername() {
    const new_username = newUsernameInput.value.trim();
    if (!new_username) return;
    fetchJSON('/api/users/update_username', 'POST', {new_username})
    .then(res => {
        if (res.error) {
            alert(res.error);
            return;
        }
        alert("Username updated");
        fetchChannels();
    })
    .catch(err => console.error(err));
}

function updatePassword() {
    const new_password = newPasswordInput.value;
    if (!new_password) return;
    fetchJSON('/api/users/update_password', 'POST', {new_password})
    .then(res => {
        if (res.error) {
            alert(res.error);
            return;
        }
        alert("Password updated");
    })
    .catch(err => console.error(err));
}



function startMessagePolling(channelId) {
    stopMessagePolling();
    messagePollInterval = setInterval(() => {
        if (currentChannelId === channelId && !currentThreadParentId) {
            // Only if we're still on the same channel and not in a thread
            fetchChannelMessages(channelId);
        }
    }, 500); // every 500ms
}

function stopMessagePolling() {
    if (messagePollInterval) {
        clearInterval(messagePollInterval);
        messagePollInterval = null;
    }
}

function startUnreadPolling() {
    stopUnreadPolling();
    unreadPollInterval = setInterval(() => {
        fetchUnreadCounts();
    }, 1000); // every second
}

function stopUnreadPolling() {
    if (unreadPollInterval) {
        clearInterval(unreadPollInterval);
        unreadPollInterval = null;
    }
}

function stopPolling() {
    stopMessagePolling();
    stopUnreadPolling();
}

function fetchUnreadCounts() {
    if (!authToken) return;
    fetchJSON('/api/unread', 'GET')
    .then(unread => {
        // Update channels list unread counts
        for (let i = 0; i < channelsList.children.length; i++) {
            const li = channelsList.children[i];
            const name = getChannelNameFromLi(li);
            const ch = lastChannelsFetched.find(c => c.name == name);
            if (ch) {
                const count = unread[ch.id] || 0;
                li.textContent = ch.name + (count > 0 ? ' (' + count + ')' : '');
                if (ch.id === currentChannelId) {
                    li.classList.add('selected');
                }
            }
        }
    })
    .catch(err => console.error(err));
}

function getChannelNameFromLi(li) {
    // Given "channelName (3)"
    // Can split by '('
    return li.textContent.split(' (')[0].trim();
}


function handlePopState(e) {
    const state = e.state;
    if (!state) {
        currentChannelId = null;
        currentThreadParentId = null;
        closeThread();
        renderMessages([]);
        const url = '/';
        window.history.replaceState({}, '', url);
        return;
    }

    if (state.view === 'channel') {
        openChannel(state.channel_id);
    } else if (state.view === 'thread') {
        openThread(state.parent_id);
    } else {
        currentChannelId = null;
        currentThreadParentId = null;
        closeThread();
        renderMessages([]);
    }
}


function fetchJSON(url, method='GET', data=null) {
    const headers = {'Content-Type': 'application/json'};
    if (authToken) {
        headers['Authorization'] = 'Bearer ' + authToken;
    }
    return fetch(url, {
        method,
        headers,
        body: data ? JSON.stringify(data) : null
    }).then(r => r.json());
}


function showChannelsPanel() {
    // On narrow screens, show/hide the channels list
    const cl = document.getElementById('channels-list');
    if (cl.classList.contains('show')) {
        cl.classList.remove('show');
    } else {
        cl.classList.add('show');
    }
}

function toggleProfileMenu() {
    if (profileActions.style.display === 'block') {
        profileActions.style.display = 'none';
    } else {
        profileActions.style.display = 'block';
    }
}

function showThreadPanel() {
    threadView.classList.remove('hidden');
    if (window.innerWidth <= 800) {
        threadView.classList.add('show');
    }
}

function closeThread() {
    threadView.classList.add('hidden');
    threadView.classList.remove('show');
    currentThreadParentId = null;
    if (currentChannelId) {
        const url = '/channel/' + currentChannelId;
        window.history.pushState({view:'channel', channel_id:currentChannelId}, '', url);
        startMessagePolling(currentChannelId);
    } else {
        const url = '/';
        window.history.pushState({}, '', url);
    }
}
