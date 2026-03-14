# Twitter Agent (Ollama + Playwright)

This example runs a simple Twitter/X posting agent that:

1. Scrapes context from a web page using Playwright.
2. Generates a tweet with Ollama (`llama3` by default).
3. Posts via `twitter-api-v2` (or logs output in dry-run mode).

## Run with Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

Run those commands from `examples/twitter-agent`.

## Configuration

- `DRY_RUN=true`: log tweets instead of posting.
- `RUN_ONCE=true`: generate a single tweet and exit.
- `RUN_ONCE=false`: keep generating tweets every `POST_INTERVAL_MINUTES`.
- Set all `TWITTER_*` variables and `DRY_RUN=false` to publish tweets.
