# Laufbursche OKAI unlock

A static web page that talks to OKAI e-scooters over Web Bluetooth. Connect, watch the live AT replies and - straight from the browser - send the proven OKAI commands: lock and unlock (OKSCM), switch the command mode (OKXWM), set the BLE name (OKNAM) and build any AT frame by hand. Nothing to install: no app store, no signing, no developer account. It runs in **Bluefy** on iOS and in **Chrome** or **Edge** on Android or desktop.

> **This is a feasibility study - the transport is proven, the per-command field values are not.** It exists to show what OKAI's Bluetooth protocol makes possible, not to be a finished product. The protocol was reconstructed from the official app (`com.yele.app.bleoverseascontrol`): the GATT service `0x2C00` with write characteristic `0x2C01` and notify characteristic `0x2C03` (shared by all 25 dial-AT models), the plaintext `AT+<opcode>=<fields>,<seq>$` framing with no encryption, MAC or replay protection, the command password `OKAIYLBT` and the service password `OKAI_CAR`, and the seven command opcodes are all verified in the code. **Reading works:** every reply the scooter sends is parsed and shown verbatim. What is **not** proven from the app is the exact positional field layout of each command - which value of OKSCM locks versus unlocks, the OKECP gear/speed numbers, the byte offsets inside each telemetry reply. So this page sends only real opcodes in the real frame with the real passwords, treats any unproven field value as a disclosed assumption, gates the risky writes behind a confirm box and never fakes a decoded number. Whether the firmware honors a write - or enforces bonding of its own - sits in the controller and must be tested on the device. Error-free operation is not promised and there is no warranty of any kind. Whatever you do with it, you do at your own risk - read the [Legal](#legal) section before you connect a scooter.

**Open the web app: [laufbursche42.github.io/okai-unlock](https://laufbursche42.github.io/okai-unlock/)**

Or run it yourself, no build step and no dependencies: clone the repo and serve the folder over a local HTTP server. Opening `index.html` directly as a `file://` URL will not work, the page fetches its own documents and browsers block that over `file://`.

```
git clone https://github.com/Laufbursche42/okai-unlock.git
cd okai-unlock
python -m http.server 8000
```

Any static server works. With Node installed, this does the same job:

```
npx serve .
```

Then open the printed address in a browser that supports Web Bluetooth.

**Guide: [Deutsch](GUIDE.de.md) | [English](GUIDE.en.md)** covers everything step by step, from connecting to the first send.

## What it does

- **Live values** - the raw AT fields the scooter reports per opcode (battery OKBCL, mileage OKMLK, wheel OKWHS, info OKINF, firmware OKATL, drive mode OKECP), plus an all-frames view of every received opcode. Nothing is decoded into numbers; the fields are shown raw.
- **Lock** - lock/unlock via `OKSCM`, with the command password in the payload. The exact value is an assumption and is confirm-gated.
- **More settings** - command mode normal(0)/test(2) via `OKXWM` (the 0/2 values are proven) gated by the `OKAI_CAR` service password, and BLE name via `OKNAM`.
- **Expert** - build any AT frame from an opcode plus fields (the sequence number and the `AT+...$` wrapper are added for you), or send a raw AT line verbatim. The seven proven opcodes are quick-insert buttons.
- **Shortcut** - a home-screen link that sends OKSCM unlock or lock in a single tap.

## Protocol (proven)

- Service `0x2C00`, write characteristic `0x2C01`, notify/report characteristic `0x2C03`. No pairing, no PIN handshake.
- Frame: `AT+` + 5-char opcode + `=` + fields joined by `,` + `,` + 4-hex-digit sequence + `$\r\n` (DefaultPacker.packAT). The sequence is a plain incrementing 16-bit counter, framing not a nonce.
- Auth: command password `OKAIYLBT` placed in the command payload; service password `OKAI_CAR` gates the OKXWM normal(0)/test(2) command mode.
- TX opcodes: `OKECP` drive mode/gear, `OKSCM` lock/unlock, `OKSCT` power, `OKXWM` command mode, `OKNAM` set name, `OKURD` OTA chunk, `OKPWD` password check.

## Honesty

Device-untested by design - you test on your own scooter, which is exactly the point of a public tool. The transport is proven; the per-command field values and the telemetry byte offsets are **not** proven from the app and are marked as such throughout. An echo in the log means the scooter **accepted** the frame; only a changed value in the live replies proves it actually took effect.

## Legal

License: PolyForm Noncommercial, see [License](LICENSE.md). Privacy: nothing leaves your device, see [Privacy](PRIVACY.md). Trademarks: OKAI is a trademark of its respective owner, this project is independent, see [Trademarks](TRADEMARKS.md).

Source: https://github.com/Laufbursche42/okai-unlock
