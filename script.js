// Migration des anciennes clés vers Infinity sans perdre les conversations existantes.
(function migrateInfinityStorage() {
  const keys = ['convs', 'current', 'settings', 'terms'];
  keys.forEach(key => {
    const oldKey = '\u0061urx_' + key;
    const newKey = 'infinity_' + key;
    try {
      if (localStorage.getItem(newKey) === null && localStorage.getItem(oldKey) !== null) {
        localStorage.setItem(newKey, localStorage.getItem(oldKey));
      }
      localStorage.removeItem(oldKey);
    } catch (error) {
      console.warn('Migration du stockage Infinity impossible:', error);
    }
  });
})();

// Réutilise la configuration du projet si config.js en fournit déjà une.
window.infinity_CONFIG = window.infinity_CONFIG || (
  typeof CONFIG !== 'undefined' ? CONFIG : {
    ACTIVE_API: 'openai',
    ENDPOINTS: { openai: 'https://aur-x-backend.vercel.app/api/chat' },
    MODELS: { openai: 'gpt-4o-mini' }
  }
);

// Variables globales d'authentification et de conversations
let isLoggedIn = false;
let serverConversations = [];
let conversations = JSON.parse(localStorage.getItem('infinity_convs') || '[]');
let currentConvId = localStorage.getItem('infinity_current') || null;
let settings = JSON.parse(localStorage.getItem('infinity_settings') || '{"anim":true,"autosave":true,"timestamp":true,"notif":true}');
let messageCounter = 0;

// La vérification de session est terminée avant l'initialisation de l'interface.
const loginReady = checkLogin();

async function checkLogin() {
  try {
    const res = await fetch('https://aur-x-backend.vercel.app/api/history', {
      credentials: 'include'
    });
    if (!res.ok) throw new Error('No session');

    const data = await res.json();
    isLoggedIn = true;
    serverConversations = Array.isArray(data.conversations) ? data.conversations : [];
    conversations = serverConversations.length
      ? serverConversations
      : JSON.parse(localStorage.getItem('infinity_convs') || '[]');

    if (!currentConvId || !conversations.some(c => String(c.id) === String(currentConvId))) {
      currentConvId = conversations[0]?.id ?? null;
    }
  } catch (e) {
    isLoggedIn = false;
    serverConversations = [];
    conversations = JSON.parse(localStorage.getItem('infinity_convs') || '[]');
    if (!currentConvId || !conversations.some(c => String(c.id) === String(currentConvId))) {
      currentConvId = conversations[0]?.id ?? null;
    }
  }
  return { isLoggedIn, conversations, currentConvId };
}

async function createNewConversation() {
  const res = await fetch('https://aur-x-backend.vercel.app/api/conversations', {
    method: 'POST',
    credentials: 'include'
  });
  if (!res.ok) throw new Error('Impossible de créer une conversation serveur');
  const data = await res.json();
  const id = data.convId ?? data.id ?? data.conversation?.id;
  if (id == null) throw new Error('Réponse serveur sans identifiant de conversation');
  return id;
}

function linkify(text) {
  if (!text) return '';
  const urlPattern = /(https?:\/\/[^\s<]+)|(www\.[^\s<]+)|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  return text.replace(urlPattern, (url) => {
    if (url.includes('@')) {
      return `<a href="mailto:${url}" class="code-frame" target="_blank" rel="noopener">${url}</a>`;
    }
    if (url.startsWith('www.')) {
      return `<a href="http://${url}" class="code-frame" target="_blank" rel="noopener">${url}</a>`;
    }
    return `<a href="${url}" class="code-frame" target="_blank" rel="noopener">${url}</a>`;
  });
}
function autoMathify(text) {
  if (!text) return '';
  const protected = [];
  text = text.replace(/(\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|```[\s\S]*?```)/g, m => {
    protected.push(m);
    return `__PROTECT_${protected.length-1}__`;
  });
  const superscripts = { '⁰': '^0', '¹': '^1', '²': '^2', '³': '^3', '⁴': '^4', '⁵': '^5', '⁶': '^6', '⁷': '^7', '⁸': '^8', '⁹': '^9' };
  text = text.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, match => superscripts[match] || match);
  const mathRegex = /([a-zA-Z0-9]+\s*[=+\-*/^]\s*[a-zA-Z0-9]+(\^[0-9a-zA-Z\{\}]+)?|[a-zA-Z0-9]+\^[0-9a-zA-Z\{\}]+|sqrt\([^)]+\)|\d+\/\d+|\b(pi|alpha|beta|gamma|theta|lambda|sigma|phi|delta)\b)/g;
  text = text.replace(mathRegex, match => {
    let m = match;
    m = m.replace(/(\d+)\s*\/\s*(\d+)/g, '\\frac{$1}{$2}');
    m = m.replace(/([a-zA-Z0-9])\^(\d+|[a-zA-Z]|\{[^\}]+\})/g, '$1^{$2}');
    m = m.replace(/sqrt\(([^)]+)\)/g, '\\sqrt{$1}');
    m = m.replace(/\b(pi|alpha|beta|gamma|theta|lambda|sigma|phi|delta)\b/g, '\\$1');
    m = m.replace(/(\d+)\s*x\s*(\d+)/g, '$1 \\times $2');
    return `$$${m}$$`;
  });
  protected.forEach((m, i) => {
    text = text.replace(`__PROTECT_${i}__`, m);
  });
  return text;
}



document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
  await loginReady;
  const input = document.getElementById('input');
  const chat = document.getElementById('chat');
  const sendBtn = document.getElementById('sendBtn');
  const circleFg = document.querySelector('.circle-fg');
  const circleText = document.querySelector('.circle-text');
  const acceptTerms = document.getElementById('acceptTerms');
  const continueBtn = document.getElementById('continueBtn');
  const termsScreen = document.getElementById('termsScreen');
  const installBtn = document.getElementById('installBtn');
  const historyBtn = document.getElementById('historyBtn');
  const sidebar = document.getElementById('sidebar');
  const closeSidebar = document.getElementById('closeSidebar');
  const convList = document.getElementById('convList');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const closeSettings = document.getElementById('closeSettings');
  const overlay = document.getElementById('overlay');
  const newChatBtn = document.getElementById('newChatBtn');
  const deleteAllBtn = document.getElementById('deleteAllBtn');
  const reviewTermsBtn = document.getElementById('reviewTermsBtn');

  let deferredPrompt = null;
  let typingElement = null;
  let thinkingTimeout = null;

  function hideWelcome() {
    const welcome = document.getElementById('welcome');
    if (welcome) welcome.classList.add('hidden');
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.style.display = 'block';
  });

  installBtn?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice?.outcome === 'accepted') {
      installBtn.style.display = 'none';
    }
    deferredPrompt = null;
  });

  acceptTerms?.addEventListener('change', () => {
    continueBtn.disabled = !acceptTerms.checked;
    continueBtn.classList.toggle('active', acceptTerms.checked);
  });

  continueBtn?.addEventListener('click', () => {
    if (!acceptTerms.checked) return;
    continueBtn.classList.add('loading');
    continueBtn.disabled = true;
    setTimeout(() => {
      localStorage.setItem('infinity_terms', 'true');
      termsScreen?.classList.add('hidden');
      continueBtn.classList.remove('loading');
      continueBtn.disabled = false;
      acceptTerms.checked = false;
      continueBtn.classList.remove('active');
      continueBtn.disabled = true;
    }, 1000);
  });

  if (localStorage.getItem('infinity_terms') === 'true') {
    termsScreen?.classList.add('hidden');
  }

  reviewTermsBtn?.addEventListener('click', () => {
    settingsModal?.classList.remove('open');
    overlay?.classList.remove('open');
    localStorage.removeItem('infinity_terms');
    termsScreen?.classList.remove('hidden');
    acceptTerms.checked = false;
    continueBtn.classList.remove('active');
    continueBtn.disabled = true;
  });

  historyBtn?.addEventListener('click', () => {
    sidebar?.classList.add('open');
    overlay?.classList.remove('open');
    renderHistory();
  });

  closeSidebar?.addEventListener('click', () => {
    sidebar?.classList.remove('open');
    overlay?.classList.remove('open');
  });

  overlay?.addEventListener('click', () => {
    sidebar?.classList.remove('open');
    settingsModal?.classList.remove('open');
    overlay?.classList.remove('open');
  });

  newChatBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    chat.innerHTML = '<div id="welcome">Infinity<span>Pose-moi une question</span></div>';
    currentConvId = null;
    if (!isLoggedIn) localStorage.removeItem('infinity_current');
    sidebar?.classList.remove('open');
  });

  deleteAllBtn?.addEventListener('click', async () => {
    if (!confirm('WIPE toutes les conversations? Cette action est irréversible.')) return;

    if (isLoggedIn) {
      await fetch('https://aur-x-backend.vercel.app/api/deleteAll', {
        method: 'POST',
        credentials: 'include'
      });
      serverConversations = [];
      conversations = [];
    } else {
      localStorage.removeItem('infinity_convs');
      localStorage.removeItem('infinity_current');
      conversations = [];
    }

    currentConvId = null;
    chat.innerHTML = '<div id="welcome">Infinity<span>Pose-moi une question</span></div>';
    renderHistory();
    sidebar?.classList.remove('open');
  });

  function renderHistory() {
    if (!convList) return;
    convList.innerHTML = '';
    const convsToShow = isLoggedIn ? serverConversations : conversations;

    if (convsToShow.length === 0) {
      convList.innerHTML = '<div class="empty">Aucune conversation</div>';
      return;
    }
    convsToShow.forEach(conv => {
      const item = document.createElement('div');
      item.className = 'conv-item';
      item.textContent = conv.title || 'Nouvelle conversation';
      item.onclick = () => loadConversation(conv.id);
      convList.appendChild(item);
    });
  }
function loadConversation(id) {
    currentConvId = id;
    if (!isLoggedIn) localStorage.setItem('infinity_current', id);

    const conv = (isLoggedIn ? serverConversations : conversations).find(c => c.id === id);
    if (!conv) return;
    chat.innerHTML = '';
    document.getElementById('welcome')?.classList.add('hidden');
    try {
      (conv.messages || []).forEach(m => {
        addMessage(m.text, m.type, m.timestamp || Date.now(), false);
      });
    } catch(e) {
      console.error('Erreur load conv:', e);
      chat.innerHTML = '<div class="msg bot">Erreur de chargement</div>';
    }
    sidebar?.classList.remove('open');
    overlay?.classList.remove('open');
}


  async function saveConversation(title, messages) {
    if (!settings.autosave || messages.length === 0) return;

    if (isLoggedIn) {
      try {
        const response = await fetch('https://aur-x-backend.vercel.app/api/chat', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: messages[messages.length - 1].text,
            convId: currentConvId,
            title: title,
            saveOnly: true
          })
        });
        if (!response.ok) throw new Error('Sauvegarde serveur refusée');
        const known = serverConversations.findIndex(c => String(c.id) === String(currentConvId));
        const updated = { id: currentConvId, title, messages, updatedAt: Date.now() };
        if (known >= 0) serverConversations[known] = updated;
        else serverConversations.unshift(updated);
        renderHistory();
        return;
      } catch(e) {
        console.error('Save serveur failed');
      }
    }

    conversations = JSON.parse(localStorage.getItem('infinity_convs') || '[]');
    let id = currentConvId;
    if (!id) {
      id = Date.now().toString();
      currentConvId = id;
    }
    const conv = { id, title, messages, date: Date.now() };
    const index = conversations.findIndex(c => c.id === id);
    if (index > -1) {
      conversations[index] = conv;
    } else {
      conversations.unshift(conv);
    }
    if (conversations.length > 50) {
      conversations = conversations.slice(0, 50);
    }
    localStorage.setItem('infinity_convs', JSON.stringify(conversations));
    localStorage.setItem('infinity_current', String(id));
  }

  settingsBtn?.addEventListener('click', () => {
    settingsModal?.classList.add('open');
    overlay?.classList.add('open');
  });

  closeSettings?.addEventListener('click', () => {
    settingsModal?.classList.remove('open');
    overlay?.classList.remove('open');
  });

  input?.addEventListener('input', () => {
    updateCharCounter();
    autoResizeInput();
  });

  sendBtn?.addEventListener('click', sendMessage);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && document.activeElement === input) {
      e.preventDefault();
      sendMessage();
    }
  });

  function updateCharCounter() {
    const len = input?.value?.length || 0;
    if (circleFg) {
      circleFg.style.strokeDashoffset = 0;
      circleFg.style.stroke = '#0A84FF';
      if (circleText) circleText.style.color = '#fff';
    }
    if (circleText) circleText.textContent = len;
    if (sendBtn) sendBtn.disabled = len === 0;
  }

  function autoResizeInput() {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }

  function parseMessage(text) {
    if (!text) return [];
    const parts = [];
    const regex = /```(\w*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        const beforeText = text.slice(lastIndex, match.index);
        if (beforeText.trim()) parts.push({ type: 'text', content: beforeText.trim() });
      }
      parts.push({ type: 'code', lang: match[1] || 'plaintext', content: match[2] });
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
      const afterText = text.slice(lastIndex);
      if (afterText.trim()) parts.push({ type: 'text', content: afterText.trim() });
    }
    if (parts.length === 0) parts.push({ type: 'text', content: text });
    return parts;
  }
function formatMessage(text) {
    if (!text) return "";
    const mathBlocks = [];
    const codeBlocks = [];
    text = text.replace(/(\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/g, match => {
      const id = `__MATH_${mathBlocks.length}__`;
      mathBlocks.push(match);
      return id;
    });
    text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
      const id = `__CODE_${codeBlocks.length}__`;
      codeBlocks.push({ lang: lang || "plaintext", code });
      return id;
    });
    text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    text = text.replace(/^### (.*)$/gm, "<h3>$1</h3>");
    text = text.replace(/^## (.*)$/gm, "<h2>$1</h2>");
    text = text.replace(/^# (.*)$/gm, "<h1>$1</h1>");
    text = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/\*(.*?)\*/g, "<em>$1</em>");
    text = text.replace(/~~(.*?)~~/g, "<del>$1</del>");
    text = text.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    text = text.replace(/^\- (.*)$/gm, "<li>$1</li>");
    text = text.replace(/^\* (.*)$/gm, "<li>$1</li>");
    text = text.replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>");
    text = text.replace(/^>\s+(.*)$/gm, "<blockquote>$1</blockquote>");
    text = linkify(text);
    text = text.replace(/\n\n+/g, "</p><p>");
    text = text.replace(/\n/g, "<br>");
    if (!text.startsWith("<h") && !text.startsWith("<ul") && !text.startsWith("<pre") && !text.startsWith("<blockquote")) {
      text = "<p>" + text + "</p>";
    }
    codeBlocks.forEach((block, i) => {
      const escapedCode = block.code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const langLabel = block.lang !== "plaintext" ? `<div class="code-lang">${block.lang}</div>` : '';
      text = text.replace(`__CODE_${i}__`, `<div class="code-block-wrapper">${langLabel}<button class="copy-btn" onclick="copyCode(this)">Copier</button><pre><code class="language-${block.lang}">${escapedCode}</code></pre></div>`);
    });
    mathBlocks.forEach((math, i) => {
      text = text.replace(`__MATH_${i}__`, math);
    });
    return text;
  }
  
    
  function addMessage(text, type, timestamp = null, isNew = true) {
  if (isNew) hideWelcome();
  try {
    const parts = parseMessage(text);
    parts.forEach(part => {
      const wrapper = document.createElement('div');
      wrapper.dataset.timestamp = timestamp || Date.now();
      let msg = null;
      
      if (type === 'user') {
        wrapper.className = `msg-wrapper user`;
        msg = document.createElement('div');
        msg.className = `msg user`;
        const processedText = autoMathify(part.content);
        msg.innerHTML = formatMessage(processedText);
        msg.dataset.index = messageCounter++;
        wrapper.appendChild(msg);
      } else if (part.type === 'code') {
        wrapper.className = `msg-wrapper bot`;
        msg = document.createElement('div');
        msg.className = `msg bot`;
        msg.innerHTML = formatMessage('```' + part.lang + '\n' + part.content + '```');
        msg.dataset.index = messageCounter++;
        wrapper.appendChild(msg);
      } else {
        wrapper.className = `msg-wrapper bot-full`;
        msg = document.createElement('div');
        msg.className = `msg bot-full-text`;
        msg.innerHTML = formatMessage(part.content);
        msg.dataset.index = messageCounter++;
        wrapper.appendChild(msg);
      }
      
      if (settings.timestamp) {
        const time = document.createElement('div');
        time.className = 'msg-time';
        time.textContent = new Date(Number(wrapper.dataset.timestamp)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        wrapper.appendChild(time);
      }
      
      chat.appendChild(wrapper);
      
      // 🔥 FIX : Double rAF pour KaTeX + Highlight après peinture CSS
      if (type !== 'user' && msg) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            // KaTeX
            if (typeof renderMathInElement === 'function') {
              try {
                renderMathInElement(msg, {
                  delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false}
                  ],
                  throwOnError: false
                });
              } catch(e) {
                console.error('KaTeX addMessage:', e);
              }
            }
            
            // Highlight
            if (typeof Prism !== 'undefined') {
              Prism.highlightAllUnder(msg);
            } else if (typeof hljs !== 'undefined') {
              msg.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
              });
            }
          });
        });
      }
    });
    
    chat.scrollTop = chat.scrollHeight;
  } catch(e) {
    console.error('addMessage error:', e);
  }
  return text;
}




  function showTypingIndicator() {
    hideTypingIndicator();
    typingElement = document.createElement('div');
    typingElement.className = 'typing-wrapper';
    typingElement.id = 'typingIndicator';

    typingElement.innerHTML = `
      <div class="infinity-thinking spinning">
        <img src="icon-static.png" alt="Infinity thinking">
      </div>
      <span class="typing-text">Infinity réfléchit...</span>
    `;

    chat.appendChild(typingElement);
    setTimeout(() => {
      const text = typingElement.querySelector('.typing-text');
      if (text) text.classList.add('show');
    }, 100);
    chat.scrollTop = chat.scrollHeight;
  }

  function hideTypingIndicator() {
    clearTimeout(thinkingTimeout);
    if (typingElement) {
      typingElement.remove();
      typingElement = null;
    }
  }
async function sendMessage() {
  const msg = input.value.trim();
  if (!msg) return;

  // Chaque nouveau chat reçoit un identifiant réel avant l'envoi.
  if (!currentConvId) {
    if (isLoggedIn) {
      try {
        currentConvId = await createNewConversation();
      } catch (error) {
        console.error('Création de conversation serveur impossible:', error);
        addMessage("⚠️ Impossible de créer une conversation. Réessaie dans quelques secondes.", 'bot');
        return;
      }
    } else {
      currentConvId = Date.now().toString();
    }
    localStorage.setItem('infinity_current', String(currentConvId));
  }

  const now = Date.now();
  addMessage(msg, 'user', now);

  let currentConv = conversations.find(c => String(c.id) === String(currentConvId));

  if (!currentConv) {
    currentConv = {
      id: currentConvId,
      title: msg.slice(0, 40),
      messages: [],
      date: now,
      updatedAt: now
    };
    conversations.unshift(currentConv);
    if (isLoggedIn && !serverConversations.some(c => String(c.id) === String(currentConv.id))) {
      serverConversations.unshift(currentConv);
    }
  }

  currentConv.messages.push({ text: msg, type: 'user', timestamp: now });

  input.value = '';
  input.style.height = 'auto';
  updateCharCounter();
  showTypingIndicator();

  const sendBtnEl = document.getElementById('sendBtn');
  sendBtnEl.classList.add('loading');
  sendBtnEl.disabled = true;

  const botTime = Date.now();

  const streamWrapper = document.createElement('div');
  streamWrapper.className = 'msg-wrapper bot-full';

  const streamMsgEl = document.createElement('div');
  streamMsgEl.className = 'msg bot-full-text';
  streamWrapper.appendChild(streamMsgEl);

  chat.appendChild(streamWrapper);

  let rawText = '';
  let buffer = '';
  let isDone = false;

  try {
    const res = await fetch(window.infinity_CONFIG.ENDPOINTS.openai, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: msg,
        convId: currentConvId
      })
    });

    hideTypingIndicator();

    // erreur HTTP
    if (!res.ok ||!res.body) {
      isDone = true;
      streamWrapper.remove();
      addMessage("⚠️ Infinity n’arrive pas à se connecter au serveur.\nRéessaie dans quelques secondes.", 'bot', botTime, true);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;

        const data = trimmed.slice(5).trim();

        // FIX 1: [DONE] arrive en string brute
        if (data === '[DONE]') {
          isDone = true;
          streamWrapper.remove();

          // FIX 2: si rawText vide, affiche erreur au lieu de message vide
          if (!rawText.trim()) {
            addMessage("🤖 Infinity a répondu vide. Réessaie.", 'bot', botTime, true);
          } else {
            addMessage(rawText, 'bot', botTime, false);
            currentConv.messages.push({
              text: rawText,
              type: 'bot',
              timestamp: botTime
            });
          }

          saveConversation(msg.slice(0, 40), currentConv.messages);
          return;
        }

        // FIX 3: parse JSON seulement si ça commence par {
        if (!data.startsWith('{')) continue;

        try {
          const parsed = JSON.parse(data);

          // FIX 4: check error en premier
          if (parsed.error) {
            isDone = true;
            streamWrapper.remove();
            addMessage(`⚠️ ${parsed.error}`, 'bot', botTime, true);
            return;
          }

          // Traiter explicitement les événements SSE du backend : c'est plus fiable
          // que de tenter de détecter le statut en analysant tout le texte de la page.
          const eventType = String(parsed.type || parsed.event || '').toLowerCase();
          if (eventType === 'search_started') {
            window.dispatchEvent(new CustomEvent('infinity:web-search', { detail: { active: true } }));
            continue;
          }
          if (eventType === 'search_completed' || eventType === 'search_unavailable') {
            window.dispatchEvent(new CustomEvent('infinity:web-search', { detail: { active: false } }));
            continue;
          }
          // Compatibilité avec d'autres formats d'événements utilisés par des backends.
          const eventLabel = [parsed.status, parsed.tool, parsed.name, parsed.action, parsed.message]
            .filter(v => typeof v === 'string').join(' ').toLowerCase();
          if (/(web.?search|search.?web|recherche.?web|searching|recherche en cours|browser|web_search)/i.test(eventLabel)) {
            const finished = /(complete|completed|finished|done|end|termin|finish|indisponible|unavailable)/i.test(eventLabel)
              || parsed.done === true || parsed.active === false;
            window.dispatchEvent(new CustomEvent('infinity:web-search', { detail: { active: !finished } }));
          }

          const content = parsed.content ?? parsed.delta?.content ?? parsed.choices?.[0]?.delta?.content;
          if (content && typeof content === 'string') {
            rawText += content;
            streamMsgEl.textContent = rawText;
            chat.scrollTop = chat.scrollHeight;
          }

        } catch (e) {
          console.error("JSON parse error:", data, e);
        }
      }
    }

    // fallback si pas de [DONE]
    if (!isDone) {
      streamWrapper.remove();
      if (!rawText.trim()) {
        addMessage("🤖 Infinity a reçu une réponse vide.", 'bot', botTime, true);
      } else {
        addMessage(rawText, 'bot', botTime, false);
        currentConv.messages.push({
          text: rawText,
          type: 'bot',
          timestamp: botTime
        });
        saveConversation(msg.slice(0, 40), currentConv.messages);
      }
    }

  } catch (e) {
    streamWrapper.remove();
    addMessage("❌ Connexion perdue avec Infinity\nVérifie ton réseau ou réessaie", 'bot', botTime, true);
    console.error(e);
  } finally {
    window.dispatchEvent(new CustomEvent('infinity:web-search', { detail: { active: false } }));
    sendBtnEl.classList.remove('loading');
    sendBtnEl.disabled = false;
    hideTypingIndicator();
  }
}



  function typeMessage(text, type, timestamp = Date.now()) {
    return new Promise(resolve => {
      const parts = parseMessage(text);
      let partIndex = 0;
      let charIndex = 0;
      const speed = 12;
      function typeNext() {
        if (partIndex >= parts.length) {
          resolve(text);
          return;
        }
        const part = parts[partIndex];
        const wrapper = document.createElement('div');
        wrapper.dataset.timestamp = timestamp;
        if (type === 'user') {
          wrapper.className = `msg-wrapper user`;
        } else if (part.type === 'code') {
          wrapper.className = `msg-wrapper bot`;
        } else {
          wrapper.className = `msg-wrapper bot-full`;
        }
        const msg = document.createElement('div');
        msg.className = type === 'user' ? `msg user streaming` : part.type === 'code' ? `msg bot streaming` : `msg bot-full-text streaming`;
        wrapper.appendChild(msg);
        chat.appendChild(wrapper);
        const fullContent = part.content;
        const interval = setInterval(() => {
          charIndex++;
          const currentText = fullContent.slice(0, charIndex);
          if (part.type === 'code') {
            msg.innerHTML = formatMessage('```' + part.lang + '\n' + currentText + '```');
          } else {
            msg.innerHTML = formatMessage(currentText);
          }
          chat.scrollTop = chat.scrollHeight;
          if (charIndex % 10 === 0 || charIndex >= fullContent.length) {
            highlightCode();
          }
          if (charIndex >= fullContent.length) {
            clearInterval(interval);
            msg.classList.remove('streaming');
            if (settings.timestamp) {
              const time = document.createElement('div');
              time.className = 'msg-time';
              time.textContent = new Date(Number(timestamp)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              wrapper.appendChild(time);
            }
            partIndex++;
            charIndex = 0;
            setTimeout(typeNext, 100);
          }
        }, speed);
      }
      typeNext();
    });
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('SW registered:', reg.scope))
      .catch(err => console.error('SW registration failed:', err));
  }
  updateCharCounter();
  renderHistory();
  if (currentConvId) loadConversation(currentConvId);
}

function copyCode(btn) {
  const code = btn.nextElementSibling.textContent;
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = 'Copié!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'Copier';
      btn.classList.remove('copied');
    }, 2000);
  });
}

function highlightCode() {
  if (typeof hljs !== 'undefined') {
    setTimeout(() => {
      document.querySelectorAll('pre code:not(.hljs)').forEach(block => {
        hljs.highlightElement(block);
      });
    }, 0);
  }
}