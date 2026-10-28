// Scénarios de survol/popovers : renvoie les problèmes de débordement trouvés.
const A = window.__accord, S = A.state, out = {};
const wait = (ms) => A.settle(ms);
document.querySelectorAll(".message-toolbar.open").forEach((t) => t.classList.remove("open"));
const visibleMsgs = () => [...document.querySelectorAll(".message:not(.system)")].filter(m => { const r = m.getBoundingClientRect(); const sc = document.querySelector(".messages-scroller").getBoundingClientRect(); return r.top >= sc.top && r.bottom <= sc.bottom; });
const g = Object.values(S.guilds).find(g => g.name === "Walt");
const gen = S.guildChannels[g.id].map(id => S.channels[id]).find(c => c.name === "general");
A.actions.openChannel(gen.id); await wait(2000);
for (const [label, pick] of [["haut", m => m[0]], ["bas", m => m[m.length - 1]]]) {
  const m = pick(visibleMsgs()); if (!m) continue;
  m.dispatchEvent(new MouseEvent("mouseenter")); const tb = m.querySelector(".message-toolbar"); tb.classList.add("open"); await wait(100);
  out[`toolbar-${label}`] = A.checkOverflow();
  tb.querySelector("button[title='Add reaction']").click(); await wait(300);
  out[`picker-${label}`] = A.checkOverflow();
  document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); tb.classList.remove("open"); await wait(200);
}
const last = visibleMsgs().pop();
last.querySelector(".author-name")?.click(); await wait(1500);
out.profileMessage = A.checkOverflow(); A.setUi("profile", null); await wait(100);
last.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: innerWidth - 5, clientY: innerHeight - 5 })); await wait(200);
out.contextCorner = A.checkOverflow(); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await wait(100);
document.querySelector(".user-panel-identity").click(); await wait(200);
out.statusMenu = A.checkOverflow(); document.body.click(); await wait(100);
const ta = document.querySelector(".composer textarea"); ta.focus(); ta.value = "@e"; ta.setSelectionRange(2, 2); ta.dispatchEvent(new InputEvent("input", { bubbles: true })); await wait(300);
out.autocomplete = [document.querySelector(".autocomplete") ? "ok" : "absent", ...A.checkOverflow()];
ta.value = ""; ta.dispatchEvent(new InputEvent("input", { bubbles: true }));
if (!document.querySelector(".member-list")) document.querySelector(".header-actions .icon-button").click(); await wait(2000);
const rows = [...document.querySelectorAll(".member-list .member-row")].filter(r => r.getBoundingClientRect().bottom < innerHeight);
rows[rows.length - 1]?.click(); await wait(1500);
out.profileMemberBottom = A.checkOverflow(); A.setUi("profile", null);
A.setUi("quickSwitcher", true); await wait(300); out.switcher = A.checkOverflow(); A.setUi("quickSwitcher", false);
document.querySelector(".user-panel .icon-button[title=Settings]").click(); await wait(300); out.settings = A.checkOverflow();
document.querySelector(".settings-close").click();
out.errors = A.errors.slice();
return out;
