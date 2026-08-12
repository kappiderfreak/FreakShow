using System;

public class CPHInline
{
    public bool Execute()
    {
        CPH.TryGetArg("manualPlatform", out string platform);
        CPH.TryGetArg("manualCategory", out string category);
        CPH.TryGetArg("manualTwitchCategory", out string twitchCategory);
        CPH.TryGetArg("manualYouTubeCategory", out string youtubeCategory);

        platform = Clean(platform).ToLowerInvariant();
        category = Clean(category);
        twitchCategory = Clean(twitchCategory);
        youtubeCategory = Clean(youtubeCategory);

        // Direkt per Hotkey/Stream Deck aufgerufen: Twitch -> Just Chatting.
        if (platform.Length == 0) platform = "twitch";
        if (category.Length == 0) category = "Just Chatting";
        if (twitchCategory.Length == 0) twitchCategory = category;
        if (youtubeCategory.Length == 0) youtubeCategory = "People & Blogs";

        bool wantsTwitch = platform == "twitch" || platform == "both" || platform == "twitch+youtube";
        bool wantsYouTube = platform == "youtube" || platform == "both" || platform == "twitch+youtube";
        bool twitchChanged = false;
        bool youtubeChanged = false;
        string error = "";

        if (wantsTwitch)
        {
            try
            {
                twitchChanged = CPH.SetChannelGame(twitchCategory) != null;
                if (!twitchChanged) error = AddError(error, "Twitch category was not found: " + twitchCategory);
            }
            catch (Exception ex)
            {
                error = AddError(error, "Twitch: " + ex.Message);
            }
        }

        if (wantsYouTube)
        {
            try
            {
                youtubeChanged = CPH.YouTubeSetCategory(youtubeCategory);
                if (!youtubeChanged) error = AddError(error, "YouTube category could not be changed: " + youtubeCategory);
            }
            catch (Exception ex)
            {
                error = AddError(error, "YouTube: " + ex.Message);
            }
        }

        bool success = (wantsTwitch || wantsYouTube)
            && (!wantsTwitch || twitchChanged)
            && (!wantsYouTube || youtubeChanged);

        CPH.SetArgument("manualCategoryChanged", success);
        CPH.SetArgument("manualTwitchCategoryChanged", twitchChanged);
        CPH.SetArgument("manualYouTubeCategoryChanged", youtubeChanged);
        CPH.SetArgument("manualCategoryResult", success ? "changed" : "error");
        CPH.SetArgument("manualCategoryError", error);

        if (success)
            CPH.LogInfo("FreakShow: Manual category switch completed (" + platform + ").");
        else
            CPH.LogWarn("FreakShow: Manual category switch failed. " + error);

        return success;
    }

    private static string Clean(string value)
    {
        return (value ?? "").Trim();
    }

    private static string AddError(string existing, string next)
    {
        if (string.IsNullOrWhiteSpace(existing)) return next ?? "";
        if (string.IsNullOrWhiteSpace(next)) return existing;
        return existing + " | " + next;
    }
}
