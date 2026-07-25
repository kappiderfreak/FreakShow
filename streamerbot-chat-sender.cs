using System;
using System.Collections.Generic;

public class CPHInline
{
    public bool Execute()
    {
        CPH.TryGetArg("message", out string message);
        CPH.TryGetArg("platforms", out string platforms);

        // Fuer einzelne Aufrufer wird auch "platform" akzeptiert.
        if (string.IsNullOrWhiteSpace(platforms))
        {
            CPH.TryGetArg("platform", out platforms);
        }

        message = (message ?? "").Trim();
        platforms = (platforms ?? "").Trim();

        if (message.Length == 0)
        {
            SetResult(false, false, false, "Die Nachricht ist leer.");
            CPH.LogWarn("FreakShow Chat Sender: Leere Nachricht verworfen.");
            return false;
        }

        bool wantsTwitch = false;
        bool wantsYouTube = false;
        bool wantsKick = false;

        foreach (string value in platforms.Split(
            new[] { ',', ';', '|', ' ' },
            StringSplitOptions.RemoveEmptyEntries
        ))
        {
            string platform = value.Trim();
            if (platform.Equals("twitch", StringComparison.OrdinalIgnoreCase))
            {
                wantsTwitch = true;
            }
            else if (
                platform.Equals("youtube", StringComparison.OrdinalIgnoreCase) ||
                platform.Equals("yt", StringComparison.OrdinalIgnoreCase)
            )
            {
                wantsYouTube = true;
            }
            else if (platform.Equals("kick", StringComparison.OrdinalIgnoreCase))
            {
                wantsKick = true;
            }
        }

        if (!wantsTwitch && !wantsYouTube && !wantsKick)
        {
            SetResult(false, false, false, "Keine gueltige Plattform ausgewaehlt.");
            CPH.LogWarn("FreakShow Chat Sender: Keine gueltige Plattform: " + platforms);
            return false;
        }

        bool sentTwitch = false;
        bool sentYouTube = false;
        bool sentKick = false;
        var errors = new List<string>();

        if (wantsTwitch)
        {
            try
            {
                // false = mit dem in Streamer.bot verbundenen Broadcaster-Konto senden.
                CPH.SendMessage(message, false);
                sentTwitch = true;
            }
            catch (Exception ex)
            {
                errors.Add("Twitch: " + ex.Message);
                CPH.LogError("FreakShow Chat Sender | Twitch: " + ex);
            }
        }

        if (wantsYouTube)
        {
            try
            {
                var monitoredBroadcasts = CPH.YouTubeGetMonitoredBroadcasts();
                if (monitoredBroadcasts == null || monitoredBroadcasts.Count == 0)
                {
                    errors.Add("YouTube: Kein ueberwachter Broadcast aktiv.");
                    CPH.LogWarn("FreakShow Chat Sender | YouTube: Kein ueberwachter Broadcast aktiv.");
                }
                else
                {
                    foreach (var broadcast in monitoredBroadcasts)
                    {
                        CPH.SendYouTubeMessage(message, false, true, broadcast.Id);
                    }

                    sentYouTube = true;
                }
            }
            catch (Exception ex)
            {
                errors.Add("YouTube: " + ex.Message);
                CPH.LogError("FreakShow Chat Sender | YouTube: " + ex);
            }
        }

        if (wantsKick)
        {
            try
            {
                CPH.SendKickMessage(message, false);
                sentKick = true;
            }
            catch (Exception ex)
            {
                errors.Add("Kick: " + ex.Message);
                CPH.LogError("FreakShow Chat Sender | Kick: " + ex);
            }
        }

        string error = string.Join(" | ", errors);
        SetResult(sentTwitch, sentYouTube, sentKick, error);

        bool sentAny = sentTwitch || sentYouTube || sentKick;
        if (sentAny)
        {
            CPH.LogInfo(
                "FreakShow Chat Sender | Plattformen=" + platforms +
                " | Nachricht=" + message
            );
        }

        return sentAny;
    }

    private void SetResult(bool twitch, bool youtube, bool kick, string error)
    {
        CPH.SetArgument("freakShowChatSentTwitch", twitch);
        CPH.SetArgument("freakShowChatSentYouTube", youtube);
        CPH.SetArgument("freakShowChatSentKick", kick);
        CPH.SetArgument("freakShowChatSuccess", twitch || youtube || kick);
        CPH.SetArgument("freakShowChatError", error ?? "");
    }
}
