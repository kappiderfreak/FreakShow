FreakShow - eigene HTML-Overlays
================================

DEUTSCH
-------
Lege jedes heruntergeladene HTML-Overlay als eigenen Unterordner hier ab.

Beispiel:
Content\html-overlays\Mein-Chat\index.html

Danach lautet der lokale FreakShow-Link:
http://127.0.0.1:18081/content/html-overlays/Mein-Chat/index.html

Wenn das Overlay Streamer.bot-Parameter nutzt, kannst du die Vorlage
"overlay-link-template.txt" kopieren und HOST sowie PORT ersetzen.

Wichtig:
- Verwende in FreakShow einen http://-Link und keinen file:///-Link.
- HOST ist die IP des PCs, auf dem Streamer.bot laeuft.
- PORT ist der WebSocket-Port von Streamer.bot, normalerweise 8080 oder 8081.
- In Streamer.bot muss der WebSocket-Server eingeschaltet sein.
- Der Ordner eines fremden Overlays muss immer vollstaendig kopiert werden,
  einschliesslich scripts, styles, fonts und weiterer Unterordner.

ENGLISH
-------
Place every downloaded HTML overlay in its own subfolder here.

Example:
Content\html-overlays\My-Chat\index.html

Its local FreakShow URL is then:
http://127.0.0.1:18081/content/html-overlays/My-Chat/index.html

If the overlay accepts Streamer.bot parameters, copy
"overlay-link-template.txt" and replace HOST and PORT.

Important:
- Use an http:// URL in FreakShow, not a file:/// URL.
- HOST is the IP address of the PC running Streamer.bot.
- PORT is the Streamer.bot WebSocket port, commonly 8080 or 8081.
- The WebSocket server must be enabled in Streamer.bot.
- Always copy the complete third-party overlay folder, including scripts,
  styles, fonts and all other subfolders.
