# F5 BIG-IP — ERR_HTTP2_PROTOCOL_ERROR Fix

## Symptom

```
The webpage at https://leeks.miku.rip/ might be temporarily down
or it may have moved permanently to a new web address.
ERR_HTTP2_PROTOCOL_ERROR
```

---

## Root Cause

F5 BIG-IP's HTTP/2 profile is applied to **both** client-side and server-side connections. Node.js/Express only speaks HTTP/1.1. When F5 tries to forward requests to the Node.js backend using HTTP/2, the connection fails.

```
Browser ──HTTPS/HTTP2──▶ F5 BIG-IP ──HTTP/2 (BUG!)──▶ Node:3000
                                      should be HTTP/1.1
```

**What it should look like:**

```
Browser ──HTTPS/HTTP2──▶ F5 BIG-IP ──HTTP/1.1 (correct)──▶ Node:3000
```

---

## Fix: F5 BIG-IP Configuration

### Step 1 — Check the Virtual Server Profiles

In **F5 TMUI** or via SSH:

```bash
tmsh list ltm virtual <your-vs-name> profiles
```

**Broken configuration looks like:**
```
http2 { }
# No context = applies to BOTH client-side and server-side
```

**Correct configuration should look like:**
```
http2 { context clientside }    # HTTP/2 only for browsers
http  { context serverside }    # HTTP/1.1 for Node.js backend
```

---

### Step 2 — Fix via TMUI (GUI)

1. Go to **Local Traffic → Virtual Servers → `<your VS name>`**
2. Click the **Resources** tab
3. Under **HTTP Profiles (Client)** → keep `http2`
4. Under **HTTP Profiles (Server)** → set to `http` (HTTP/1.1)
5. Click **Update**

---

### Step 3 — Fix via tmsh (CLI)

```bash
# Apply http2 to client-side only, http/1.1 to server-side
tmsh modify ltm virtual <your-vs-name> \
  profiles add { http2 { context clientside } http { context serverside } }

# Save the configuration
tmsh save sys config
```

---

### Step 4 — Verify Pool Member Health

```bash
# Check if Node.js backend is marked UP in the pool
tmsh show ltm pool <your-pool-name> members detail | grep -E "Availability|State|Addr"
```

---

## Verify Node.js is Reachable

Test directly from the Windows Server to confirm Node.js is running and accessible:

```powershell
Invoke-WebRequest http://localhost:3000 -UseBasicParsing
```

If this returns `200 OK`, the issue is 100% in F5 configuration.

---

## Additional Checks

### SSL Offloading (Most Common Setup)

If F5 terminates HTTPS and sends plain HTTP to Node.js:

1. Node.js should listen on `http://` only (no TLS in Node) — **currently correct** ✅
2. Pool member port in F5 must match `PORT` in `.env` (default: `3000`)
3. F5 should send `X-Forwarded-Proto: https` header so the app knows the original protocol

### Check iRule or Policy Interference

If an iRule or local traffic policy is attached to the Virtual Server, it may be manipulating HTTP/2 frames incorrectly. Review any iRules for `HTTP::` commands that may conflict.

```bash
tmsh list ltm virtual <your-vs-name> rules
```

### Verify the HTTP/2 Profile Settings

```bash
tmsh list ltm profile http2 <your-http2-profile-name>
```

Ensure `connection-mode` is set to `proxy` (default), not `multi-stream` or custom.

---

## Summary Table

| Component | Protocol | Notes |
|-----------|----------|-------|
| Browser → F5 | HTTPS / HTTP2 | F5 HTTP/2 client profile |
| F5 → Node.js | HTTP/1.1 | F5 HTTP server profile (plain `http`) |
| Node.js listen | HTTP/1.1 | Express default, no TLS needed |
| Port | 3000 (default) | Set via `PORT` in `.env` |
