import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { config } from "dotenv";
import { chromium } from "playwright";
import { TwitterApi } from "twitter-api-v2";

config();

type Env = {
  dryRun: boolean;
  ollamaBaseUrl: string;
  ollamaModel: string;
  pullModelOnStart: boolean;
  scrapeUrl: string;
  runOnce: boolean;
  postIntervalMinutes: number;
  twitter: {
    appKey?: string;
    appSecret?: string;
    accessToken?: string;
    accessSecret?: string;
  };
};

const readBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (!value) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

const readNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const env: Env = {
  dryRun: readBoolean(process.env.DRY_RUN, true),
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://ollama:11434",
  ollamaModel: process.env.OLLAMA_MODEL ?? "llama3",
  pullModelOnStart: readBoolean(process.env.OLLAMA_PULL_ON_START, true),
  scrapeUrl: process.env.SCRAPE_URL ?? "https://news.ycombinator.com",
  runOnce: readBoolean(process.env.RUN_ONCE, true),
  postIntervalMinutes: readNumber(process.env.POST_INTERVAL_MINUTES, 30),
  twitter: {
    appKey: process.env.TWITTER_APP_KEY,
    appSecret: process.env.TWITTER_APP_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_SECRET,
  },
};

const ensureModel = async (): Promise<void> => {
  if (!env.pullModelOnStart) {
    return;
  }

  const response = await fetch(`${env.ollamaBaseUrl}/api/pull`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: env.ollamaModel, stream: false }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to pull Ollama model ${env.ollamaModel}: ${response.status} ${body}`);
  }

  console.log(`[agent] Ollama model ready: ${env.ollamaModel}`);
};

const collectContextWithPlaywright = async (): Promise<string> => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(env.scrapeUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

    const title = (await page.title()).trim();
    const firstHeading = ((await page.locator("h1").first().textContent()) ?? "").trim();
    const firstParagraph = ((await page.locator("p").first().textContent()) ?? "").trim();

    return [
      `Source URL: ${env.scrapeUrl}`,
      `Page title: ${title || "N/A"}`,
      `First heading: ${firstHeading || "N/A"}`,
      `First paragraph: ${firstParagraph || "N/A"}`,
    ].join("\n");
  } finally {
    await browser.close();
  }
};

const generateTweet = async (context: string): Promise<string> => {
  const prompt = [
    "Write one tweet for OpenClaw.",
    "Requirements:",
    "- Under 280 characters",
    "- Friendly and informative tone",
    "- No emojis",
    "- Include one relevant hashtag",
    "Use this context:",
    context,
  ].join("\n");

  const response = await fetch(`${env.ollamaBaseUrl}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: env.ollamaModel, prompt, stream: false }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama generation failed: ${response.status} ${body}`);
  }

  const json = (await response.json()) as { response?: string };
  const cleaned = (json.response ?? "").replace(/^"|"$/g, "").replace(/\s+/g, " ").trim();

  if (!cleaned) {
    throw new Error("Ollama returned an empty tweet.");
  }

  return cleaned.slice(0, 280);
};

const getTwitterClient = () => {
  const { appKey, appSecret, accessToken, accessSecret } = env.twitter;
  if (!appKey || !appSecret || !accessToken || !accessSecret) {
    return undefined;
  }

  return new TwitterApi({
    appKey,
    appSecret,
    accessToken,
    accessSecret,
  });
};

const postTweet = async (tweet: string): Promise<void> => {
  const client = getTwitterClient();

  if (env.dryRun || !client) {
    console.log("[agent] DRY_RUN enabled or Twitter credentials missing; not posting.");
    console.log(`[agent] Generated tweet: ${tweet}`);
    return;
  }

  const result = await client.v2.tweet(tweet);
  console.log(`[agent] Tweet posted successfully with id ${result.data.id}`);
};

const runCycle = async (): Promise<void> => {
  const context = await collectContextWithPlaywright();
  const tweet = await generateTweet(context);
  await postTweet(tweet);
};

const main = async (): Promise<void> => {
  await ensureModel();

  let shouldContinue = true;
  while (shouldContinue) {
    await runCycle();

    if (env.runOnce) {
      shouldContinue = false;
      continue;
    }

    const delayMs = env.postIntervalMinutes * 60_000;
    console.log(`[agent] Sleeping for ${env.postIntervalMinutes} minute(s)...`);
    await sleep(delayMs);
  }
};

main().catch((error) => {
  console.error("[agent] Fatal error:", error);
  process.exitCode = 1;
});
