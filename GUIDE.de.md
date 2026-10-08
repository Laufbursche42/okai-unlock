# Anleitung

> **Wichtig für Fehler-Reports:** Schalte unten auf der Seite den **Diagnose-Log** ein, *bevor* du dich mit dem Scooter verbindest. Nur dann wird der komplette Verbindungsaufbau mitgeschnitten - und genau diese Zeilen brauchen wir in einem [Ticket](https://github.com/Laufbursche42/Laufbursche42/issues), um ein Problem nachzuvollziehen.

## Was du brauchst
- Einen OKAI E-Scooter (dial-AT-Familie: ea-, eb- oder es-Modelle).
- Ein Handy oder einen Rechner mit **Chrome**, **Edge** oder auf iOS **Bluefy**. Safari und Firefox können kein Web Bluetooth.

## Verbinden
1. Bluetooth am Gerät einschalten, den Scooter einschalten (wecken).
2. Auf **Verbinden** tippen und den Scooter in der Liste auswählen.
3. Taucht er nicht auf, setze den Haken bei **Alle Geräte zeigen** und verbinde erneut. Der echte Test ist der gefundene Bluetooth-Dienst (0x2C00), nicht der angezeigte Name.
4. Nach dem Verbinden erscheinen die Karten für Live-Werte, Sperre und Einstellungen.

## Live-Werte lesen
Der Scooter antwortet mit AT-Frames. Jede Kachel zeigt die rohen Felder des letzten Frames ihres Opcodes (Akku OKBCL, Kilometer OKMLK, Rad OKWHS, Info OKINF, Umgebungslicht OKATL, Fahrmodus OKECP). Ein Strich heißt nur, dass dieser Opcode noch nicht kam. Unter den Kacheln kannst du mit **Alle empfangenen Frames** jeden Opcode roh mitlesen. Es wird nichts in Zahlen umgerechnet, die Felder bleiben roh.

## Sperre
In der Karte **Sperre** sperrst oder entsperrst du den Scooter über den Befehl OKSCM. Das Befehls-Passwort (voreingestellt OKAIYLBT) geht mit in den Befehl. Ob der Befehl wirkt, siehst du an der Live-Antwort. Einen gesperrten Scooter kannst du nur über Bluetooth wieder entsperren.

## Weitere Einstellungen
- **Befehlsmodus (OKXWM):** normal(0) oder test(2). Die Werte 0 und 2 sind belegt. Dieser Befehl braucht das Service-Passwort (voreingestellt OKAI_CAR). Der Testmodus schaltet den Roller in einen Service-Zustand, also nur bewusst nutzen.
- **BLE-Name (OKNAM):** setzt den angezeigten Bluetooth-Namen. Der Name ist frei, das Befehls-Passwort geht mit.

## Erweiterte Einstellungen (Engine-Ebene)
**AT-Befehl bauen** nimmt Opcode und Felder und ergänzt die laufende Sequenznummer sowie den Rahmen (AT+...$) selbst. **Rohe AT-Zeile** sendet deine Zeile unverändert. Die sieben Opcodes stehen als Schnell-Knöpfe bereit.

## Geschwindigkeit
OKAI hat kein eigenes km/h-Tempolimit-Register. Die Geschwindigkeit steckt im Fahrmodus bzw. Gang (OKECP). Darum gibt es hier kein Ein-Tipp-Entsperren in km/h, sondern den Fahrmodus-Befehl und die AT-Konsole für eigene Versuche.

## Shortcuts
Kopiere den Link auf den Startbildschirm, dann sendet ein Tipp direkt OKSCM ent- oder sperren. Auf iOS über Bluefy, und der Scooter muss vorher einmal normal verbunden gewesen sein.

## Wenn etwas nicht geht
- Kein Verbinden? Prüfe, dass der Browser Web Bluetooth kann, Bluetooth an ist und der Scooter wach ist. Mit **Alle Geräte zeigen** erneut versuchen.
- Nichts passiert nach einem Befehl? Schau ins Log: steht dort "gesendet" aber kein "bestätigt", hat die Firmware das Frame nicht quittiert.
- **Diagnose: alle Geräte auflisten** im Log-Bereich zeigt alle Bluetooth-Dienste eines Geräts, ohne etwas zu schreiben - hilfreich für Support.

## Mithelfen
Willst du herausfinden, ob und wie Tuning bei deinem Scooter geht? Teste dieses Tool an deinem eigenen Fahrzeug und öffne ein Ticket auf [GitHub](https://github.com/Laufbursche42/Laufbursche42/issues) - mit deinem Modell und was funktioniert hat (oder nicht). So finden wir gemeinsam heraus, was bei welchem Modell möglich ist.
