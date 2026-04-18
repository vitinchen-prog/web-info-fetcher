import { fetchPageInfo } from "./lib/fetch-page-info.js";

const url = process.argv[2];

if (!url) {
  console.log("Usage: npm start -- <url>");
  console.log("Example: npm start -- https://example.com");
  process.exit(1);
}

async function main() {
  const result = await fetchPageInfo(url);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
