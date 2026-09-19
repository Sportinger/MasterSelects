[Back to Documentation Index](./README.md)

# LAN Device Testing

Runs the dev server against a real phone or tablet on the same Wi-Fi, so
WebGPU, WebCodecs, touch input, and export can be verified on hardware the
development machine does not have — an iPad or iPhone running Safari, or an
Android device. The [AI bridge](./AI-Bridge-Control.md) works unchanged
across the network, so an agent on the development machine can screenshot,
click, read stats, and drive chat on the remote device.

Safari on iPadOS/iOS 26 ships stable WebGPU and full WebCodecs, which makes
it a meaningful target for the render and export pipeline. It is *not* a
substitute for macOS Safari: different memory limits, different file APIs,
no desktop drag and drop.

The editor supplies pointer-native replacements for the desktop interactions
that Safari does not synthesize: clip move and trim, ruler/playhead scrubbing,
two-finger timeline zoom, long-press context menus, and Media Panel-to-Timeline
dragging. The Media Panel Import control opens iPadOS/iOS photo and video
selection through a directly activated file input; only user-selected media is
exposed to the page. Phones and tablets run the same docked editor shell as
desktop browsers; there is no separate mobile UI.

### Full-screen iPad web app

For an app-like window without Safari's address and toolbar chrome, open the
LAN editor in Safari, choose **Share → More → Add to Home Screen**, enable
**Open as Web App**, and launch MasterSelects from the new Home Screen icon.
The icon keeps the current LAN address, so recreate it if the development
machine's IP changes. In a normal Safari tab, **Page Menu → More → Hide
Toolbar** is temporary and the toolbar can reappear. See Apple's
[iPad web-app instructions](https://support.apple.com/de-de/guide/ipad/ipad8f1f7a29/ipados).

## Why HTTPS is mandatory

WebGPU, WebCodecs, and `SharedArrayBuffer` all require a secure context.
`http://<lan-ip>:5173` is not one, so a plain-HTTP LAN server hands the
device a crippled app: the engine reports `WebGPU Initialization Failed` and
nothing renders.

LAN mode is therefore HTTPS-only. If the TLS pair is missing, `vite.config.ts`
aborts the start with a generation command rather than serving a degraded app.

## Certificate: the 398-day rule

**Apple enforces a maximum certificate validity of 398 days** (iOS 13+ /
macOS 10.15+). A violation is a *fatal* TLS error with no click-through
warning page. Safari reports it as:

> Safari cannot open the page because the network connection was lost.

That message reads like a network fault and sends you hunting through
firewalls and routers. It is a certificate error.

`mkcert` issues leaf certificates with ~823 days validity, targeting the
older 825-day limit, so **an out-of-the-box mkcert certificate fails on
Apple devices**.

`npm run cert:lan` handles this: it detects the current private IPv4, signs a
397-day leaf with the existing mkcert CA, verifies the chain, and warns when
the Windows network profile is `Public`. Pass an address to override
detection (`npm run cert:lan -- 192.168.1.42`).

The address is baked into the certificate, so **every network change needs a
reissue** — moving between Wi-Fi and a phone hotspot invalidates it and
produces a certificate warning. Rerun `cert:lan`, then restart `dev:lan`. The
root CA is unchanged, so devices need no reinstallation.

Equivalent manual steps, for reference:

```bash
mkcert -install                     # once: install the local CA in the OS store
cd .certs

cat > lan-ext.cnf <<'EOF'
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:localhost, IP:<lan-ip>, IP:127.0.0.1, IP:0:0:0:0:0:0:0:1
EOF

CAROOT=$(mkcert -CAROOT)
openssl req -new -newkey rsa:2048 -nodes -keyout lan-key.pem -out lan.csr \
  -subj "//CN=MasterSelects LAN dev"
openssl x509 -req -in lan.csr -CA "$CAROOT/rootCA.pem" -CAkey "$CAROOT/rootCA-key.pem" \
  -CAcreateserial -out lan-cert.pem -days 397 -sha256 -extfile lan-ext.cnf
rm lan.csr

cp "$CAROOT/rootCA.pem" rootCA.pem
```

`.certs/` is gitignored — this repository is public and the directory holds
private keys. Verify with `openssl verify -CAfile rootCA.pem lan-cert.pem`
and `openssl x509 -in lan-cert.pem -noout -dates`.

The certificate covers a fixed IP. A DHCP move invalidates it, so reserve
the development machine's address in the router.

## Starting the server

```bash
npm run dev:lan            # detects the private IPv4 automatically
npm run dev:lan -- --lan=192.168.2.229   # or pin it
```

`--lan` sets `MASTERSELECTS_LAN_HOST`, which makes `vite.config.ts` bind all
interfaces, serve TLS from `.certs/`, and add the address to `allowedHosts`.
Plain `npm run dev` and `npm run dev:full` are unaffected: still HTTP, still
localhost-only.

`server.hmr` is deliberately left unconfigured. On a single port Vite derives
the HMR/bridge websocket from `location`, which keeps `https://localhost:5173`
and `https://<lan-ip>:5173` both working. Pinning `hmr.host` breaks localhost.

Only port 5173 is exposed. The kernel (8787), the Pages API (8788), and the
Logic app-server (4500) stay bound to `127.0.0.1`; devices reach the kernel
through the same-origin `/api/kernel` proxy.

### Windows host

Inbound LAN connections need both of these, in an elevated shell:

```powershell
Set-NetConnectionProfile -InterfaceAlias "WLAN" -NetworkCategory Private
New-NetFirewallRule -DisplayName "MasterSelects Dev 5173" -Direction Inbound `
  -LocalPort 5173 -Protocol TCP -Action Allow -Profile Private
```

A `Public` network profile blocks inbound traffic regardless of any rule.

## Trusting the CA on the device

The device cannot complete a TLS handshake before it trusts the CA, so the
root certificate is served over plain HTTP by `/dev-root-ca.pem`. That route
is registered whenever `.certs/rootCA.pem` exists, including under plain
`vite --host`, precisely to break that circle. It serves the public CA
certificate only, as `application/x-x509-ca-cert` — iOS offers the
profile-install flow only for that MIME type; as a download the file lands in
Files and can never become a trusted root.

On iPadOS/iOS, in **Safari** (profiles cannot be installed from other browsers):

1. Open `http://<lan-ip>:5173/dev-root-ca.pem` → *Allow* the profile download.
2. Settings → General → **VPN & Device Management** → the mkcert profile →
   **Install**. `Not Verified` in red is expected for a self-signed root.
3. Settings → General → **About** → bottom → **Certificate Trust Settings** →
   enable the switch for the mkcert root.

Step 3 is separate from step 2 and is the usual point of failure: the
certificate is installed, the switch is off, and Safari keeps showing the
same privacy warning.

## Reaching the device from an agent

The dev server writes its actual origin to `.ai-bridge-url` next to
`.ai-bridge-token`, and `scripts/masterselects-mcp.mjs` reads it per request,
adding `.certs/rootCA.pem` as the CA for HTTPS. Bridge access therefore
follows LAN mode automatically; `.mcp.json` hardcodes no protocol.
`MASTERSELECTS_BRIDGE_URL` still overrides it when set.

Over raw HTTP the same applies:

```bash
curl --cacert .certs/rootCA.pem -H "Authorization: Bearer $(cat .ai-bridge-token)" \
  https://localhost:5173/api/agent-control/sessions
```

More than one tab is usually connected. Identify the device tab by its `url`
and pass an explicit session target on every call.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Safari cannot open the page because the network connection was lost` | Certificate violates Apple's 398-day limit. Reissue the leaf. |
| `This Connection Is Not Private` | CA installed but *Certificate Trust Settings* switch is off, or never installed. |
| Page times out, no TCP connection reaches the host | Windows network profile is `Public`, or the firewall rule is missing. |
| `WebGPU Initialization Failed` on the device | Served over plain HTTP — no secure context. |
| Refreshing re-downloads the certificate | The address bar still points at `/dev-root-ca.pem`. Navigate to the site root. |
| `curl: (60) schannel: the revocation status is unknown` | Windows curl artifact, not a certificate fault. Add `--ssl-no-revoke`. |
| Bridge returns 401 | Token rotated on dev server restart. Re-read `.ai-bridge-token`. |

Confirm a healthy device session with `getStats`: `engineReady: true` proves
WebGPU actually initialised, which the absence of an error banner does not.
