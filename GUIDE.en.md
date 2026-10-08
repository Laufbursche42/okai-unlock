# Guide

> **Important for error reports:** switch on the **Diagnostic log** at the bottom of the page *before* you connect to the scooter. Only then is the full connection handshake captured - and those are exactly the lines we need in a [ticket](https://github.com/Laufbursche42/Laufbursche42/issues) to reproduce a problem.

## What you need
- An OKAI e-scooter (dial-AT family: ea, eb or es models).
- A phone or computer with **Chrome**, **Edge**, or on iOS **Bluefy**. Safari and Firefox cannot do Web Bluetooth.

## Connecting
1. Turn on Bluetooth and wake the scooter.
2. Tap **Connect** and pick the scooter from the list.
3. If it is not listed, tick **Show all devices** and try again. The real check is the Bluetooth service found (0x2C00), not the advertised name.
4. Once connected, the live-values, lock and settings cards appear.

## Reading live values
The scooter replies with AT frames. Each tile shows the raw fields of the last frame for its opcode (battery OKBCL, mileage OKMLK, wheel OKWHS, info OKINF, ambient light OKATL, drive mode OKECP). A dash just means that opcode has not come in yet. Below the tiles, **All received frames** lets you follow every opcode raw. Nothing is decoded into numbers, the fields stay raw.

## Lock
In the **Lock** card you lock or unlock the scooter via the OKSCM command. The command password (default OKAIYLBT) goes with the command. Whether the command takes effect shows in the live reply. A locked scooter can only be unlocked again over Bluetooth.

## More settings
- **Command mode (OKXWM):** normal(0) or test(2). The 0 and 2 values are proven. This command needs the service password (default OKAI_CAR). Test mode puts the scooter into a service state, so use it deliberately.
- **BLE name (OKNAM):** sets the advertised Bluetooth name. The name is free text, the command password goes with it.

## Advanced settings (engine level)
**Build an AT command** takes an opcode and fields and adds the running sequence number and the frame (AT+...$) for you. **Send a raw AT line** sends your line unchanged. The seven opcodes are available as quick buttons.

## Speed
OKAI has no separate km/h speed-limit register. Speed lives in the drive mode / gear (OKECP). So there is no one-tap km/h unlock here, just the drive-mode command and the AT console for your own tests.

## Shortcuts
Copy the link to your home screen, then one tap sends OKSCM unlock or lock directly. On iOS via Bluefy, and the scooter must have been connected normally once before.

## If something does not work
- Cannot connect? Check that the browser supports Web Bluetooth, Bluetooth is on and the scooter is awake. Retry with **Show all devices**.
- Nothing happens after a command? Check the log: if it says "sent" but no "confirmed", the firmware did not acknowledge the frame.
- **Diagnostics: list all devices** in the log area shows every Bluetooth service of a device without writing anything - useful for support.

## Contribute
Want to find out if and how tuning works on your scooter? Test this tool on your own vehicle and open a ticket on [GitHub](https://github.com/Laufbursche42/Laufbursche42/issues) - with your model and what worked (or did not). That way we figure out together what is possible on which model.
