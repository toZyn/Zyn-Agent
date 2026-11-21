const { randomUUID } = require('node:crypto');
const { scanAssistantParts, classifyAssistantParts } = require('./response-protocol');
const { parseAgentResponse } = require('./prompts');

class AssistantStream {
  constructor(state, ui, enabled, onVisible = () => {}) {
    this.state = state;
    this.ui = ui;
    this.enabled = enabled;
    this.onVisible = onVisible;
    this.id = randomUUID();
    this.blocks = new Map();
    this.hasVisibleOutput = false;
  }

  append(delta, metadata = {}) {
    const key = String(metadata.id ?? 'default');
    let block = this.blocks.get(key);
    if (!block) {
      block = { id: key, text: '', channel: metadata.channel };
      this.blocks.set(key, block);
    }
    if (metadata.channel) block.channel = metadata.channel;
    block.text = metadata.replace ? String(delta) : block.text + delta;
    this.publish(false);
  }

  parts(finished) {
    return classifyAssistantParts([...this.blocks.values()].flatMap(block =>
      scanAssistantParts(block.text, { finished }).map(part => ({ ...part, id: this.id + ':' + block.id + ':' + part.id, channel: block.channel })),
    ));
  }

  publish(finished, status) {
    const parts = this.parts(finished);
    if (this.enabled && typeof this.ui.upsertAssistantPart === 'function') {
      for (const part of parts) {
        if (!['answer', 'comment'].includes(part.type) || !part.content.trim()) continue;
        if (!this.hasVisibleOutput) this.onVisible();
        this.hasVisibleOutput = true;
        const incomplete = finished && !part.complete && part.type === 'answer';
        this.ui.upsertAssistantPart(this.state, { id: part.id, type: incomplete ? 'comment' : part.type, text: part.content.trim(), live: !finished && !part.complete, status: incomplete ? 'incomplete' : status });
      }
    }
    return parts;
  }

  finish(authoritative) {
    if (this.blocks.size <= 1 && typeof authoritative === 'string') {
      const block = this.blocks.values().next().value;
      if (block) block.text = authoritative;
      else this.blocks.set('default', { id: 'default', text: authoritative });
    }
    const parts = this.publish(true);
    const combined = [...this.blocks.values()].map(block => block.text).join('\n\n');
    const hasAction = parts.some(part => part.type === 'tool' || part.type === 'answer' && part.record?.type === 'final');
    const answers = parts.filter(part => part.type === 'answer');
    const comments = parts.filter(part => part.type === 'comment' && part.content.trim()).map(part => part.content.trim());
    let parsed = parseAgentResponse(combined);
    if (!hasAction && !['tool', 'invalid'].includes(parsed.type)) {
      parsed = answers.length ? { type: 'final', content: answers.map(part => part.content.trim()).join('\n\n') }
        : { type: comments.length ? 'comment' : 'final', content: comments.join('\n\n') };
    }
    parsed._comments = comments;
    const typed = this.enabled && typeof this.ui.upsertAssistantPart === 'function';
    let rendered = typed && parsed.type === 'final' && answers.length > 0;
    if (this.enabled && !typed && parsed.type === 'final' && parsed.content) {
      this.onVisible();
      this.ui.beginAssistantStream(this.state);
      this.ui.writeAssistantDelta(this.state, parsed.content);
      this.ui.endAssistantStream(this.state);
      rendered = true;
    }
    return { parsed, rendered, commentsRendered: typed };
  }

  interrupt() {
    this.publish(true, 'interrupted');
  }
}
module.exports = { AssistantStream };
