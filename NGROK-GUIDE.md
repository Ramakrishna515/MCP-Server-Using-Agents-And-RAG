# NGROK GUIDE

Public access to the local MCP server for live demos.

## What this is
`ngrok` exposes your local `mcp-server` (running on port 4001) to the internet
through a secure public URL, so you can demo the web portal / MCP endpoints to
anyone without publishing your machine.

## Install
```bash
brew install ngrok/ngrok/ngrok          # Homebrew cask (already installed: 3.39.11)
ngrok version
```

## First-time setup (authtoken)
ngrok requires an account token before it will start tunnels.

```bash
ngrok config add-authtoken <YOUR_NGROK_AUTHTOKEN>
ngrok config check
```
Config file (macOS): `~/Library/Application Support/ngrok/ngrok.yml`
(older/Linux path: `~/.config/ngrok/ngrok.yml`)

## Tunnel the running server
The MCP server must be running first (see RUN-GUIDE.md).

```bash
ngrok http 4001 --log=stdout
```
- Dashboard / request inspector: <http://127.0.0.1:4040>
- The public HTTPS URL is printed on startup, e.g.:

```
started tunnel url=https://bulb-cold-edging.ngrok-free.dev
```

## Non-interactive start (background)
```bash
nohup ngrok http 4001 --log=stdout > /tmp/ngrok.log 2>&1 &
# get the current public URL
curl -s http://127.0.0.1:4040/api/tunnels \
  | python3 -c 'import sys,json;[print(t["public_url"]) for t in json.load(sys.stdin)["tunnels"]]'
```

## Demo notes
- The demo URL is ephemeral and **changes on every restart** unless you reserve
  a static domain (paid) or reuse `--url=<fixed-name>`.
- Test publicly with:
  ```bash
  curl -sI https://<ngrok-url>/        # expect HTTP 200
  ```
- Share the ngrok URL (not `localhost:4001`). Point MCP clients at
  `<ngrok-url>` as the server/transport endpoint.
- Free plan: URL has an interstitial warning page for browser visits on some
  plans; API/MCP clients connect directly.

## Stop
```bash
pkill -f "ngrok http"
```

## Current live URL (started 2026-09-28)
```
https://bulb-cold-edging.ngrok-free.dev  ->  http://localhost:4001  (HTTP 200 verified)
```