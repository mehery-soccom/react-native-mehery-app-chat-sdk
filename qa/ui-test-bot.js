/**
 * UI_TEST_BOT: scriptus bot that sends every message type the React Native chat SDK draws.
 * In the app, type a code (e.g. "btn", "form3", "img"); type "menu" to list them all.
 * Each code matches the "Type in chat" column of qa/chat-ui-test-cases.csv.
 *
 * Anything that isn't a code (quick-reply taps, form submits, uploads, free text) is echoed
 * back as raw JSON, so testers can check what actually reached the server.
 */

// ---- Set these for your tenant before testing ----
const AGENT_QUEUE = "agent_desk"; // queue used by $.session.route (same as BOTFLOW)
const TEMPLATE_CODE = "YOUR_TEMPLATE_CODE"; // any approved template on this channel

// ponytail: public sample media; move to your own CDN/S3 if any of these go down.
const IMG = "https://dummyimage.com/800x600/e4e4e7/3f3f46.png&text=Test+Image";
const IMG_TALL = "https://dummyimage.com/400x1600/174ea6/ffffff.png&text=Tall+Image";
const IMG_HTTP = "http://dummyimage.com/600x400/0f766e/ffffff.png&text=HTTP+Image";
const IMG_BAD = "https://example.invalid/missing.png";
const VIDEO = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4";
const AUDIO = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3";
const PDF = "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";

const LONG = [
  "*Long reply test.* This message is long on purpose to check wrapping, bubble width and scrolling.",
  "Paragraph two: Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
  "Paragraph three: Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
  "A very long unbroken word: Supercalifragilisticexpialidocious_Supercalifragilisticexpialidocious_Supercalifragilistic",
  "Last line. If you can read this without scrolling sideways, the test passes.",
].join("\n\n");

const say = (body) => $.reply({ text: { body } });
// ponytail: assumes the scriptus sandbox has setTimeout; if "delay" errors, drop that case.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const btn = (code, label) => ({ code, label });

// ponytail: WhatsApp-style media shape ({ link, caption }), same keys the XMS adapter forwards.
// Not confirmed for the web-chat channel; if media doesn't show, check the XMS send API.
const media = (type, body) => $.reply({ [type]: body });

const CASES = {
  menu: ["List every test code", menu],

  // Text
  text: ["Plain short reply", () => say("Hello! This is a plain text reply.")],
  rich: ["Bold, italic, underline, strike, code", () => say("*bold* /italic/ _underline_ ~strike~ `code`\nMixed: *bold and _underlined_*")],
  links: ["Auto-linked URL, email, phone", () =>
    say("Web: https://mehery.com/pricing?plan=pro\nWWW: www.google.com\nBare: mehery.io\nEmail: support@example.com\nPhone: +91 98765 43210\nNot a link: TXN20261116")],
  long: ["Very long reply", () => say(LONG)],
  rtl: ["Arabic / right-to-left", () => say("مرحباً! هذه رسالة اختبار باللغة العربية. الطلب رقم 4821 في الطريق إليك.")],
  emoji: ["Emoji and flags", () => say("Emoji test 😀🎉👍🏽 ❤️ 🇮🇳 🇰🇼 👨‍👩‍👧‍👦")],
  burst: ["5 messages back to back", async () => {
    for (let i = 1; i <= 5; i++) await say(`Burst message ${i} of 5`);
  }],
  delay: ["Reply after 10 seconds", async () => {
    await wait(10000);
    return say("This reply came after 10 seconds.");
  }],

  // Buttons
  btn: ["3 quick replies", () => $.reply({
    text: { body: "Pick one:" },
    options: { buttons: [btn("opt_1", "Option one"), btn("opt_2", "Option two"), btn("opt_3", "Option three")] },
  })],
  btnmany: ["8 quick replies (wrap)", () => $.reply({
    text: { body: "Lots of choices:" },
    options: { buttons: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => btn(`many_${n}`, `Choice ${n}`)) },
  })],
  btnlong: ["Quick replies with long labels", () => $.reply({
    text: { body: "Long labels:" },
    options: {
      buttons: [
        btn("long_1", "I would like to track my most recent order please"),
        btn("long_2", "Talk to a customer support specialist right now"),
        btn("long_3", "OK"),
      ],
    },
  })],
  url: ["URL button + quick reply", () => $.reply({
    text: { body: "The first button opens a web page and should not send a message:" },
    options: {
      buttons: [
        { code: "site", label: "Open Mehery", type: "URL", url: "https://mehery.com" },
        btn("after_url", "Normal quick reply"),
      ],
    },
  })],

  // Forms
  form1: ["One-field EMAIL card", () => $.reply({
    text: { body: "What's your email address?" },
    options: { inputs: [{ code: "email", name: "email", type: "EMAIL", label: "Email address" }] },
  })],
  form3: ["Name + email + phone card", () => $.reply({
    text: { body: "Please share your details:" },
    options: {
      inputs: [
        { code: "name", name: "name", type: "TEXT", label: "Full name" },
        { code: "email", name: "email", type: "EMAIL", label: "Email" },
        { code: "phone", name: "phone", type: "PHONE", label: "Mobile number" },
      ],
    },
  })],
  formodd: ["Unknown input type only (no card)", () => $.reply({
    text: { body: "This has only a CHECKBOX input. No card should show." },
    options: { inputs: [{ code: "agree", name: "agree", type: "CHECKBOX", label: "I agree" }] },
  })],
  formbtn: ["Input + quick reply together", () => $.reply({
    text: { body: "Enter your email, or skip:" },
    options: { inputs: [{ code: "email", name: "email", type: "EMAIL", label: "Email" }], buttons: [btn("skip", "Skip")] },
  })],

  // Media
  img: ["Image with caption", () => media("image", { link: IMG, caption: "Test image caption" })],
  imgtall: ["Tall portrait image", () => media("image", { link: IMG_TALL })],
  imgbad: ["Broken image URL", () => media("image", { link: IMG_BAD, caption: "This image should fail to load" })],
  imghttp: ["http:// image (upgraded to https)", () => media("image", { link: IMG_HTTP })],
  video: ["Video", () => media("video", { link: VIDEO, caption: "Test video" })],
  audio: ["Audio clip", () => media("audio", { link: AUDIO })],
  doc: ["PDF document", () => media("document", { link: PDF, filename: "test-invoice.pdf", caption: "Test invoice" })],

  // Session
  agent: ["Hand off to agent queue", async () => {
    await say("Connecting you to an agent…");
    return $.session.route({ queue: AGENT_QUEUE });
  }],
  close: ["Close the session", async () => {
    await say("Closing this chat. Send any message to start a new one.");
    return $.session.close();
  }],
  template: ["Send a channel template", () => $.reply({ template: { code: TEMPLATE_CODE } })],
};


// ---- Guided flow: type "start". Eight steps in a line, each ends with a Next button ----
// Stateless on purpose: every Next button carries the next step's code, so nothing is stored.
const next = (n) => ({ buttons: [btn(`step_${n}`, "Next ▶")] });
const header = (n, title) => say(`*Step ${n}/8: ${title}*`);

const FLOW = {
  1: async () => { // Text: rich text, links, emoji, RTL, long
    await header(1, "Text");
    await say("*bold* /italic/ _underline_ ~strike~ `code`");
    await say("https://mehery.com  www.google.com  support@example.com  +91 98765 43210");
    await say("Emoji 😀🎉👍🏽 🇮🇳   Arabic: مرحباً! الطلب رقم 4821 في الطريق إليك.");
    return $.reply({ text: { body: LONG }, options: next(2) });
  },
  2: async () => { // Quick replies: short, long label, wrap. Any tap should send its label.
    await header(2, "Quick replies (tap any; the label should appear as your message)");
    return $.reply({
      text: { body: "Pick one:" },
      options: { buttons: [
        btn("step_3", "Option one"),
        btn("step_3", "Talk to a customer support specialist right now"),
        btn("step_3", "OK"), btn("step_3", "Choice 4"), btn("step_3", "Choice 5"), btn("step_3", "Choice 6"),
      ] },
    });
  },
  3: async () => { // URL button: opens the browser and must NOT send a message
    await header(3, "URL button");
    return $.reply({
      text: { body: "Tap the first button: it should open a web page and send nothing." },
      options: { buttons: [{ code: "site", label: "Open Mehery", type: "URL", url: "https://mehery.com" }, btn("step_4", "Next ▶")] },
    });
  },
  4: async () => { // Form: try empty submit, bad email, short/long phone, then valid
    await header(4, "Form (try empty, a bad email, a bad phone, then valid values)");
    return $.reply({
      text: { body: "Please share your details:" },
      options: { inputs: [
        { code: "name", name: "name", type: "TEXT", label: "Full name" },
        { code: "email", name: "email", type: "EMAIL", label: "Email" },
        { code: "phone", name: "phone", type: "PHONE", label: "Mobile number" },
      ] },
    });
  },
  5: async () => { // Images: captioned, tall, http upgrade, broken
    await header(5, "Images (captioned, tall, http, broken)");
    await media("image", { link: IMG, caption: "Test image caption" });
    await media("image", { link: IMG_TALL });
    await media("image", { link: IMG_HTTP });
    await media("image", { link: IMG_BAD, caption: "This one should fail to load" });
    return $.reply({ text: { body: "Tap an image to open the viewer." }, options: next(6) });
  },
  6: async () => { // Video, audio, document
    await header(6, "Video, audio, document");
    await media("video", { link: VIDEO, caption: "Test video" });
    await media("audio", { link: AUDIO });
    await media("document", { link: PDF, filename: "test-invoice.pdf", caption: "Test invoice" });
    return $.reply({ text: { body: "Play, open and download each one." }, options: next(7) });
  },
  7: async () => { // Timing: burst, then a delayed reply (typing indicator, ordering)
    await header(7, "Burst + 10 second delay (watch the typing indicator)");
    for (let i = 1; i <= 5; i++) await say(`Burst message ${i} of 5`);
    await wait(10000);
    return $.reply({ text: { body: "This came after 10 seconds." }, options: next(8) });
  },
  8: async () => { // Session
    await header(8, "Session");
    return $.reply({
      text: { body: "Last step. Hand off, close, or run the flow again:" },
      options: { buttons: [btn("agent", "Talk to an agent"), btn("close", "Close chat"), btn("start", "Start over")] },
    });
  },
};

CASES.start = ["Guided flow: all 8 UI areas in a line", () => FLOW[1]()];
for (const n of Object.keys(FLOW)) CASES[`step_${n}`] = [`Flow step ${n}`, FLOW[n]];

function menu() {
  const list = Object.keys(CASES).filter((k) => !k.startsWith("step_")).map((k) => `\`${k}\` - ${CASES[k][0]}`).join("\n");
  return $.reply({
    text: { body: `*UI test bot.* Type a code:\n\n${list}` },
    options: { buttons: [btn("start", "start"), btn("btn", "btn"), btn("form3", "form3"), btn("img", "img")] },
  });
}

function onSessionStart() {}
function onSessionRouted() {}

async function onMessageReceive() {
  const key = String($.inbound.getCode() || $.inbound.getText() || "").trim().toLowerCase();
  if (CASES[key]) return CASES[key][1]();

  // Flow step 4's form submit: show what arrived, then carry on to step 5.
  // The echo of the raw message showed form: {} on the server, so detect it by the "Submitted" text.
  if (key === "submitted") {
    // The server puts the card's fields in message.input (message.form stays empty).
    const input = ($.inbound.message && $.inbound.message.input) || {};
    await say(`Form received. Name: ${input.name || "-"}, email: ${input.email || "-"}, phone: ${input.phone || "-"}`);
    return FLOW[5]();
  }

  // Not a code: echo the raw inbound message (minus session) so testers can check what was sent.
  const { session, ...message } = $.inbound.message || {};
  const json = JSON.stringify(message).slice(0, 800);
  return say(`Received:\n\`${json}\`\n\nType *menu* for the test list.`);
}
