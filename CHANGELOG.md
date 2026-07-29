# FreakShow – Änderungen

## 1.2.5

### Neu

- Roter Teppich: **Standard-User** ★ – ein Eintrag, der für alle Zuschauer ohne eigenen Eintrag gilt; es regnet automatisch deren eigenes Profilbild (Knopf im Hinzufügen-Fenster, dreisprachig)
- **zentrale Anbieter-Tabelle** (`app/overlay-providers.json`): alle Anbieter-Sonderbehandlungen an einer Stelle – ein neuer Software-Hersteller ist nur noch ein Tabelleneintrag
- **Vorschau-Proxy**: Anbieter mit Einbettungssperre (z. B. Voicemod) erscheinen jetzt auch in der Vorschau der Steuerseite, nicht nur im Overlay
- Overlay-Gruppen wie bei den Notizen: Klick auf die Gruppe zeigt alle Mitglieder, rechts wählt man das Element, das man bewegen will; Klick auf ein einzelnes Overlay öffnet es direkt
- **Alt + Ecke = Zuschneiden** bei Web-Overlays (wie in OBS); Ecken skalieren gleichmäßig ohne Verzerrung
- Größe und Position als **zwei getrennte Felder**; neun Positionen (Ecken, Kanten, Mitte), die nur verschieben und nie die Form ändern

### Korrigiert

- Schalter „Hintergrund entfernen" wirkt jetzt auch bei Seiten im Dunkelmodus (z. B. chat.streamer.bot) – die dunkle Fläche kam vom Farbschema, nicht vom Seiteninhalt
- kein dunkles Aufblitzen mehr beim Laden und bei Oberflächen-Umbauten des Overlays
- chat.streamer.bot verbindet jetzt auch aus der Software heraus (der base64-Config-Block wird auf den Relay umgeschrieben)
- Voicemod-Overlay im Overlay-Fenster einbettbar; keine sinnlosen Verbindungs-Parameter mehr an Cloud-Links
- Vorschau spiegelt den Hintergrund-Schalter (an = durchsichtig, aus = wie der Anbieter liefert) und färbt das Feld nicht mehr ein
- Aktionsleiste im Overlays-Tab wie bei den anderen Tabs (kein durchgehender Balken mehr)
- Gruppen-Monitor hatte falsche Größe und Lage

## 1.2.4

### Neu

- Schalter „Hintergrund entfernen“ je Web-Overlay: nimmt die eingefärbten Flächen hinter dem Inhalt weg, zum Beispiel die Kacheln hinter Chat-Nachrichten
- wirkt bei jedem Web-Overlay, ohne eigenen Code je Anbieter; Text, Symbole und Emotes bleiben sichtbar
- das Overlay meldet zurück, ob der Schalter dort angekommen ist

## 1.2.3

### Neu und korrigiert

- Ausgabe für OBS (`/freakshow`) lädt sich nach einem Neustart selbst neu, kein Aktualisieren der Browserquelle mehr nötig
- Ausgabe rendert in der eingestellten Monitorauflösung und passt sich proportional in die Quellgröße ein; Videos, Bilder und Notizen sitzen wie im Editor
- Web-Overlays sind bewusst nicht in der Ausgabe enthalten, mit Hinweis beim Kopieren des Links
- bekannte HTTPS-Overlays laufen über die Bridge, wenn die Anzeige nicht auf dem FreakShow-PC läuft
- WebSocket-Relay im Netzwerk erreichbar, jede Verbindung gegen die IP-Freigabeliste geprüft
- Twitch-Alertbox lässt sich im Overlay-Fenster einbetten
- Video-Bubbles: eigener Textbereich mit automatischer Schriftverkleinerung, „Nur Text anzeigen“, Ausblendanimation vor dem Videoende, Rechtsklick-Menü mit Variablen und Emoji
- Ereignis-Variablen wie `%user%` funktionieren auch in Notizen
- alle Positionsrahmen mit acht Griffen; Video-Ecken skalieren proportional, mit Alt wird zugeschnitten
- Chat meldet einen fehlenden Streamer.bot-Import

## 1.2.2

### Neu und korrigiert

- ein gemeinsamer Streamer.bot-Importcode richtet Output Receiver, Resolver und Chat-Sender zusammen ein
- der Importknopf im leeren Chat ist vollständig anklickbar, mittig ausgerichtet und thematisch umrahmt
- Plus, Beschriftung und Hilfetext bleiben in allen Sprachen innerhalb des Importknopfs
- ein vollständig leerer Video-Katalog zeigt erst nach dem Hinzufügen eines Videos den Editor
- Lautstärke und weitere Videoeinstellungen bleiben bei einem neuen Video am unteren Rand

## 1.2.1

### Neu und korrigiert

- Chat-Importcode dauerhaft unter „Verbindungen“ verfügbar
- mittiger Import-Knopf im leeren Chat, solange Twitch und Streamer.bot getrennt sind
- Importcode direkt in der EXE eingebettet und ohne bestehende Verbindung kopierbar
- Chat-Import-Knopf erscheint nach einer Streamer.bot-Trennung sofort ohne Neuladen
- neuer Video-Katalog startet ohne voreiligen Datei-Importhinweis

## 1.2.0

Diese Version ist ein größerer Funktionssprung. Sie bündelt die neuen Video-, Bild-,
Notiz-, Overlay-, Chat- und Game-Steuerungsfunktionen.

### Neu und erweitert

- frei positionierbare Videos, Bilder, Notizen, Web-Overlays und Text-Bubbles
- Streamer.bot-Trigger und Variablen in Video-Bubbles
- Twitch-, YouTube- und Kick-Auswahl für den Chat-Versand
- Game-Steuerungen, Gruppen, Zufallsskills und verknüpfte Statusbilder
- Zoom- und Positionierungswerkzeuge für die Monitorflächen
- Bild-, Video-, Notiz- und Overlay-Rahmen mit nur vier Eckpunkten sowie direkt ziehbaren Seitenkanten
- mehrsprachige Oberfläche und vereinheitlichte Bedienelemente
- integrierter Updater und eingebettete App-Ressourcen

### Korrigiert

- fehlende Link-Erkennung durch einen falschen Skriptpfad
- widersprüchliche Versionsangaben zwischen EXE, Updater und Textdateien
- hohe CPU- und Verbindungsbelastung durch zu schnelle Statusabfragen
- ungeschützte schreibende Bridge-Endpunkte
- zu offene Standardfreigabe im lokalen Netzwerk
- Klartextspeicherung von Twitch- und Streamer.bot-Zugangsdaten
- veralteter, formatabhängiger Chat-Test

Zugangsdaten werden ab 1.2.0 mit Windows-DPAPI an das aktuelle Windows-Benutzerkonto
gebunden gespeichert. Normale Oberflächeneinstellungen bleiben geräteübergreifend
synchronisierbar.
