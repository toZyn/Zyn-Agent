import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { appendVisibleItem } from './viewport.mjs';
import { transcriptViewport } from './transcript-view.mjs';
import { shortTextPreview } from './format.mjs';

const require = createRequire(import.meta.url);
const { parseAgentResponse } = require('../core/prompts');
const THINKING_THROTTLE_MS = 200;

export class UIStore extends EventEmitter {
  constructor(uiText = (en) => en) {
    super();
    this.uiText = uiText;
    this.setMaxListeners(50);
    this.items = [];
    this.scrollOffset = 0;
    this.liveThinking = null;
    this.liveAnswer = null;
    this.spinner = null;
    this.processing = false;
    this.confirmRequest = null;
    this.authFlow = null;
    this.selectRequest = null;
    this.inputRequest = null;
    this.transcriptView = null;
    this.lastUserMessage = '';
    this.inputDraft = '';
    this.turnCount = 0;
    this.messageQueue = [];
    this.pendingExit = false;
    this.lastEscapeAt = -1;
    this.submittedHistory = [];
    this.submittedRedo = [];
    this.conversationHistory = [];
    this.conversationRedo = [];
    this.thinkingHistory = [];
    this.tokenEstimate = 0;
    this.lastMeasuredTokens = null;
    this.contextLimit = 0;
    this.themeVersion = 0;
    this._idCounter = 0;
    this._scheduled = false;
    this._lastEmitAt = 0;
    this._streamingActive = false;
    this._lastThinkingEmit = 0;
    this._lastAnswerEmit = 0;
    this.showThinking = false;
  }

  setShowThinking(val) {
    this.showThinking = !!val;
    const expand = this.showThinking;
    this.items = this.items.map(it => it.type === 'thinking' ? { ...it, expanded: expand, id: String(++this._idCounter) } : it);
    this._emit();
  }

  toggleAllThinking(expand) {
    this.items = this.items.map(it => it.type === 'thinking' ? { ...it, expanded: expand, id: String(++this._idCounter) } : it);
    this._emit();
  }

  addItem(item) {
    this._idCounter += 1;
    this.items = appendVisibleItem(this.items, { ...item, id: String(this._idCounter) });
    if (this.scrollOffset > 0) this.scrollOffset = Math.min(this.items.length - 1, this.scrollOffset + 1);
    this._emit();
  }

  scrollBy(delta) {
    const step = Number.isFinite(delta) ? Math.trunc(delta) : (delta > 0 ? (this.scrollMax ?? this.items.length) : -(this.scrollMax ?? this.items.length));
    const next = Math.max(0, Math.min((this.scrollMax ?? this.items.length - 1), this.scrollOffset + step));
    if (next !== this.scrollOffset) {
      this.scrollOffset = next;
      this._emit();
    }
  }

  scrollToBottom() {
    this.scrollBy(-Infinity);
  }

  setSpinner(label) {
    this.spinner = label ? { label, started: Date.now() } : null;
    this._emit();
  }

  beginThinking() {
    this.liveThinking = { text: '', started: Date.now() };
    this._streamingActive = true;
    this._emit();
  }

  appendThinking(delta) {
    if (!this.liveThinking) return;
    this.liveThinking = { ...this.liveThinking, text: this.liveThinking.text + delta };
    const now = Date.now();
    if (now - this._lastThinkingEmit < THINKING_THROTTLE_MS) return;
    this._lastThinkingEmit = now;
    this._emit();
  }

  endThinking() {
    if (!this.liveThinking) return;
    const elapsed = ((Date.now() - this.liveThinking.started) / 1000).toFixed(1);
    const text = this.liveThinking.text.trim();
    this.liveThinking = null;
    this._lastThinkingEmit = 0;
    if (!text) return;
    this.thinkingHistory.push({ text, elapsed, timestamp: Date.now() });
    if (this.thinkingHistory.length > 20) this.thinkingHistory.shift();
    this.addItem({ type: 'thinking', text, elapsed, expanded: this.showThinking });
  }

  beginAnswer() {
    this.liveAnswer = { text: '' };
    this._streamingActive = true;
    this._emit();
  }

  appendAnswer(delta) {
    if (!this.liveAnswer) return;
    this.liveAnswer = { ...this.liveAnswer, text: this.liveAnswer.text + delta };
    this._updateTokenEstimate(delta);
    const now = Date.now();
    if (now - this._lastAnswerEmit < THINKING_THROTTLE_MS) return;
    this._lastAnswerEmit = now;
    this._emit();
  }

  endAnswer() {
    if (!this.liveAnswer) return false;
    this._lastAnswerEmit = 0;
    const text = this.liveAnswer.text;
    const trimmed = (text || '').trim();
    let skip = false;
    if (trimmed) {
      try {
        const parsed = parseAgentResponse(trimmed);
        if (parsed?.type === 'tool') {
          skip = true;
        } else if (parsed?.type === 'final' && typeof parsed.content === 'string') {
          const c = parsed.content.trim();
          skip = !c || c.startsWith('{') || c.startsWith('[');
        }
      } catch {}
    }
    let added = false;
    if (!skip) {
      this.addItem({ type: 'answer', text });
      added = true;
    }
    this.liveAnswer = null;
    this._streamingActive = false;
    return added;
  }

  _updateTokenEstimate(delta) {
    if (!delta) return;
    this.tokenEstimate += Math.ceil(delta.length * 0.25);
  }

  setTokenEstimate(estimate, limit) {
    this.tokenEstimate = estimate;
    this.contextLimit = limit;
    this._emit();
  }

  setTokenUsage(usage) {
    const measured = Number(usage?.totalTokens || ((usage?.promptTokens || 0) + (usage?.completionTokens || 0)));
    if (Number.isFinite(measured) && measured > 0) {
      this.lastMeasuredTokens = measured;
      this._emit();
    }
  }

  addEvent(kind, title, detail) {
    const operation = String(title || '').match(/\b(spawn_agent|wait_agent|followup_agent|resume_agent|interrupt_agent|close_agent)\b/);
    if (kind === 'ok' && operation) {
      const index = this.items.findLastIndex(item =>
        item.type === 'event' &&
        item.kind === 'tool' &&
        String(item.title || '').includes(operation[1]),
      );
      if (index >= 0 && this.items.length - index <= 5) {
        this.items = this.items.map((item, i) => i === index
          ? { ...item, kind, title, detail: detail || '' }
          : item);
        this._emit();
        return;
      }
    }
    this.addItem({ type: 'event', kind, title, detail: detail || '' });
  }

  updateLastEventTitle(title) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i].type === 'event' && this.items[i].kind === 'tool') {
        this.items = this.items.map((item, idx) => idx === i ? { ...item, title } : item);
        this._emit();
        return;
      }
    }
  }

  setInputDraft(text) {
    const nextDraft = String(text || '');
    if (nextDraft === this.inputDraft) return;
    this.inputDraft = nextDraft;
    this._emit();
  }

  setAuthFlow(flow) {
    this.authFlow = flow;
    this._emit();
  }

  openTranscript(text) {
    this.transcriptView = Array.isArray(text) && text.some(value => value && typeof value === 'object')
      ? { entries: text, offset: 0 }
      : { text: Array.isArray(text) ? text.join('\n') : String(text || ''), offset: 0 };
    this._emit();
  }

  closeTranscript() {
    if (!this.transcriptView) return;
    this.transcriptView = null;
    this._emit();
  }

  scrollTranscript(delta, width = 80, height = 24) {
    if (!this.transcriptView) return;
    const page = transcriptViewport(this.transcriptView, width, height);
    const next = Math.max(0, Math.min(page.maxOffset, page.offset + delta));
    if (next !== this.transcriptView.offset) {
      this.transcriptView.offset = next;
      this._emit();
    }
  }

  requestConfirm(title, detail) {
    return new Promise(resolve => {
      this.confirmRequest = { title, detail, resolve, expanded: false, offset: 0 };
      this._emit();
    });
  }

  toggleConfirmDetails() {
    if (!this.confirmRequest) return;
    this.confirmRequest.expanded = !this.confirmRequest.expanded;
    this.confirmRequest.offset = 0;
    this._emit();
  }

  scrollConfirmDetails(delta) {
    if (!this.confirmRequest || !this.confirmRequest.expanded) return;
    this.confirmRequest.offset = Math.max(0, (this.confirmRequest.offset || 0) + delta);
    this._emit();
  }

  resolveConfirm(answer) {
    if (!this.confirmRequest) return;
    this.confirmRequest.resolve(answer);
    this.confirmRequest = null;
    this._emit();
  }

  requestSelect(options) {
    return new Promise(resolve => {
      const marker = Symbol('select');
      this._selectMarker = marker;
      setImmediate(() => {
        if (this._selectMarker !== marker) {
          resolve(null);
          return;
        }
        this.selectRequest = { ...options, resolve, selected: Number.isInteger(options?.initialIndex) ? options.initialIndex : 0 };
        this._emit();
      });
    });
  }

  resolveSelect(value) {
    if (!this.selectRequest) return;
    this.selectRequest.resolve(value);
    this.selectRequest = null;
    this._emit();
  }

  cancelSelect() {
    this._selectMarker = null;
    if (!this.selectRequest) return;
    this.selectRequest.resolve(null);
    this.selectRequest = null;
    this._emit();
  }

  adjustSelect(delta) {
    if (!this.selectRequest) return;
    const total = this.selectRequest.items?.length || 0;
    if (total === 0) return;
    const next = (this.selectRequest.selected + delta + total) % total;
    this.selectRequest.selected = next;
    this._emit();
  }

  requestInput(options) {
    return new Promise(resolve => {
      const marker = Symbol('input');
      this._inputMarker = marker;
      setImmediate(() => {
        if (this._inputMarker !== marker) {
          resolve(null);
          return;
        }
        this.inputRequest = { ...options, resolve, value: '' };
        this._emit();
      });
    });
  }

  cancelInput() {
    if (!this.inputRequest) return;
    this.inputRequest.resolve(null);
    this.inputRequest = null;
    this._emit();
  }

  async requestAskUser(question, allItems, customLabel) {
    const selectResult = await this.requestSelect({
      title: question,
      items: allItems,
      getLabel: (item) => String(item),
      getValue: (item) => item,
    });

    if (selectResult === null) return null;
    if (selectResult === customLabel) {
      const customResult = await this.requestInput({
        title: question,
        subtitle: '',
        prompt: '>',
      });
      return customResult || null;
    }
    return String(selectResult);
  }

  appendInputChar(ch) {
    if (!this.inputRequest) return;
    if (ch === '\x1b' || ch === '\x1b\x1b' || ch === '\x03') {
      this.inputRequest.resolve(null);
      this.inputRequest = null;
    } else if (ch === '\r' || ch === '\n') {
      const value = this.inputRequest.value;
      this.inputRequest.resolve(value);
      this.inputRequest = null;
    } else if (ch === '\x7f' || ch === '\b') {
      this.inputRequest.value = this.inputRequest.value.slice(0, -1);
    } else {
      for (const c of ch) {
        if (c.charCodeAt(0) >= 32) {
          this.inputRequest.value += c;
        }
      }
    }
    this._emit();
  }

  enqueueMessage(text) {
    this.messageQueue.push(text);
    this.addItem({ type: 'queued', text });
    this._emit();
  }


  pushSubmittedMessage(text) {
    const value = String(text || '');
    if (!value) return;
    this.submittedHistory.unshift(value);
    if (this.submittedHistory.length > 200) this.submittedHistory.pop();
    this.submittedRedo = [];
    this._emit();
  }

  addConversationTurn(userMsg, assistantMsg) {
    this.conversationHistory.unshift({ user: userMsg, assistant: assistantMsg, timestamp: Date.now() });
    if (this.conversationHistory.length > 100) this.conversationHistory.pop();
    this.conversationRedo = [];
    this._emit();
  }

  undoConversationTurn() {
    if (this.conversationHistory.length === 0) return null;
    const turn = this.conversationHistory.shift();
    this.conversationRedo.unshift(turn);
    this._removeLastConversationItems();
    this._emit();
    return turn;
  }

  redoConversationTurn() {
    if (this.conversationRedo.length === 0) return null;
    const turn = this.conversationRedo.shift();
    this.conversationHistory.unshift(turn);
    this.addItem({ type: 'user', text: turn.user });
    this.addItem({ type: 'answer', text: turn.assistant });
    this._emit();
    return turn;
  }

  _removeLastConversationItems() {
    let removed = 0;
    const newItems = [];
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (removed < 2 && (this.items[i].type === 'user' || this.items[i].type === 'answer')) {
        removed++;
        continue;
      }
      newItems.unshift(this.items[i]);
    }
    if (removed > 0) {
      this.items = newItems;
      this._emit();
    }
  }

  undoSubmittedMessage() {
    if (this.submittedHistory.length === 0) return null;
    const value = this.submittedHistory.shift();
    this.submittedRedo.unshift(value);
    this.setInputDraft(value);
    this.addEvent('info', this.uiText('message restored', 'mensaje restaurado'), shortTextPreview(value, 120));
    return value;
  }

  redoSubmittedMessage() {
    if (this.submittedRedo.length === 0) return null;
    const value = this.submittedRedo.shift();
    this.submittedHistory.unshift(value);
    this.setInputDraft(value);
    this.addEvent('info', this.uiText('message reapplied', 'mensaje reaplicado'), shortTextPreview(value, 120));
    return value;
  }

  _emit() {
    if (this._scheduled) return;
    this._scheduled = true;
    setImmediate(() => {
      this._scheduled = false;
      this.emit('update');
    });
  }
}
