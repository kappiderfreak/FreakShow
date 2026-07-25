using System;
using System.Globalization;

public class CPHInline
{
    public bool Execute()
    {
        CPH.TryGetArg("fsModule", out string module);
        CPH.TryGetArg("fsState", out string state);
        CPH.TryGetArg("fsName", out string name);
        CPH.TryGetArg("fsId", out string id);
        CPH.TryGetArg("fsTrigger", out string trigger);
        CPH.TryGetArg("fsActive", out bool active);
        CPH.TryGetArg("fsDurationMs", out long durationMs);
        CPH.TryGetArg("fsTime", out string formattedTime);

        module = (module ?? "").Trim();
        state = (state ?? "").Trim();
        name = name ?? "";
        id = id ?? "";
        trigger = trigger ?? "";
        formattedTime = (formattedTime ?? "").Trim();
        durationMs = Math.Max(0, durationMs);

        string prefix;

        if (module.Equals("video", StringComparison.OrdinalIgnoreCase))
        {
            prefix = "freakShow_video";
        }
        else if (module.Equals("gameControl", StringComparison.OrdinalIgnoreCase))
        {
            prefix = "freakShow_gameControl";

            double durationSeconds = durationMs / 1000d;
            if (formattedTime.Length == 0)
            {
                long roundedSeconds = Math.Max(0L, (long)Math.Round(durationSeconds, MidpointRounding.AwayFromZero));
                long hours = roundedSeconds / 3600L;
                long minutes = (roundedSeconds % 3600L) / 60L;
                long seconds = roundedSeconds % 60L;
                formattedTime = hours.ToString("00", CultureInfo.InvariantCulture) + ":" +
                    minutes.ToString("00", CultureInfo.InvariantCulture) + ":" +
                    seconds.ToString("00", CultureInfo.InvariantCulture);
            }

            // Diese Argumente stehen allen nachfolgenden Unteraktionen im zentralen
            // Receiver zur Verfuegung. Einzelne Game-Trigger brauchen sie nicht mehr.
            CPH.SetArgument("gameControlName", name);
            CPH.SetArgument("gameControlTime", formattedTime);
            CPH.SetArgument("gameControlTimeSeconds", durationSeconds);
            CPH.SetArgument("rawInput", formattedTime + " | " + name);

            // Fuer FreakShow-Texte zusaetzlich als temporaere Streamer.bot-Globals.
            CPH.SetGlobalVar("gameControlName", name, false);
            CPH.SetGlobalVar("gameControlTime", formattedTime, false);
            CPH.SetGlobalVar("gameControlTimeSeconds", durationSeconds, false);
        }
        else
        {
            CPH.LogWarn("FreakShow Output: Unbekanntes Modul: " + module);
            return false;
        }

        // Modulspezifische, temporaere Variablen
        CPH.SetGlobalVar(prefix + "_active", active, false);
        CPH.SetGlobalVar(prefix + "_state", state, false);
        CPH.SetGlobalVar(prefix + "_name", name, false);
        CPH.SetGlobalVar(prefix + "_id", id, false);
        CPH.SetGlobalVar(prefix + "_trigger", trigger, false);
        CPH.SetGlobalVar(prefix + "_durationMs", durationMs, false);

        // Letzte allgemeine FreakShow-Ausgabe
        CPH.SetGlobalVar("freakShow_output_module", module, false);
        CPH.SetGlobalVar("freakShow_output_state", state, false);
        CPH.SetGlobalVar("freakShow_output_name", name, false);
        CPH.SetGlobalVar("freakShow_output_active", active, false);
        CPH.SetGlobalVar(
            "freakShow_output_timestamp",
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            false
        );

        CPH.LogInfo(
            "FreakShow Output | Modul=" + module +
            " | Status=" + state +
            " | Name=" + name +
            " | Aktiv=" + active
        );

        return true;
    }
}
