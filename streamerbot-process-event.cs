using System;

public class CPHInline
{
    public bool Execute()
    {
        CPH.TryGetArg("processEventName", out string eventName);
        CPH.TryGetArg("processState", out string state);
        CPH.TryGetArg("processPlatform", out string platform);
        CPH.TryGetArg("processCategory", out string fallbackCategory);
        CPH.TryGetArg("processTwitchCategory", out string twitchCategory);
        CPH.TryGetArg("processYouTubeCategory", out string youtubeCategory);

        eventName = Clean(eventName);
        state = Clean(state).ToLowerInvariant();
        platform = Clean(platform).ToLowerInvariant();
        fallbackCategory = Clean(fallbackCategory);
        twitchCategory = Clean(twitchCategory);
        youtubeCategory = Clean(youtubeCategory);

        if (state != "started")
        {
            SetResult(false, false, false, "skipped", "Only started process events change a category.");
            return true;
        }

        bool wantsTwitch = platform == "twitch" || platform == "both" || platform == "twitch+youtube";
        bool wantsYouTube = platform == "youtube" || platform == "both" || platform == "twitch+youtube";
        if (!wantsTwitch && !wantsYouTube)
        {
            SetResult(false, false, false, "error", "Unknown target platform: " + platform);
            CPH.LogWarn("FreakShow Process Event: Unknown target platform: " + platform);
            return false;
        }

        bool twitchChanged = false;
        bool youtubeChanged = false;
        string error = "";

        if (wantsTwitch)
        {
            string category = twitchCategory.Length > 0 ? twitchCategory : (wantsYouTube ? "" : fallbackCategory);
            if (category.Length == 0)
            {
                error = AddError(error, "Twitch category is empty.");
            }
            else
            {
                try
                {
                    twitchChanged = CPH.SetChannelGame(category) != null;
                    if (!twitchChanged)
                        error = AddError(error, "Twitch category was not found: " + category);
                }
                catch (Exception ex)
                {
                    error = AddError(error, "Twitch: " + ex.Message);
                }
            }
        }

        if (wantsYouTube)
        {
            string category = youtubeCategory.Length > 0 ? youtubeCategory : (wantsTwitch ? "" : fallbackCategory);
            if (category.Length == 0)
            {
                error = AddError(error, "YouTube category is empty.");
            }
            else
            {
                try
                {
                    youtubeChanged = CPH.YouTubeSetCategory(category);
                    if (!youtubeChanged)
                        error = AddError(error, "YouTube category could not be changed: " + category);
                }
                catch (Exception ex)
                {
                    error = AddError(error, "YouTube: " + ex.Message);
                }
            }
        }

        bool success = (!wantsTwitch || twitchChanged) && (!wantsYouTube || youtubeChanged);
        SetResult(success, twitchChanged, youtubeChanged, success ? "changed" : "error", error);

        string label = eventName.Length > 0 ? eventName : "Process event";
        if (success)
            CPH.LogInfo("FreakShow Process Event: " + label + " changed the selected channel category.");
        else
            CPH.LogWarn("FreakShow Process Event: " + label + " | " + error);

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

    private void SetResult(bool success, bool twitch, bool youtube, string result, string error)
    {
        CPH.SetArgument("processCategoryChanged", success);
        CPH.SetArgument("processTwitchCategoryChanged", twitch);
        CPH.SetArgument("processYouTubeCategoryChanged", youtube);
        CPH.SetArgument("processCategoryResult", result ?? "");
        CPH.SetArgument("processCategoryError", error ?? "");
    }
}
