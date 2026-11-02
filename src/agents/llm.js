// Thin wrapper around the Claude API. Agents use it for language work only: framing,
// narrative, critique and explanation. When ANTHROPIC_API_KEY is not set, every call returns
// null and the agents fall back to plain templates, so the system still runs end to end.
const MODEL = process.env.LIMN_MODEL || 'claude-sonnet-5-5';
const FAST_MODEL = process.env.LIMN_FAST_MODEL || 'claude-haiku-5-5';

let _client;
function client() {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) {
    const Anthropic = require('@anthropic-ai/sdk');
    const Ctor = Anthropic.default || Anthropic;
    _client = new Ctor();
  }
  return _client;
}
const enabled = () => !!_client || !!process.env.ANTHROPIC_API_KEY;
// Tests inject a fake client with the same messages.create shape.
function _setClient(c) { _client = c; }

const usage = { calls: 0, input: 0, output: 0, errors: 0 };

function textOf(msg) {
  return (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

async function write({ system, prompt, model = MODEL, maxTokens = 900 }) {
  const c = client();
  if (!c) return null;
  try {
    const msg = await c.messages.create({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] });
    usage.calls++; usage.input += msg.usage?.input_tokens || 0; usage.output += msg.usage?.output_tokens || 0;
    return textOf(msg);
  } catch (e) {
    usage.errors++;
    console.error('[llm] write failed:', e.message);
    return null;
  }
}

// Ask for JSON and parse it; returns null on any failure so callers use their template.
async function writeJSON(opts) {
  const t = await write(opts);
  if (!t) return null;
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = m ? m[1] : t.slice(t.search(/[\[{]/));
  try { return JSON.parse(raw); } catch (e) { usage.errors++; return null; }
}

// Tool-use loop for the Explainer. handlers maps tool name to an async function returning JSON.
async function toolLoop({ system, messages, tools, handlers, model = MODEL, maxTurns = 8, maxTokens = 1200 }) {
  const c = client();
  if (!c) return null;
  const msgs = messages.slice();
  const trace = [];
  for (let turn = 0; turn < maxTurns; turn++) {
    let msg;
    try {
      msg = await c.messages.create({ model, max_tokens: maxTokens, system, tools, messages: msgs });
    } catch (e) {
      usage.errors++;
      console.error('[llm] toolLoop failed:', e.message);
      return { text: 'The Explainer could not reach the model just now. Please try again.', trace };
    }
    usage.calls++; usage.input += msg.usage?.input_tokens || 0; usage.output += msg.usage?.output_tokens || 0;
    msgs.push({ role: 'assistant', content: msg.content });
    if (msg.stop_reason !== 'tool_use') return { text: textOf(msg), trace };
    const results = [];
    for (const b of msg.content.filter(x => x.type === 'tool_use')) {
      let out;
      try { out = await handlers[b.name](b.input || {}); } catch (e) { out = { error: e.message }; }
      trace.push({ tool: b.name, input: b.input });
      results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out).slice(0, 20000) });
    }
    msgs.push({ role: 'user', content: results });
  }
  return { text: 'I ran out of steps before finishing. Try a narrower question.', trace };
}

module.exports = { write, writeJSON, toolLoop, enabled, usage, MODEL, FAST_MODEL, _setClient };
