/**
 * Media test bot: one smooth line through every media type the app draws.
 * Type "media" (or anything) to begin; tap Next (or type "next") to advance. "restart" starts over.
 * Paste into the scriptus editor and Save. Set TEMPLATE_CODE to an approved template on this channel.
 */
const TEMPLATE_CODE = "YOUR_TEMPLATE_CODE";
const TEMPLATE_DATA = {}; // fill if the template has variables, e.g. { name: "Neil" }

// ponytail: public sample files; move to your own CDN/S3 if any go down.
const IMG = "https://dummyimage.com/800x600/e4e4e7/3f3f46.png&text=Test+Image";
const IMG_TALL = "https://dummyimage.com/400x1200/174ea6/ffffff.png&text=Tall+Image";
// A real photograph (JPEG, 70 KB, checked 200). The broken-image tile can't be tested through the live server:
// it drops links it can't fetch, so test that in the app's Mock channel instead.
const IMG_PHOTO = "https://picsum.photos/id/237/800/600.jpg";
// MDN samples: checked 200 with the right content type (audio/mpeg 40 KB, video/mp4 1.1 MB).
// The googleapis video, soundhelix mp3 and w3schools files never reached the app (w3schools 403s non-browsers).
const VIDEO = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
const AUDIO = "https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3";
const PDF = "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";

const btn = (code, label) => ({ code, label });
const say = (body) => $.reply({ text: { body } });
// ponytail: WhatsApp Cloud shape ({ link, caption }) plus `url` as a fallback key; the XMS adapter
// forwards image/video/document/audio untouched. If media arrives empty, check XMS's media schema.
const media = (type, link, extra) => $.reply({ [type]: { link, url: link, ...(extra || {}) } });

const STEPS = [
  ["Image with caption", () => media("image", IMG, { caption: "Caption under the image" })],
  ["Tall image, no caption (tap to open the viewer)", () => media("image", IMG_TALL)],
  ["Photo (real JPEG)", () => media("image", IMG_PHOTO, { caption: "A real photo" })],
  ["Video (tap to play)", () => media("video", VIDEO, { caption: "Test video" })],
  ["Audio clip", () => media("audio", AUDIO)],
  ["PDF document (tap to open)", () => media("document", PDF, { filename: "test-invoice.pdf", caption: "Test invoice" })],
  ["Template", () => $.reply({ template: { code: TEMPLATE_CODE, data: TEMPLATE_DATA } })],
];

// Session start is a separate event that arrives alongside the first message, and onMessageReceive
// already answers that message. Running the flow here too sent every step twice (seen in the server
// history: two runs ~1.5 s apart). $.store.local can't dedupe it: each run reads a snapshot taken
// when it started, so neither sees the other's write. So this stays empty on purpose.
function onSessionStart() {}
function onSessionRouted() {}

// Scriptus remembers a pending .listen(handler) per contact, even after you swap the bot's code.
// The simple bot leaves onDetails / onMood / onAgent pending; without these the next message calls a
// function that no longer exists and the bot stays silent. Route them all into this bot.
function onDetails() { return onMessageReceive(); }
function onMood() { return onMessageReceive(); }
function onAgent() { return onMessageReceive(); }

async function onMessageReceive() {
  const code = String($.inbound.getCode() || "");
  const text = String($.inbound.getText() || "").trim().toLowerCase();
  let step = Number(await $.store.local.get("mediaStep")) || 0;

  if (/^m\d+$/.test(code)) step = Number(code.slice(1)); // Next button carries the step to show
  else if (text === "next") step += 1;
  else step = 0; // "media", "restart", or anything else: from the top

  if (step >= STEPS.length) {
    await $.store.local.set("mediaStep", 0);
    return $.reply({ text: { body: "*All media shown.* Run it again?" }, options: { buttons: [btn("m0", "Restart")] } });
  }

  await $.store.local.set("mediaStep", step);
  const [title, send] = STEPS[step];
  await say(`*${step + 1}/${STEPS.length}: ${title}*`);
  await send();
  return $.reply({ text: { body: "Check it, then continue." }, options: { buttons: [btn(`m${step + 1}`, "Next ▶")] } });
}
