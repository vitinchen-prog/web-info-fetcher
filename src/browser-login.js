import { launchPersistentBrowser } from "./lib/browser.js";

const startUrl = process.argv[2] || "https://x.com/home";

console.log("Opening Chrome with a persistent local profile.");
console.log("Log in to X and any other sites you want the collector to access.");
console.log("When you are done, come back here and press Enter to close the browser.");

const context = await launchPersistentBrowser({ headless: false });
const page = context.pages()[0] || (await context.newPage());
await page.goto(startUrl, { waitUntil: "domcontentloaded" });

process.stdin.resume();
process.stdin.once("data", async () => {
  await context.close();
  console.log("Browser profile saved in .auth/browser-profile");
  process.exit(0);
});
