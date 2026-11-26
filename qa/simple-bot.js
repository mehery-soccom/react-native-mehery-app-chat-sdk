/**
 * Simple scriptus bot: details form -> "how are you" (Good/Bad) -> "connect you to an agent?" (Yes/No).
 * Every step accepts the button tap OR typed text. Yes hands the chat to a human in AGENT_QUEUE.
 * Paste into the scriptus editor and Save. Set AGENT_QUEUE to your real queue first.
 */
const AGENT_QUEUE = "agent_desk";

const FIELDS = [
  { name: "name", type: "TEXT", label: "Full name" },
  { name: "email", type: "EMAIL", label: "Email" },
  { name: "phone", type: "PHONE", label: "Mobile number" },
];
// ponytail: light checks only (the app validates before sending); tighten if the bot is used without the app.
const VALID = {
  name: (v) => v.length > 0,
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  phone: (v) => v.replace(/\D/g, "").length >= 7,
};

const btn = (code, label) => ({ code, label });
const say = (body) => $.reply({ text: { body } });
// Button tap -> its code; typed text -> the text. Lower-cased for matching.
const answer = () => String($.inbound.getCode() || $.inbound.getText() || "").trim().toLowerCase();

// Session start is a separate event that arrives alongside the first message, and onMessageReceive
// already answers that message. Running the flow here too sent every step twice (seen in the server
// history: two runs ~1.5 s apart). $.store.local can't dedupe it: each run reads a snapshot taken
// when it started, so neither sees the other's write. So this stays empty on purpose.
function onSessionStart() {}
function onSessionRouted() {}

// Any message with no pending question starts (or resumes) the flow.
async function onMessageReceive() {
  await absorb(); // the channel's own pre-chat form ("Please enter your…") arrives as message.input
  return collect(true);
}

// Save any valid name/email/phone the message carries. Returns true if something was saved.
async function absorb() {
  const msg = $.inbound.message || {};
  const input = msg.input || {};
  let saved = false;
  for (const f of FIELDS) {
    const v = String(input[f.name] || "").trim();
    if (v && VALID[f.name](v)) {
      await $.store.local.set(f.name, v);
      saved = true;
    }
  }
  return saved;
}

// 1. Details: ask for the first missing field by text. Typing answers it.
async function collect(first) {
  const missing = [];
  for (const f of FIELDS) {
    const have = await $.store.local.get(f.name);
    if (!have) missing.push(f);
  }
  if (!missing.length) return askMood();
  // ponytail: scriptus can't send a form card (XMS drops options.inputs), so ask one field at a time.
  const ask = `What's your ${missing[0].label.toLowerCase()}?`;
  return say(first ? `Hi! ${ask}` : ask).listen(onDetails);
}

async function onDetails() {
  const saved = await absorb();
  if (!saved) {
    // Plain typed text with no field attached: treat it as the first missing field.
    const text = String($.inbound.getText() || "").trim();
    for (const f of FIELDS) {
      const have = await $.store.local.get(f.name);
      if (!have) {
        if (text && VALID[f.name](text)) await $.store.local.set(f.name, text);
        else await say(`That doesn't look like a valid ${f.label.toLowerCase()}.`);
        break;
      }
    }
  }
  return collect(false);
}

// 2. How are you?
async function askMood(retry) {
  const name = await $.store.local.get("name");
  return $.reply({
    text: { body: retry ? "Please tap Good or Bad." : `Thanks ${name}! How are you?` },
    options: { buttons: [btn("good", "Good"), btn("bad", "Bad")] },
  }).listen(onMood);
}

async function onMood() {
  const a = answer();
  if (/^(good|great|fine|well|ok|okay)/.test(a)) await say("Glad to hear that! 😊");
  else if (/^(bad|sad|not|terrible|awful)/.test(a)) await say("Sorry to hear that. 😕");
  else return askMood(true);
  return askAgent();
}

// 3. Agent handoff
async function askAgent(retry) {
  return $.reply({
    text: { body: retry ? "Please tap Yes or No." : "Can I connect you to an agent?" },
    options: { buttons: [btn("yes", "Yes"), btn("no", "No")] },
  }).listen(onAgent);
}

async function onAgent() {
  const a = answer();
  if (/^(yes|y|sure|ok|okay|yeah)/.test(a)) {
    await say("Connecting you to an agent. Please wait…");
    return $.session.route({ queue: AGENT_QUEUE });
  }
  if (/^(no|n|nope|nah)/.test(a)) return say("No problem! Send any message if you need anything.");
  return askAgent(true);
}
